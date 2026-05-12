/**
 * Track 5 #12 (Section C) — Airline Activity Feed.
 *
 * Pure-aggregator helper über existierende tables. Kein neues schema.
 * Mergt drei event-streams in eine sortierte timeline:
 *
 *   1. Approved PIREPs  → "PILOT flew DEP → ARR"
 *   2. UserAward grants → "PILOT earned AWARD"
 *   3. PirepKudos        → "GIVER 👍 PILOT's flight DEP → ARR"
 *
 * # Scope: airline-internal
 *
 * Der feed ist airline-scoped (alle activity der eigenen airline-piloten).
 * Bewusst KEIN global/cross-airline-feed im V1 — privacy + noise. V2
 * könnte einen "follow-feed" einbauen (#13), der über alle gefolgten
 * piloten cross-airline aggregiert.
 *
 * # Time-window
 *
 * Default: letzte 14 tage. Caller kann override'n. Hard-cap auf 90 tage
 * damit die queries nicht ausarten — wer älter scrollen will kann den
 * older-link bauen (V2 cursor-pagination).
 *
 * # Performance
 *
 * Drei parallel-queries:
 *   - prisma.pirep.findMany (status=Approved, user.airlineId=X, approvedAt>=cutoff)
 *   - prisma.userAward.findMany (user.airlineId=X, awardedAt>=cutoff)
 *   - prisma.pirepKudos.findMany (pirep.user.airlineId=X, createdAt>=cutoff)
 *
 * Take=50 pro stream, dann merge+sort+truncate-to-50. Bei airlines mit
 * <100 piloten ist das O(50) total — fine. Bei massiven airlines (1000+
 * piloten) könnte man query-scoped count vorziehen — V2.
 *
 * # Anti-leak
 *
 * Nur user mit airlineId können den feed laden. Die page-action muss
 * das checken — der helper hier nimmt airlineId als input und ist
 * agnostisch wer fragt.
 */

import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

// SELECT-shapes für die drei query-streams. `satisfies` + GetPayload<>
// gibt uns korrekt-typed row-objekte — der extended prisma-client
// (via $extends) verliert downstream die select-payload-inference,
// daher casten wir die returnten arrays mit den passenden payload-types.
// Selber pattern wie users/public-profile.ts und pilot-stats/personal-bests.ts.
const ACTOR_USER_SELECT = {
  id: true,
  name: true,
  image: true,
  rank: { select: { name: true } },
} satisfies Prisma.UserSelect;

const PIREP_FEED_SELECT = {
  id: true,
  approvedAt: true,
  flightTimeMin: true,
  route: { select: { flightNumber: true } },
  departure: { select: { icao: true } },
  arrival: { select: { icao: true } },
  aircraft: { select: { type: true } },
  user: { select: ACTOR_USER_SELECT },
} satisfies Prisma.PirepSelect;

const AWARD_FEED_SELECT = {
  id: true,
  awardedAt: true,
  user: { select: ACTOR_USER_SELECT },
  award: {
    select: {
      id: true,
      name: true,
      description: true,
      iconUrl: true,
    },
  },
} satisfies Prisma.UserAwardSelect;

const KUDOS_FEED_SELECT = {
  id: true,
  createdAt: true,
  user: { select: ACTOR_USER_SELECT },
  pirep: {
    select: {
      id: true,
      route: { select: { flightNumber: true } },
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      user: { select: ACTOR_USER_SELECT },
    },
  },
} satisfies Prisma.PirepKudosSelect;

type PirepFeedRow = Prisma.PirepGetPayload<{ select: typeof PIREP_FEED_SELECT }>;
type AwardFeedRow = Prisma.UserAwardGetPayload<{
  select: typeof AWARD_FEED_SELECT;
}>;
type KudosFeedRow = Prisma.PirepKudosGetPayload<{
  select: typeof KUDOS_FEED_SELECT;
}>;

const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_LIMIT = 50;
const PER_STREAM_TAKE = 50;

export type ActivityActor = {
  id: string;
  name: string | null;
  image: string | null;
  rankName: string | null;
};

export type ActivityEvent =
  | {
      kind: "pirep";
      id: string;
      timestamp: Date;
      actor: ActivityActor;
      pirep: {
        id: string;
        flightNumber: string | null;
        departureIcao: string;
        arrivalIcao: string;
        aircraftType: string | null;
        flightTimeMin: number | null;
      };
    }
  | {
      kind: "award";
      id: string;
      timestamp: Date;
      actor: ActivityActor;
      award: {
        id: string;
        name: string;
        description: string | null;
        iconUrl: string | null;
      };
    }
  | {
      kind: "kudos";
      id: string;
      timestamp: Date;
      // For kudos, the actor is the GIVER (who clicked the kudos button).
      // The PIREP-owner is in `target.pilot`.
      actor: ActivityActor;
      target: {
        pilot: ActivityActor;
        pirepId: string;
        flightNumber: string | null;
        departureIcao: string;
        arrivalIcao: string;
      };
    };

function getCutoff(windowDays: number): Date {
  const days = Math.min(Math.max(windowDays, 1), MAX_WINDOW_DAYS);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function actorFromUser(u: {
  id: string;
  name: string | null;
  image: string | null;
  rank: { name: string } | null;
}): ActivityActor {
  return {
    id: u.id,
    name: u.name,
    image: u.image,
    rankName: u.rank?.name ?? null,
  };
}

/**
 * Returnt die letzten N events der airline, sortiert by timestamp desc.
 */
export async function getAirlineActivityFeed(
  airlineId: string,
  options: { windowDays?: number; limit?: number } = {},
): Promise<ActivityEvent[]> {
  const cutoff = getCutoff(options.windowDays ?? DEFAULT_WINDOW_DAYS);
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, 200);

  // ── 1. Recent approved PIREPs by airline-piloten ─────────────────────
  const pirepsP = prisma.pirep.findMany({
    where: {
      user: { airlineId },
      status: "Approved",
      approvedAt: { gte: cutoff },
    },
    orderBy: { approvedAt: "desc" },
    take: PER_STREAM_TAKE,
    select: PIREP_FEED_SELECT,
  });

  // ── 2. Recent award grants ──────────────────────────────────────────
  const awardsP = prisma.userAward.findMany({
    where: {
      user: { airlineId },
      awardedAt: { gte: cutoff },
    },
    orderBy: { awardedAt: "desc" },
    take: PER_STREAM_TAKE,
    select: AWARD_FEED_SELECT,
  });

  // ── 3. Recent kudos given on airline-pilots' PIREPs ─────────────────
  const kudosP = prisma.pirepKudos.findMany({
    where: {
      pirep: { user: { airlineId } },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: PER_STREAM_TAKE,
    select: KUDOS_FEED_SELECT,
  });

  const [pirepsRaw, awardsRaw, kudosRaw] = await Promise.all([
    pirepsP,
    awardsP,
    kudosP,
  ]);

  // Cast — see SELECT-comment für rationale (extended-client loses
  // select-payload-inference). The arrays at runtime ARE shaped to the
  // satisfies-constants, but the TS type comes back as the raw model.
  const pireps = pirepsRaw as unknown as PirepFeedRow[];
  const awards = awardsRaw as unknown as AwardFeedRow[];
  const kudos = kudosRaw as unknown as KudosFeedRow[];

  // ── Merge into a flat ActivityEvent array ───────────────────────────
  const events: ActivityEvent[] = [];

  for (const p of pireps) {
    // approvedAt SHOULD always be set for Approved-status, but defensively skip
    if (!p.approvedAt) continue;
    events.push({
      kind: "pirep",
      id: `pirep:${p.id}`,
      timestamp: p.approvedAt,
      actor: actorFromUser(p.user),
      pirep: {
        id: p.id,
        flightNumber: p.route?.flightNumber ?? null,
        departureIcao: p.departure.icao,
        arrivalIcao: p.arrival.icao,
        aircraftType: p.aircraft?.type ?? null,
        flightTimeMin: p.flightTimeMin,
      },
    });
  }

  for (const a of awards) {
    events.push({
      kind: "award",
      id: `award:${a.id}`,
      timestamp: a.awardedAt,
      actor: actorFromUser(a.user),
      award: a.award,
    });
  }

  for (const k of kudos) {
    // Self-kudos shouldn't exist (server-action blocks them), but defensively
    // hide kudos where giver == pirep-owner from the feed.
    if (k.user.id === k.pirep.user.id) continue;
    events.push({
      kind: "kudos",
      id: `kudos:${k.id}`,
      timestamp: k.createdAt,
      actor: actorFromUser(k.user),
      target: {
        pilot: actorFromUser(k.pirep.user),
        pirepId: k.pirep.id,
        flightNumber: k.pirep.route?.flightNumber ?? null,
        departureIcao: k.pirep.departure.icao,
        arrivalIcao: k.pirep.arrival.icao,
      },
    });
  }

  // Sort timestamp desc + truncate
  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return events.slice(0, limit);
}
