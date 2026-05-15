import 'server-only';

/**
 * Welle P / P4 — Random irregular operations (IROPs) dispatcher.
 *
 * Three entrypoints:
 *
 *   maybeRollIropsForBooking(bookingId, db?) — invoked from
 *     createBooking. Rolls a weighted 6-sided die; on a ~15% hit,
 *     picks one of the six IropsEventType variants and creates an
 *     IropsEvent row. Returns the created event or null.
 *
 *   getActiveIropsForUser(userId) — lists unacknowledged events for
 *     the caller's own bookings. Joined via Booking.userId so each
 *     pilot only sees their own. Used by the dashboard card.
 *
 *   acknowledgeIropsEvent(eventId, userId) — marks an event as
 *     acknowledged, scoping to the caller's bookings so a pilot
 *     can't ack someone else's IROP.
 *
 * # Why 15%
 *
 * Tuned by feel for sim play, not for realism. Real airline ops
 * have disruption rates closer to 30-50% but most are sub-minute
 * adjustments invisible to passengers. For a VA, 15% per booking
 * means "every few flights you get an IROP" — frequent enough to
 * feel like a real airline, rare enough not to be annoying.
 *
 * # Weights
 *
 * Different event types have different in-flight impact, so we
 * weight the random pick to favor minor events. WEATHER_HOLD is
 * the only MAJOR-eligible event in v1 — the others are all MINOR
 * with relatively small delays.
 *
 * # Delay/message templating
 *
 * Each event type owns a `craftEvent` factory that knows how to
 * pick a sensible delay and write a German-language message. Bot/
 * server-side strings only — pilots see them via the dashboard card.
 *
 * # No relation back to Booking
 *
 * IropsEvent.bookingId is a plain FK (no @relation, see schema
 * header). Cascade-delete on booking cancel is the application's
 * job — when bookings get hard-deleted (rare; usually we set
 * state=Cancelled), the IROPs orphan. Acceptable tradeoff for v1
 * given how rarely bookings are deleted vs. cancelled.
 */

import {
  prisma,
  IropsEventType,
  IropsSeverity,
  type IropsEvent,
  type PrismaClient,
  type Prisma,
} from '@vam/db';

// ─── Tuning ─────────────────────────────────────────────────
// Probability of injecting any IROP at all on booking creation.
// 0 disables; 1 makes every booking get one.
const IROP_INJECTION_PROBABILITY = 0.15;

// Weighted bag for picking event type. Sum doesn't have to be 100;
// pickWeighted normalises internally.
const EVENT_TYPE_WEIGHTS: Record<IropsEventType, number> = {
  SLOT_DELAY: 30,      // Most common in real ops — ATC pushes
  GATE_CHANGE: 25,     // Frequent, harmless
  WEATHER_HOLD: 15,    // Less common, can be MAJOR
  TECH_ISSUE: 10,      // Real airframes have niggles
  CREW_SHUFFLE: 10,    // Cosmetic flavor event
  RUNWAY_CHANGE: 10,   // Frequent at busy hubs
};

// ─── Public API ─────────────────────────────────────────────

// Either the plain prisma client or a transaction client — accept
// both so callers can invoke us inside a $transaction.
type Db = PrismaClient | Prisma.TransactionClient;

export async function maybeRollIropsForBooking(
  bookingId: string,
  db: Db = prisma,
): Promise<IropsEvent | null> {
  if (Math.random() >= IROP_INJECTION_PROBABILITY) return null;

  const type = pickWeighted(EVENT_TYPE_WEIGHTS);
  const draft = craftEvent(type);

  const created = await db.iropsEvent.create({
    data: {
      bookingId,
      eventType: type,
      severity: draft.severity,
      delayMin: draft.delayMin,
      message: draft.message,
    },
  });
  return created;
}

export type ActiveIropsRow = IropsEvent & {
  booking: {
    id: string;
    route: {
      flightNumber: string;
      departure: { icao: string };
      arrival: { icao: string };
    } | null;
  };
};

export async function getActiveIropsForUser(
  userId: string,
): Promise<ActiveIropsRow[]> {
  return prisma.iropsEvent.findMany({
    where: {
      acknowledgedAt: null,
      // Join through bookingId → Booking — Booking is the
      // authorization root; we only show IROPs whose owning booking
      // belongs to the caller.
      booking: { userId },
    } as Prisma.IropsEventWhereInput,
    include: {
      booking: {
        select: {
          id: true,
          route: {
            select: {
              flightNumber: true,
              departure: { select: { icao: true } },
              arrival: { select: { icao: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  }) as Promise<ActiveIropsRow[]>;
}

export type AckResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'already_acknowledged' };

export async function acknowledgeIropsEvent(
  eventId: string,
  userId: string,
): Promise<AckResult> {
  // updateMany with a where-clause that includes the user-scope
  // guard. If the event doesn't exist OR belongs to a different
  // user OR is already ack'd, updateMany returns count=0 and we
  // surface a clean 'not_found'-ish result without leaking which
  // case it was.
  const result = await prisma.iropsEvent.updateMany({
    where: {
      id: eventId,
      acknowledgedAt: null,
      booking: { userId },
    } as Prisma.IropsEventWhereInput,
    data: { acknowledgedAt: new Date() },
  });
  if (result.count === 0) return { ok: false, reason: 'not_found' };
  return { ok: true, id: eventId };
}

// ─── Event crafting ────────────────────────────────────────

type EventDraft = {
  severity: IropsSeverity;
  delayMin: number;
  message: string;
};

function craftEvent(type: IropsEventType): EventDraft {
  switch (type) {
    case IropsEventType.SLOT_DELAY: {
      // 10-45min push. Most are short; the long tail of 35-45min
      // happens in ~10% of rolls — feels appropriately rare.
      const delay = pickInRange(10, 45);
      return {
        severity: delay > 30 ? IropsSeverity.MAJOR : IropsSeverity.MINOR,
        delayMin: delay,
        message: `ATC slot delay: Abflug-zeit um ${delay} min verschoben. Bitte aktualisiere deinen flight plan entsprechend.`,
      };
    }
    case IropsEventType.GATE_CHANGE: {
      // Gates are random letter+number combos. Use realistic-ish
      // codes; the specific letters don't matter, they're just
      // flavor.
      const from = randomGate();
      const to = randomGate(from);
      return {
        severity: IropsSeverity.MINOR,
        delayMin: 0,
        message: `Gate change: Abflug-gate von ${from} nach ${to} verlegt.`,
      };
    }
    case IropsEventType.WEATHER_HOLD: {
      // Weather holds are the longest and most likely to be MAJOR.
      // 20-60min range.
      const delay = pickInRange(20, 60);
      return {
        severity: delay > 40 ? IropsSeverity.MAJOR : IropsSeverity.MINOR,
        delayMin: delay,
        message: `Weather hold: ${delay} min delay aufgrund von signifikantem Wetter. Check METAR + TAF vor erneutem dispatch.`,
      };
    }
    case IropsEventType.TECH_ISSUE: {
      // Tech issues are typically resolved quickly but always cause
      // some delay. 5-25 min.
      const delay = pickInRange(5, 25);
      const issue = randomTechIssue();
      return {
        severity: IropsSeverity.MINOR,
        delayMin: delay,
        message: `Tech issue: ${issue}. Maintenance arbeitet daran — ${delay} min delay erwartet.`,
      };
    }
    case IropsEventType.CREW_SHUFFLE: {
      // Cosmetic — no delay, no severity. Just flavor.
      const reason = randomCrewReason();
      return {
        severity: IropsSeverity.MINOR,
        delayMin: 0,
        message: `Crew change: ${reason}. Briefing wurde aktualisiert.`,
      };
    }
    case IropsEventType.RUNWAY_CHANGE: {
      const from = randomRunway();
      const to = randomRunway(from);
      return {
        severity: IropsSeverity.MINOR,
        delayMin: 0,
        message: `Runway change: Abflug von Runway ${from} nach ${to} verlegt. Performance-daten neu rechnen.`,
      };
    }
  }
}

// ─── Random helpers ─────────────────────────────────────────

function pickWeighted<K extends string>(weights: Record<K, number>): K {
  const entries = Object.entries(weights) as Array<[K, number]>;
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  // Fallback for floating-point edge case; shouldn't happen in practice.
  return entries[entries.length - 1][0];
}

function pickInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const GATE_LETTERS = ['A', 'B', 'C', 'D', 'E'];
function randomGate(exclude?: string): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const letter = GATE_LETTERS[Math.floor(Math.random() * GATE_LETTERS.length)];
    const num = pickInRange(1, 32);
    const candidate = `${letter}${num}`;
    if (candidate !== exclude) return candidate;
  }
  // Defensive — should never fire with 5 letters × 32 nums in the pool.
  return 'A1';
}

const TECH_ISSUES = [
  'APU-start-failure beim pre-flight check',
  'cabin door indicator falsch',
  'reifen-druck am bug-rad below limit',
  'minor hydraulic leak im equipment bay',
  'transponder zeigt intermittent fault',
  'COM2 radio static — replacement im gang',
];
function randomTechIssue(): string {
  return TECH_ISSUES[Math.floor(Math.random() * TECH_ISSUES.length)];
}

const CREW_REASONS = [
  'Kapitän crew-rest gewechselt — neuer briefing-content',
  'F/O ersetzt wegen duty-time-limit',
  'Cabin-crew umgestellt für sprach-coverage',
  'Senior crew-member dazu gestoßen',
];
function randomCrewReason(): string {
  return CREW_REASONS[Math.floor(Math.random() * CREW_REASONS.length)];
}

const RUNWAYS = ['07L', '07R', '25L', '25R', '18', '36', '09', '27'];
function randomRunway(exclude?: string): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = RUNWAYS[Math.floor(Math.random() * RUNWAYS.length)];
    if (candidate !== exclude) return candidate;
  }
  return '25L';
}

// ─── Display helpers (server + client) ──────────────────────

export function iropsEventTypeLabel(type: IropsEventType): string {
  switch (type) {
    case IropsEventType.SLOT_DELAY: return 'Slot Delay';
    case IropsEventType.GATE_CHANGE: return 'Gate Change';
    case IropsEventType.WEATHER_HOLD: return 'Weather Hold';
    case IropsEventType.TECH_ISSUE: return 'Tech Issue';
    case IropsEventType.CREW_SHUFFLE: return 'Crew Shuffle';
    case IropsEventType.RUNWAY_CHANGE: return 'Runway Change';
  }
}

export function iropsEventTypeEmoji(type: IropsEventType): string {
  switch (type) {
    case IropsEventType.SLOT_DELAY: return '⏰';
    case IropsEventType.GATE_CHANGE: return '🚪';
    case IropsEventType.WEATHER_HOLD: return '⛈️';
    case IropsEventType.TECH_ISSUE: return '🔧';
    case IropsEventType.CREW_SHUFFLE: return '👥';
    case IropsEventType.RUNWAY_CHANGE: return '🛬';
  }
}

export function iropsSeverityStyle(severity: IropsSeverity): {
  bg: string;
  text: string;
  border: string;
} {
  switch (severity) {
    case IropsSeverity.MINOR:
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        text: 'text-amber-800 dark:text-amber-200',
        border: 'border-amber-300 dark:border-amber-700/50',
      };
    case IropsSeverity.MAJOR:
      return {
        bg: 'bg-rose-50 dark:bg-rose-900/20',
        text: 'text-rose-800 dark:text-rose-200',
        border: 'border-rose-300 dark:border-rose-700/50',
      };
  }
}
