import type { Event, EventParticipant, User, EventStatus, EventKind } from "@prisma/client";
import { prisma } from "../index.js";

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Read-side queries für das
 * event-system.
 *
 * Events sind organisierte airline-veranstaltungen (tours, themed-flights,
 * group-flights etc.). Pilots können sich anmelden via EventParticipant.
 * Admins erstellen + verwalten via /admin/events. Public-catalog liegt
 * unter /events.
 *
 * # Computed status
 *
 * Der gespeicherte EventStatus (DRAFT/PUBLISHED/COMPLETED/CANCELLED) ist
 * der "lifecycle-anchor" — IN_PROGRESS hingegen wird live aus
 * (startsAt, endsAt, now) berechnet. Siehe `computeRuntimeStatus` unten.
 * Das spart einen cron-job für status-transitions und macht den runtime-
 * status immer mit der aktuellen wall-clock konsistent.
 *
 * # Sortierung
 *
 * Public-catalog: sortiert nach startsAt asc (kommende events zuerst),
 * separater "vergangene events"-tab nach startsAt desc.
 *
 * Admin-listing: nach createdAt desc (neueste WIP zuerst, sodass admin
 * an seinem aktuellen draft direkt weiterarbeiten kann).
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Live-berechneter status für UI-rendering. Erweitert die DB-statuses
 * um IN_PROGRESS (event läuft gerade) und UPCOMING (event ist publiziert
 * aber startsAt noch in der zukunft).
 *
 * - DRAFT/CANCELLED kommen direkt aus DB.
 * - PUBLISHED+startsAt>now → UPCOMING
 * - PUBLISHED+startsAt<=now+endsAt>now (oder endsAt null) → IN_PROGRESS
 * - PUBLISHED+endsAt<now → ENDED (event-window vorbei aber admin hat
 *   noch nicht manuell auf COMPLETED gesetzt)
 * - COMPLETED kommt direkt aus DB.
 */
export type RuntimeStatus =
  | "DRAFT"
  | "UPCOMING"
  | "IN_PROGRESS"
  | "ENDED"
  | "COMPLETED"
  | "CANCELLED";

export type EventWithCounts = Event & {
  participantCount: number;
  /** Convenience: live-berechnet aus startsAt/endsAt + status. */
  runtimeStatus: RuntimeStatus;
};

export type EventDetail = Event & {
  participantCount: number;
  runtimeStatus: RuntimeStatus;
  airline: { id: string; name: string } | null;
  createdBy: Pick<User, "id" | "name" | "image">;
};

export type EventForAdmin = Event & {
  participantCount: number;
  completedCount: number;
  runtimeStatus: RuntimeStatus;
  createdBy: Pick<User, "id" | "name" | "image">;
};

export type EventParticipantWithUser = EventParticipant & {
  user: Pick<User, "id" | "name" | "image">;
  completedBy: Pick<User, "id" | "name"> | null;
};

export type UserEventEntry = EventParticipant & {
  event: Pick<
    Event,
    | "id"
    | "title"
    | "slug"
    | "kind"
    | "status"
    | "coverImageUrl"
    | "startsAt"
    | "endsAt"
    | "bonusReward"
  > & { runtimeStatus: RuntimeStatus };
};

// ─────────────────────────────────────────────────────────────────────
// Runtime-status helper
// ─────────────────────────────────────────────────────────────────────

/**
 * Pure helper — testbar isoliert. Mappt DB-status + zeitpunkte auf den
 * runtime-status.
 *
 * @param status        DB-status der event-row
 * @param startsAt      startzeit
 * @param endsAt        endzeit (null = open-ended themed-event)
 * @param now           reference-time (default: aktuell, override für tests)
 */
export function computeRuntimeStatus(
  status: EventStatus,
  startsAt: Date,
  endsAt: Date | null,
  now: Date = new Date(),
): RuntimeStatus {
  if (status === "DRAFT") return "DRAFT";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "COMPLETED") return "COMPLETED";

  // status === "PUBLISHED" — live berechnen
  const nowMs = now.getTime();
  const startMs = startsAt.getTime();
  const endMs = endsAt?.getTime() ?? null;

  if (nowMs < startMs) return "UPCOMING";
  if (endMs === null || nowMs < endMs) return "IN_PROGRESS";
  return "ENDED"; // window vorbei aber DB-status noch PUBLISHED
}

function attachRuntimeStatus<T extends Pick<Event, "status" | "startsAt" | "endsAt">>(
  event: T,
): T & { runtimeStatus: RuntimeStatus } {
  return {
    ...event,
    runtimeStatus: computeRuntimeStatus(event.status, event.startsAt, event.endsAt),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public catalog queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Public catalog: alle published events einer airline, optional gefiltert
 * nach time-bucket. Kommend (startsAt > now) und laufend werden in den
 * "Aktuelle Events"-tab gerendert; vergangene (endsAt < now ODER status
 * = COMPLETED) in den "Vergangene Events"-tab.
 *
 * - airlineId=null bedeutet "VA-wide events" (sichtbar für alle).
 * - bucket="upcoming" → startsAt >= now ODER (endsAt > now)
 * - bucket="past" → endsAt < now ODER status=COMPLETED
 * - bucket="all" → alles inkl. CANCELLED (für admin-übersicht; public
 *   nutzt nur upcoming/past)
 *
 * Includiert participantCount für badge-display ("12/25 Teilnehmer").
 */
export async function listPublishedEvents(options: {
  airlineId?: string | null;
  bucket: "upcoming" | "past" | "all";
  kind?: EventKind | null;
}): Promise<EventWithCounts[]> {
  const now = new Date();
  const baseWhere = {
    // VA-wide events (airlineId=null) sind immer sichtbar; airline-events
    // nur wenn airlineId gefiltert wird oder undefined (=alle airlines).
    ...(options.airlineId !== undefined && options.airlineId !== null
      ? { OR: [{ airlineId: options.airlineId }, { airlineId: null }] }
      : {}),
    ...(options.kind ? { kind: options.kind } : {}),
  };

  let where: Record<string, unknown>;
  if (options.bucket === "upcoming") {
    // Alles published was noch nicht vorbei ist (oder endsAt null = open-ended)
    where = {
      ...baseWhere,
      status: "PUBLISHED",
      OR: [
        { endsAt: null },
        { endsAt: { gte: now } },
      ],
    };
  } else if (options.bucket === "past") {
    // PUBLISHED-events deren endsAt vorbei ist, plus alle COMPLETED
    where = {
      ...baseWhere,
      OR: [
        { status: "COMPLETED" },
        { AND: [{ status: "PUBLISHED" }, { endsAt: { lt: now } }] },
      ],
    };
  } else {
    // all — admin-perspektive, keine status-filterung
    where = baseWhere;
  }

  const events = await prisma.event.findMany({
    where: where as never,
    orderBy:
      options.bucket === "past"
        ? { startsAt: "desc" }
        : { startsAt: "asc" },
    include: {
      _count: { select: { participants: true } },
    },
  });

  return events.map((e) => ({
    ...attachRuntimeStatus(e),
    participantCount: e._count.participants,
  }));
}

/**
 * Single event by slug für public detail-page. Includes participantCount,
 * airline-info (für VA-context-anzeige) und createdBy.
 *
 * Returnt null wenn nicht gefunden ODER wenn der event DRAFT ist (DRAFTs
 * sind admin-only) — caller (page.tsx) macht notFound() draus.
 *
 * @param viewerIsAdmin wenn true, werden auch DRAFT-events returnt
 *                      (für admin-preview vor publish)
 */
export async function getEventBySlug(
  slug: string,
  options: { viewerIsAdmin?: boolean } = {},
): Promise<EventDetail | null> {
  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      airline: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, image: true } },
      _count: { select: { participants: true } },
    },
  });
  if (!event) return null;
  if (event.status === "DRAFT" && !options.viewerIsAdmin) return null;

  return {
    ...attachRuntimeStatus(event),
    participantCount: event._count.participants,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Admin queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Admin-listing: alle events (auch DRAFTs + CANCELLEDs) einer airline,
 * sortiert nach createdAt desc damit der admin sein letztes WIP oben hat.
 *
 * Includiert participantCount und completedCount fürs admin-dashboard
 * (z.B. "23 angemeldet, 18 completion-confirmed → 5 ausstehend").
 */
export async function listEventsForAdmin(options: {
  airlineId?: string | null;
}): Promise<EventForAdmin[]> {
  const events = await prisma.event.findMany({
    where:
      options.airlineId !== undefined
        ? { airlineId: options.airlineId }
        : {},
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true, image: true } },
      participants: { select: { completed: true } },
    },
  });
  return events.map((e) => ({
    ...attachRuntimeStatus(e),
    participantCount: e.participants.length,
    completedCount: e.participants.filter((p) => p.completed).length,
  }));
}

/**
 * Admin-detail: event by id mit voller participant-liste. Nutzt der
 * admin um per-pilot completion-flags zu setzen.
 */
export async function getEventForAdmin(
  id: string,
): Promise<
  | (EventDetail & {
      participants: EventParticipantWithUser[];
    })
  | null
> {
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      airline: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, image: true } },
      participants: {
        orderBy: [{ completed: "asc" }, { joinedAt: "asc" }],
        include: {
          user: { select: { id: true, name: true, image: true } },
          completedBy: { select: { id: true, name: true } },
        },
      },
      _count: { select: { participants: true } },
    },
  });
  if (!event) return null;
  return {
    ...attachRuntimeStatus(event),
    participantCount: event._count.participants,
    participants: event.participants,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Participant queries (für public detail-page)
// ─────────────────────────────────────────────────────────────────────

/**
 * Liste der teilnehmer eines events für public-detail-page. Sortiert
 * nach joinedAt asc (älteste signups zuerst — "early adopter"-anerkennung).
 *
 * Returns minimal user-info (id/name/image) — keine sensitiven felder.
 */
export async function getEventParticipants(
  eventId: string,
): Promise<EventParticipantWithUser[]> {
  return prisma.eventParticipant.findMany({
    where: { eventId },
    orderBy: { joinedAt: "asc" },
    include: {
      user: { select: { id: true, name: true, image: true } },
      completedBy: { select: { id: true, name: true } },
    },
  });
}

/**
 * Check ob ein bestimmter user an einem event teilnimmt. Returns die
 * EventParticipant-row falls ja, null sonst. Caller (detail-page) nutzt
 * das um den signup-button als "Anmelden" oder "Abmelden" zu rendern.
 */
export async function getUserEventParticipation(
  eventId: string,
  userId: string,
): Promise<EventParticipant | null> {
  return prisma.eventParticipant.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
}

// ─────────────────────────────────────────────────────────────────────
// User-profile queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Alle events an denen ein user teilgenommen hat (oder noch teilnimmt).
 * Sortiert nach event.startsAt desc — neueste/aktuellste oben.
 *
 * Includiert minimal-event-info für card-display + den completed-flag.
 * Nutze diesen helper für "Meine Events"-tab im profile.
 */
export async function getUserEvents(userId: string): Promise<UserEventEntry[]> {
  const participations = await prisma.eventParticipant.findMany({
    where: { userId },
    orderBy: { event: { startsAt: "desc" } },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          slug: true,
          kind: true,
          status: true,
          coverImageUrl: true,
          startsAt: true,
          endsAt: true,
          bonusReward: true,
        },
      },
    },
  });
  return participations.map((p) => ({
    ...p,
    event: {
      ...p.event,
      runtimeStatus: computeRuntimeStatus(
        p.event.status,
        p.event.startsAt,
        p.event.endsAt,
      ),
    },
  }));
}

/**
 * Count von distinct events an denen ein user teilnimmt/teilgenommen
 * hat. Für profile-stats ("3 Events").
 */
export async function countUserEvents(userId: string): Promise<number> {
  return prisma.eventParticipant.count({ where: { userId } });
}
