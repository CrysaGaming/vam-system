/**
 * Track 4 #21 — GET /api/events/[slug]/ics
 *
 * Liefert einen iCalendar (RFC 5545)-formatierten body, den der user in
 * Google Calendar / Apple Calendar / Outlook importieren kann. UI auf
 * der event-detail-page hat einen "Zum Kalender hinzufügen"-link der
 * hierauf zeigt.
 *
 * # Auth
 *
 * Member-only (analog zur events-page selbst). Public-events könnten
 * theoretisch ohne auth abrufbar sein, aber die airline-scoping-policy
 * und die DRAFT-status-protection wären dann nicht mehr enforced.
 * Member-gate keep es einfach — wer in der airline ist, kann events
 * sehen UND zum kalender hinzufügen.
 *
 * # ICS-format (hand-rolled)
 *
 * Eine 30-zeilige hand-rolled implementierung statt einer npm-dependency
 * (`ics`-package): wir brauchen nur eine handvoll fields (UID, DTSTAMP,
 * DTSTART, DTEND, SUMMARY, DESCRIPTION, URL) und keine recurrence-rules
 * oder timezone-overrides. Hand-roll spart eine dependency und macht
 * den output präzise diagnostizierbar.
 *
 * # Escaping (RFC 5545 §3.3.11 TEXT)
 *
 * Backslash, comma, semicolon, newline brauchen escapes:
 *   \  → \\
 *   ,  → \,
 *   ;  → \;
 *   \n → \n  (literal backslash-n)
 *
 * Line-folding (75-octet limit pro RFC 5545 §3.1) lassen wir weg —
 * moderne calendar-apps (Google/Apple/Outlook) sind tolerant gegenüber
 * unfolded long lines. Falls je probleme auftreten, foldLine() als
 * post-processing-step nachrüstbar.
 *
 * # Datums-format
 *
 * UTC-format YYYYMMDDTHHMMSSZ (kein timezone-component). Die Date-
 * objekte aus prisma sind in UTC gespeichert, .toISOString() liefert
 * "2026-05-09T18:30:00.000Z" → wir strippen die nicht-numerischen
 * zeichen + .000 + Z am ende.
 *
 * # DTEND-fallback
 *
 * Wenn das event kein endsAt hat (single-flight ohne dauer-info),
 * setzen wir DTEND = DTSTART + 2 stunden als sinnvoller default —
 * sonst rendern manche calendar-apps das als 0-min-event.
 */

import { auth } from "@/auth";
import { getEventBySlug, prisma } from "@vam/db";
import { NextResponse } from "next/server";

/**
 * RFC 5545 TEXT-escape: backslash, comma, semicolon, newline.
 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * UTC-form für DTSTART/DTEND/DTSTAMP: YYYYMMDDTHHMMSSZ.
 */
function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Build full iCalendar body.
 */
function buildIcsBody(args: {
  uid: string;
  startsAt: Date;
  endsAt: Date | null;
  summary: string;
  description: string;
  url: string;
}): string {
  const dtstamp = toIcsDate(new Date());
  const dtstart = toIcsDate(args.startsAt);
  // Wenn endsAt null: default 2h-fenster ab start.
  const endDate =
    args.endsAt ?? new Date(args.startsAt.getTime() + 2 * 60 * 60 * 1000);
  const dtend = toIcsDate(endDate);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//vam-system//Events 1.0//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${args.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeText(args.summary)}`,
    `DESCRIPTION:${escapeText(args.description)}`,
    `URL:${args.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // RFC 5545 §3.1 — lines must end with CRLF.
  return lines.join("\r\n") + "\r\n";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  // Admin-check für DRAFT-preview-zugriff (mirrors event-detail-page).
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: { select: { name: true } } },
  });
  const isAdmin = currentUser?.role?.name === "admin";

  const event = await getEventBySlug(slug, { viewerIsAdmin: isAdmin });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // CANCELLED + DRAFT events sind technisch im calendar nicht sinnvoll.
  // CANCELLED könnte man als METHOD:CANCEL exportieren um existing
  // calendar-entries zu invalidieren — aber das setzt voraus dass der
  // user den event schon mal hinzugefügt hat. MVP: einfach 410 Gone
  // damit der user weiß warum kein download kommt.
  if (event.runtimeStatus === "CANCELLED") {
    return NextResponse.json(
      { error: "Event was cancelled" },
      { status: 410 },
    );
  }

  // Build absolute event-URL aus request-origin damit der UID +
  // calendar-entry-link zur richtigen instanz zeigt (vam.kevindrack.de
  // in production, localhost:3000 in dev, etc.).
  const reqUrl = new URL(request.url);
  const eventUrl = `${reqUrl.protocol}//${reqUrl.host}/events/${event.slug}`;

  // UID muss global-unique sein. event.id (cuid) ist schon unique,
  // hängen wir die instanz-domain dran damit's auch über instanzen
  // hinweg unique ist.
  const uid = `${event.id}@${reqUrl.host}`;

  // Description kombiniert kind + bonus + die rohe description.
  // Calendar-entry soll alles wesentliche enthalten ohne dass der user
  // zurück auf die website muss.
  const bonusVal = Number(event.bonusReward);
  const descriptionParts: string[] = [];
  descriptionParts.push(event.description);
  if (bonusVal > 0) {
    descriptionParts.push(`Completion-Bonus: ${bonusVal} VAM$`);
  }
  if (event.maxParticipants !== null) {
    descriptionParts.push(
      `Teilnehmer: ${event.participantCount} / ${event.maxParticipants}`,
    );
  }
  descriptionParts.push(`Details: ${eventUrl}`);

  const ics = buildIcsBody({
    uid,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    summary: event.title,
    description: descriptionParts.join("\n\n"),
    url: eventUrl,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Filename = slug — damit der download im browser einen
      // erkennbaren namen hat statt "ics" oder "[slug].ics" generic.
      "Content-Disposition": `attachment; filename="event-${event.slug}.ics"`,
      // Kein cache: events können mid-day cancelled werden, wir wollen
      // dass der re-download den aktuellen state holt.
      "Cache-Control": "no-store",
    },
  });
}
