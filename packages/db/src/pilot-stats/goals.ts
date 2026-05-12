/**
 * Track 5 #10 — Flight Streaks & Goals.
 *
 * Pilot kann sich selbst ziele setzen (z.B. "5 Flüge pro Woche" oder
 * "20 Stunden pro Monat") und das system trackt streak-counts für
 * aufeinanderfolgende perioden in denen das ziel erfüllt war.
 *
 * # Public API
 *
 * - `listPilotGoals(userId)` — alle goals eines users + computed
 *   currentPeriodProgress + currentPeriodKey
 * - `createPilotGoal(userId, kind, target)` — neues goal anlegen
 * - `updatePilotGoal(goalId, userId, target)` — target ändern
 * - `deletePilotGoal(goalId, userId)` — goal löschen
 * - `evaluatePilotGoals(userId)` — nach PIREP-approval; updated
 *   streak-counts wenn ein neues target-erreicht-event in einer
 *   neuen periode passiert ist
 *
 * # Period-keys (UTC)
 *
 * - Weekly: ISO 8601 week-string "YYYY-Www" (z.B. "2026-W19")
 * - Monthly: "YYYY-MM" (z.B. "2026-05")
 *
 * V1 ist UTC-only. V2 könnte user-timezone berücksichtigen damit
 * pilots in Asien nicht 8h früher in eine neue periode rutschen als
 * europäer.
 *
 * # Streak-Logic
 *
 * Bei jedem evaluator-call:
 *   1. Compute currentPeriodKey (z.B. "2026-W19" für heute).
 *   2. Compute currentPeriodProgress (z.B. count(approved PIREPs in
 *      dieser woche) für WeeklyFlights).
 *   3. Wenn progress >= target UND lastIncrementedPeriod != currentPeriodKey:
 *        a. Wenn lastIncrementedPeriod war die UNMITTELBAR vorherige
 *           periode (oder null bei first-ever increment): streak += 1.
 *        b. Sonst (eine oder mehr perioden verpasst): streak = 1
 *           (current periode ist neuer start).
 *        c. bestStreak = max(bestStreak, currentStreak)
 *        d. lastIncrementedPeriod = currentPeriodKey
 *   4. lastEvaluatedAt = now (immer, für audit-trail)
 *
 * Wenn progress < target in der aktuellen periode: kein update am
 * streak-counter. Der "streak-reset bei missed period"-fall passiert
 * implicit erst beim NÄCHSTEN erfolgreichen increment (siehe 3b).
 * Bedeutet: ein dashboard das den streak anzeigt sollte zusätzlich
 * checken ob die periode seit dem last-increment noch aktuell ist —
 * sonst wird ein "alter" streak fälschlich als aktiv dargestellt.
 *
 * # Performance
 *
 * Pro evaluator-call: 1 query für goals + N queries (count/sum) pro
 * kind, parallel. Bei <5 goals pro user ist das trivial.
 */

import { prisma } from "../index.js";
import type { PilotGoal, PilotGoalKind } from "@prisma/client";

const APPROVED_FILTER = { status: "Approved" as const };

// ─────────────────────────────────────────────────────────────────────
// Period-key helpers (UTC)
// ─────────────────────────────────────────────────────────────────────

/**
 * Returnt den ISO-week-key für ein date.
 * Format: "YYYY-Www" (z.B. "2026-W19").
 *
 * ISO-week: Mo-So, week 1 ist die woche mit dem ersten donnerstag des
 * jahres. Edge-case: Jan 1 kann in week 52/53 des vorjahres liegen.
 */
export function getWeekKey(d: Date): string {
  // Algorithmus aus ISO 8601: thursday-trick.
  // Step 1: copy date, set to nearest thursday (current date + 4 - currentDay)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayOfWeek = t.getUTCDay() || 7; // Sonntag=0 → 7
  t.setUTCDate(t.getUTCDate() + 4 - dayOfWeek);
  // Step 2: get first day of the year
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  // Step 3: calculate full weeks to nearest thursday
  const weekNum = Math.ceil(
    ((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Returnt den monthly-key für ein date.
 * Format: "YYYY-MM" (z.B. "2026-05").
 */
export function getMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Returnt start + end (exclusive) der periode für einen period-key.
 * Wird vom evaluator gebraucht um die PIREP-counts der aktuellen
 * periode zu fetchen.
 */
export function getPeriodRange(
  kind: PilotGoalKind,
  reference: Date,
): { start: Date; end: Date } {
  if (kind === "WeeklyFlights" || kind === "WeeklyHours") {
    // ISO-week: monday 00:00 UTC bis next monday 00:00 UTC
    const d = new Date(
      Date.UTC(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate(),
      ),
    );
    const dayOfWeek = d.getUTCDay() || 7;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - (dayOfWeek - 1));
    monday.setUTCHours(0, 0, 0, 0);
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(monday.getUTCDate() + 7);
    return { start: monday, end: nextMonday };
  }
  // MonthlyFlights / MonthlyHours
  const start = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    ),
  );
  return { start, end };
}

/**
 * Returnt den period-key für eine kind+date kombination.
 */
export function getPeriodKey(kind: PilotGoalKind, d: Date): string {
  if (kind === "WeeklyFlights" || kind === "WeeklyHours") return getWeekKey(d);
  return getMonthKey(d);
}

/**
 * Returnt den period-key der periode IMMEDIATELY BEFORE der gegebenen.
 * Wird vom streak-logic gebraucht um "war der letzte increment in der
 * direkt vorherigen periode oder weiter zurück" zu checken.
 */
export function getPreviousPeriodKey(
  kind: PilotGoalKind,
  currentReference: Date,
): string {
  if (kind === "WeeklyFlights" || kind === "WeeklyHours") {
    const prev = new Date(currentReference);
    prev.setUTCDate(prev.getUTCDate() - 7);
    return getWeekKey(prev);
  }
  const prev = new Date(
    Date.UTC(
      currentReference.getUTCFullYear(),
      currentReference.getUTCMonth() - 1,
      15, // mid-month damit edge-cases bei "31.→30." nicht ins falsche month fallen
    ),
  );
  return getMonthKey(prev);
}

// ─────────────────────────────────────────────────────────────────────
// Progress query — wieviele PIREPs/stunden in der aktuellen periode
// ─────────────────────────────────────────────────────────────────────

async function getCurrentPeriodProgress(
  userId: string,
  kind: PilotGoalKind,
  reference: Date = new Date(),
): Promise<number> {
  const { start, end } = getPeriodRange(kind, reference);
  const where = {
    userId,
    ...APPROVED_FILTER,
    submittedAt: { gte: start, lt: end },
  };

  if (kind === "WeeklyFlights" || kind === "MonthlyFlights") {
    return prisma.pirep.count({ where });
  }
  // WeeklyHours / MonthlyHours
  const agg = await prisma.pirep.aggregate({
    where,
    _sum: { flightTimeMin: true },
  });
  return Math.round((agg._sum.flightTimeMin ?? 0) / 60);
}

// ─────────────────────────────────────────────────────────────────────
// Public CRUD
// ─────────────────────────────────────────────────────────────────────

export type PilotGoalWithProgress = PilotGoal & {
  currentPeriodKey: string;
  currentPeriodProgress: number;
  /** "is the streak still active?" — true wenn lastIncrementedPeriod ist
   *  die current oder die direkt vorherige periode (= streak hat nicht
   *  schon abgerissen seit dem letzten increment). Bei null = noch nie
   *  inkrementiert → false. */
  streakActive: boolean;
};

export async function listPilotGoals(
  userId: string,
): Promise<PilotGoalWithProgress[]> {
  const goals = await prisma.pilotGoal.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  // Pro goal: progress in der current period berechnen.
  const now = new Date();
  return Promise.all(
    goals.map(async (g) => {
      const periodKey = getPeriodKey(g.kind, now);
      const progress = await getCurrentPeriodProgress(userId, g.kind, now);
      const prevKey = getPreviousPeriodKey(g.kind, now);
      const streakActive =
        g.lastIncrementedPeriod === periodKey ||
        g.lastIncrementedPeriod === prevKey;
      return {
        ...g,
        currentPeriodKey: periodKey,
        currentPeriodProgress: progress,
        streakActive,
      };
    }),
  );
}

export async function createPilotGoal(
  userId: string,
  kind: PilotGoalKind,
  target: number,
): Promise<PilotGoal> {
  if (target <= 0) throw new Error("Target muss > 0 sein.");
  if (target > 10000) throw new Error("Target ist absurd hoch (max 10000).");
  return prisma.pilotGoal.create({
    data: { userId, kind, target },
  });
}

export async function updatePilotGoal(
  goalId: string,
  userId: string,
  target: number,
): Promise<PilotGoal> {
  if (target <= 0) throw new Error("Target muss > 0 sein.");
  if (target > 10000) throw new Error("Target ist absurd hoch (max 10000).");
  // Owner-check via where-clause: wenn goal nicht zum user gehört,
  // updateMany returnt count=0 und wir werfen.
  const result = await prisma.pilotGoal.updateMany({
    where: { id: goalId, userId },
    data: { target },
  });
  if (result.count === 0) {
    throw new Error("Goal nicht gefunden oder gehört dir nicht.");
  }
  const updated = await prisma.pilotGoal.findUnique({ where: { id: goalId } });
  if (!updated) throw new Error("Goal nach update nicht gefunden.");
  return updated;
}

export async function deletePilotGoal(
  goalId: string,
  userId: string,
): Promise<void> {
  const result = await prisma.pilotGoal.deleteMany({
    where: { id: goalId, userId },
  });
  if (result.count === 0) {
    throw new Error("Goal nicht gefunden oder gehört dir nicht.");
  }
}

// ─────────────────────────────────────────────────────────────────────
// Evaluator — wird nach PIREP-approval aufgerufen
// ─────────────────────────────────────────────────────────────────────

export type GoalEvaluationResult = {
  goalId: string;
  kind: PilotGoalKind;
  newStreak: number;
  bestStreak: number;
  incrementedThisCall: boolean;
};

/**
 * Läuft nach jeder PIREP-approval. Checkt jedes goal des users:
 *   - Aktuelle periode target erreicht? → eventuell streak increment
 *   - Bereits in dieser periode inkrementiert? → skip (idempotent)
 *
 * Returnt array of results (für eventuelle UI-toasts). Fire-and-forget
 * compatible: errors werden vom caller geschluckt.
 */
export async function evaluatePilotGoals(
  userId: string,
): Promise<GoalEvaluationResult[]> {
  const goals = await prisma.pilotGoal.findMany({ where: { userId } });
  if (goals.length === 0) return [];

  const now = new Date();
  const results: GoalEvaluationResult[] = [];

  for (const g of goals) {
    const currentPeriodKey = getPeriodKey(g.kind, now);

    // Idempotent: schon in dieser periode inkrementiert → nichts tun.
    if (g.lastIncrementedPeriod === currentPeriodKey) {
      await prisma.pilotGoal.update({
        where: { id: g.id },
        data: { lastEvaluatedAt: now },
      });
      results.push({
        goalId: g.id,
        kind: g.kind,
        newStreak: g.currentStreak,
        bestStreak: g.bestStreak,
        incrementedThisCall: false,
      });
      continue;
    }

    const progress = await getCurrentPeriodProgress(userId, g.kind, now);
    if (progress < g.target) {
      // Noch nicht erreicht — nur lastEvaluatedAt refreshen.
      await prisma.pilotGoal.update({
        where: { id: g.id },
        data: { lastEvaluatedAt: now },
      });
      results.push({
        goalId: g.id,
        kind: g.kind,
        newStreak: g.currentStreak,
        bestStreak: g.bestStreak,
        incrementedThisCall: false,
      });
      continue;
    }

    // Target erreicht in einer noch nicht inkrementierten periode →
    // streak-update. Continued-streak vs broken-streak:
    const prevPeriodKey = getPreviousPeriodKey(g.kind, now);
    const continued =
      g.lastIncrementedPeriod === prevPeriodKey ||
      g.lastIncrementedPeriod === null;
    const newStreak = continued ? g.currentStreak + 1 : 1;
    const newBest = Math.max(g.bestStreak, newStreak);

    await prisma.pilotGoal.update({
      where: { id: g.id },
      data: {
        currentStreak: newStreak,
        bestStreak: newBest,
        lastIncrementedPeriod: currentPeriodKey,
        lastEvaluatedAt: now,
      },
    });

    results.push({
      goalId: g.id,
      kind: g.kind,
      newStreak,
      bestStreak: newBest,
      incrementedThisCall: true,
    });
  }

  return results;
}
