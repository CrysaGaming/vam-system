import Link from 'next/link';
import { prisma } from '@vam/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Vision §9.3.16 — Tour-Calendar mit Saisonalen-Events (Item 9/10).
 *
 * # Was ist hier — und was nicht (v1)
 *
 * v1 ist ein READ-ONLY admin-overview-widget. Drei stapel:
 *   1. Saisonal-events (kind=SEASONAL) als top-row mit cover-image,
 *      "in X Tagen"-countdown, participant-count.
 *   2. Upcoming-tours (kind=TOUR) — top-5 nach startsAt asc.
 *   3. Status-puls — 4 zähler-pills: DRAFTs, läuft jetzt, beendet (30d),
 *      cancelled (30d). Quick-link "Drafts reviewen" wenn count>0.
 *
 * Bewusst NICHT in v1 (eigene tickets):
 *   - Inline-creation. Existing /admin/events page hat schon ein
 *     CreateEventForm mit allen feldern + slug-auto-gen + coverImage.
 *     Dieses widget verlinkt dorthin statt das form zu duplizieren.
 *   - Kalendervisualisierung (month-grid mit events als balken). Schöner
 *     stretch-feature aber nicht v1 — listen-view ist day-1-genug.
 *   - Recurring-events / saison-templates ("jedes jahr im dezember
 *     winter-tour"). Eigenes ticket — schema-erweiterung notwendig.
 *   - Push-discord-on-publish. Existing event-flow hat das vermutlich
 *     bereits in actions.ts, hier ist es nicht relevant.
 *
 * # Why dashboard-widget?
 *
 * Saisonale events sind ein engagement-treiber den admins leicht ver-
 * gessen ("oh, weihnachten ist in 2 wochen — wir hätten was machen
 * sollen"). Das widget zeigt die nächsten saison-events prominent +
 * lenkt den admin auf published draft-arbeit. Wenn die seasonal-row
 * leer ist, sieht admin einen direkten CTA zum erstellen.
 *
 * # Performance
 *
 * 4 parallel queries (Promise.all): seasonal+tours findMany +
 * 2x count. Alle gehen über event_status_idx + event_starts_at_idx
 * (im schema vorhanden). Cache-policy via revalidate=30 in der page.
 *
 * # Auth
 *
 * Wird nur in admin/page.tsx gerendert; die page selbst gated mit
 * requireAdminPage(). Pure read-only — keine actions erforderlich.
 */
export async function TourCalendar() {
  const now = new Date();
  const past30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  // 4 parallel-queries für widget-content. seasonal/tours sind die
  // featured-rows, drafts/recent sind die status-puls-zahlen.
  const [seasonal, upcomingTours, draftCount, statusCounts] = await Promise.all([
    prisma.event.findMany({
      where: {
        kind: 'SEASONAL',
        status: 'PUBLISHED',
        startsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      take: 3,
      select: {
        id: true,
        title: true,
        slug: true,
        startsAt: true,
        endsAt: true,
        coverImageUrl: true,
        maxParticipants: true,
        airline: { select: { name: true, icao: true } },
        _count: { select: { participants: true } },
      },
    }),
    prisma.event.findMany({
      where: {
        kind: 'TOUR',
        status: 'PUBLISHED',
        startsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: {
        id: true,
        title: true,
        slug: true,
        startsAt: true,
        airline: { select: { icao: true } },
        _count: { select: { participants: true } },
      },
    }),
    prisma.event.count({ where: { status: 'DRAFT' } }),
    prisma.event.groupBy({
      by: ['status'],
      _count: true,
      where: {
        OR: [
          // läuft jetzt: published + im zeitfenster
          { status: 'PUBLISHED', startsAt: { lte: now } },
          // letzte 30d completed/cancelled für puls
          { status: { in: ['COMPLETED', 'CANCELLED'] }, createdAt: { gte: past30d } },
        ],
      },
    }),
  ]);

  const runningCount =
    statusCounts.find((s) => s.status === 'PUBLISHED')?._count ?? 0;
  const completedCount =
    statusCounts.find((s) => s.status === 'COMPLETED')?._count ?? 0;
  const cancelledCount =
    statusCounts.find((s) => s.status === 'CANCELLED')?._count ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tour-Calendar mit Saisonalen-Events</CardTitle>
        <CardDescription>
          Saisonale highlights, upcoming tours und draft-pipeline. Vision §9.3.16.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Saisonale highlights */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              🍂 Saisonale Events
            </h3>
            <Link
              href="/admin/events"
              className="text-xs text-primary hover:underline"
            >
              Neues Saison-Event →
            </Link>
          </div>
          {seasonal.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Keine saisonalen Events geplant.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Tipp: Frühling-Tour, Halloween-Charter, Weihnachts-Geschenkflüge.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {seasonal.map((e) => (
                <Link
                  key={e.id}
                  href={`/events/${e.slug}`}
                  className="group rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:border-primary transition-colors"
                >
                  {e.coverImageUrl ? (
                    // Plain <img> + <picture> wrapper (Next.js 16/Turbopack
                    // pattern aus userMemories — Float-preload-warning-fix).
                    // Comment außerhalb des JSX-elements wegen turbopack-strip-bug.
                    <picture>
                      <img
                        src={e.coverImageUrl}
                        alt=""
                        className="w-full h-24 object-cover"
                      />
                    </picture>
                  ) : (
                    <div className="w-full h-24 bg-gradient-to-br from-orange-200 to-amber-300 dark:from-orange-900/40 dark:to-amber-800/40 flex items-center justify-center text-3xl">
                      🍂
                    </div>
                  )}
                  <div className="p-3">
                    <h4 className="font-semibold text-sm line-clamp-1 group-hover:text-primary transition-colors">
                      {e.title}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatTimeUntil(e.startsAt)} ·{' '}
                      {e._count.participants}
                      {e.maxParticipants ? `/${e.maxParticipants}` : ''}{' '}
                      Teilnehmer
                    </p>
                    {e.airline && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {e.airline.icao ?? e.airline.name}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming tours feed */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            ✈️ Upcoming Tours
          </h3>
          {upcomingTours.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              Keine bevorstehenden Tour-Events.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {upcomingTours.map((e) => (
                <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                  <Link
                    href={`/events/${e.slug}`}
                    className="flex-1 min-w-0 hover:text-primary transition-colors"
                  >
                    <p className="text-sm font-medium truncate">{e.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatTimeUntil(e.startsAt)}
                      {e.airline?.icao ? ` · ${e.airline.icao}` : ''}
                    </p>
                  </Link>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {e._count.participants} P.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Status-puls */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-200 dark:border-gray-800">
          <StatusPill
            label="Drafts"
            value={draftCount}
            tone={draftCount > 0 ? 'warn' : 'neutral'}
            href={draftCount > 0 ? '/admin/events?status=DRAFT' : undefined}
          />
          <StatusPill label="Läuft jetzt" value={runningCount} tone="success" />
          <StatusPill label="Beendet (30d)" value={completedCount} tone="neutral" />
          <StatusPill
            label="Abgesagt (30d)"
            value={cancelledCount}
            tone={cancelledCount > 0 ? 'warn' : 'neutral'}
          />
        </section>
      </CardContent>
    </Card>
  );
}

interface StatusPillProps {
  label: string;
  value: number;
  tone: 'success' | 'warn' | 'neutral';
  href?: string;
}

function StatusPill({ label, value, tone, href }: StatusPillProps) {
  const toneClasses =
    tone === 'success'
      ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50'
      : tone === 'warn'
        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50'
        : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800';

  const valueColor =
    tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-gray-700 dark:text-gray-300';

  const inner = (
    <div className={`rounded-lg border ${toneClasses} px-3 py-2`}>
      <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="hover:opacity-90 transition-opacity">
        {inner}
      </Link>
    );
  }
  return inner;
}

/**
 * Vorwärts-relative-zeit-format ("morgen" / "in 5 Tagen" / "in 2 Wo.").
 * Mirror von formatRelative in notification-center.tsx und awards-crafting-
 * dashboard.tsx, aber zukunfts-orientiert. Bei drei call-sites lohnt
 * extraction immer noch nicht — die format-rules sind genug verschieden
 * (vergangenheit vs. zukunft, kalender-fallback bei >30d) dass eine
 * gemeinsame helper-API erstmal abstraktion-overhead wäre.
 */
function formatTimeUntil(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 0) return 'läuft';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `in ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return diffH < 2 ? 'gleich' : `in ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'morgen';
  if (diffD < 7) return `in ${diffD} Tagen`;
  if (diffD < 30) {
    const w = Math.floor(diffD / 7);
    return w === 1 ? 'in 1 Woche' : `in ${w} Wo.`;
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
}
