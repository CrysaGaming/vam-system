/**
 * Track 5 #10 — Pilot Goals Page.
 *
 * Route: /me/goals
 *
 * Pilot kann seine eigenen ziele (Weekly/Monthly Flights/Hours) verwalten
 * und sieht streaks + current-period progress.
 *
 * # Sections
 *
 * 1. Header + intro
 * 2. Goals-list — pro existing goal eine card mit:
 *    - kind-label + target + delete-button
 *    - progress-bar (current period progress / target)
 *    - currentStreak + bestStreak badges
 *    - streakActive indicator (🔥 wenn aktiv, sonst grayed-out)
 *    - inline edit-form (target ändern)
 * 3. Add-goal form (kind-dropdown + target-input)
 *
 * # Auth
 *
 * Logged-in only. Sonst → / redirect.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { listPilotGoals, type PilotGoalKind } from '@vam/db';
import {
  createGoalAction,
  updateGoalAction,
  deleteGoalAction,
} from './actions';

const KIND_LABELS: Record<PilotGoalKind, { label: string; unit: string; emoji: string }> = {
  WeeklyFlights: { label: 'Flüge pro Woche', unit: 'Flüge', emoji: '✈️' },
  WeeklyHours: { label: 'Stunden pro Woche', unit: 'h', emoji: '⏱️' },
  MonthlyFlights: { label: 'Flüge pro Monat', unit: 'Flüge', emoji: '📅' },
  MonthlyHours: { label: 'Stunden pro Monat', unit: 'h', emoji: '📊' },
};

export default async function GoalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const goals = await listPilotGoals(session.user.id);

  // Welche kinds hat der user schon? Dropdown-options für add-form
  // schließen die existing kinds aus (sonst @@unique-violation).
  const usedKinds = new Set(goals.map((g) => g.kind));
  const availableKinds = (Object.keys(KIND_LABELS) as PilotGoalKind[]).filter(
    (k) => !usedKinds.has(k),
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-3xl mx-auto">
        {/* ── Header ── */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold flex items-baseline gap-3">
            Meine Ziele 🎯
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Setze dir wöchentliche oder monatliche flugziele. Das system
            trackt aufeinanderfolgende perioden in denen du dein ziel erreicht
            hast (streak). Period-grenzen werden in UTC berechnet.
          </p>
        </header>

        {/* ── Goals-list ── */}
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-3">
            Deine Ziele ({goals.length})
          </h2>
          {goals.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
              <p className="text-sm text-gray-500">
                Noch keine ziele gesetzt. Lege unten dein erstes ziel an.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {goals.map((g) => {
                const meta = KIND_LABELS[g.kind];
                const pct = Math.min(
                  100,
                  Math.round((g.currentPeriodProgress / g.target) * 100),
                );
                const reached = g.currentPeriodProgress >= g.target;

                return (
                  <article
                    key={g.id}
                    className={`bg-white dark:bg-gray-900 border rounded-lg p-5 ${
                      reached
                        ? 'border-emerald-500/40'
                        : 'border-gray-200 dark:border-gray-800'
                    }`}
                  >
                    {/* Header row: kind + target + streaks + delete */}
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="text-lg font-bold flex items-center gap-2">
                          <span aria-hidden="true">{meta.emoji}</span>
                          {meta.label}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Ziel:{' '}
                          <span className="font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                            {g.target.toLocaleString('de-DE')} {meta.unit}
                          </span>
                          {' · '}
                          Aktuelle periode:{' '}
                          <span className="font-mono">{g.currentPeriodKey}</span>
                        </p>
                      </div>
                      <form action={deleteGoalAction}>
                        <input type="hidden" name="goalId" value={g.id} />
                        <button
                          type="submit"
                          className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                          aria-label="Goal löschen"
                        >
                          🗑️ Löschen
                        </button>
                      </form>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-4">
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                          Fortschritt
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          {g.currentPeriodProgress.toLocaleString('de-DE')} /{' '}
                          {g.target.toLocaleString('de-DE')} {meta.unit}
                          {reached && (
                            <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                              ✓ erreicht
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            reached ? 'bg-emerald-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Streak badges */}
                    <div className="flex items-center gap-3 flex-wrap mb-4">
                      <div
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${
                          g.streakActive && g.currentStreak > 0
                            ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        <span aria-hidden="true">
                          {g.streakActive && g.currentStreak > 0 ? '🔥' : '💤'}
                        </span>
                        <span>
                          Aktuell:{' '}
                          <span className="tabular-nums">{g.currentStreak}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                        <span aria-hidden="true">🏆</span>
                        <span>
                          Best:{' '}
                          <span className="tabular-nums">{g.bestStreak}</span>
                        </span>
                      </div>
                      {!g.streakActive && g.currentStreak > 0 && (
                        <span className="text-xs text-gray-500 italic">
                          (streak nicht mehr aktiv — periode verpasst)
                        </span>
                      )}
                    </div>

                    {/* Inline edit-form */}
                    <form
                      action={updateGoalAction}
                      className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-800"
                    >
                      <input type="hidden" name="goalId" value={g.id} />
                      <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider">
                        Neues Target:
                      </label>
                      <input
                        type="number"
                        name="target"
                        defaultValue={g.target}
                        min={1}
                        max={10000}
                        className="w-24 px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 tabular-nums"
                      />
                      <button
                        type="submit"
                        className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition"
                      >
                        Speichern
                      </button>
                    </form>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Add-goal form ── */}
        {availableKinds.length > 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              ➕ Neues Ziel anlegen
            </h2>
            <form
              action={createGoalAction}
              className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end"
            >
              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
                  Art
                </span>
                <select
                  name="kind"
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                >
                  {availableKinds.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k].emoji} {KIND_LABELS[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
                  Target
                </span>
                <input
                  type="number"
                  name="target"
                  required
                  min={1}
                  max={10000}
                  defaultValue={5}
                  className="w-28 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 tabular-nums"
                />
              </label>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded transition"
              >
                Anlegen
              </button>
            </form>
            <p className="text-[10px] text-gray-500 mt-3">
              Pro art (Weekly Flights / Hours, Monthly Flights / Hours) kannst
              du genau ein ziel haben.
            </p>
          </section>
        ) : (
          <section className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-700/40 rounded-lg p-6 text-center">
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              ✓ Du hast für alle 4 ziel-arten ein ziel gesetzt. Maximum erreicht.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
