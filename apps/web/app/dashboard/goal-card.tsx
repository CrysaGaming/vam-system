'use client';

import { useState, useTransition } from 'react';
import { saveAnnualHourGoal } from './goal-actions';

/**
 * Track 4 #59 (Section K): Annual Goal-Tracking Card.
 *
 * Zwei zustände:
 *   1. Pilot hat noch kein ziel gesetzt (annualHourGoal=null) → CTA + inline
 *      input zum setzen. Default-suggestion 100h ist im input vorausgefüllt
 *      (entspricht ~2h pro woche, was für hobby-piloten realistisch ist).
 *   2. Pilot hat ein ziel → progress-bar mit current-year hours / goal,
 *      hours remaining, projected pace bis jahresende, edit-button (chevron).
 *
 * "Projected pace": linear-extrapolation aus den bisherigen daten. Wenn
 * pilot bei tag-200-of-365 65h hat (von 100h goal): rate = 65/200 = 0.325
 * h/day → projection für full year = 0.325 * 365 = 118.6h. Wird als
 * "Bei aktuellem tempo: 118h" angezeigt, color-coded:
 *   - emerald wenn projection >= goal (on track / ahead)
 *   - amber wenn projection >= goal*0.75 (behind but recoverable)
 *   - rose wenn projection < goal*0.75 (way behind)
 *
 * Edge: anfang des jahres (day < 14) → keine projection, zu früh für
 * sinnvolle extrapolation. Anstatt "Bei aktuellem tempo: 0h" zeigen wir
 * nur den progress-balken ohne forecast.
 *
 * Server-action validation: int range 10..2000, throws on out-of-range.
 * Client zeigt error-state aus useTransition-error-callback.
 *
 * Bewusst client-component statt server-action im form-action attribute
 * direkt — wir wollen optimistic-UI + clear-after-save + editable-state
 * toggle, was reaktiven state braucht.
 */
export function GoalCard({
  userId,
  currentGoal,
  currentYearHours,
  dayOfYear,
  daysInYear,
}: {
  userId: string;
  currentGoal: number | null;
  currentYearHours: number;
  dayOfYear: number;
  daysInYear: number;
}) {
  // editing=true wenn user grade das ziel setzt/ändert. Bei initial null-goal
  // ist editing=true der default (CTA-view ist effektiv die edit-form).
  const [editing, setEditing] = useState(currentGoal === null);
  const [draftGoal, setDraftGoal] = useState<string>(
    currentGoal !== null ? String(currentGoal) : '100',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const goal = currentGoal;
  const progressPct = goal ? Math.min(100, (currentYearHours / goal) * 100) : 0;
  const hoursRemaining = goal ? Math.max(0, goal - currentYearHours) : 0;
  const daysLeft = daysInYear - dayOfYear;

  // Projection nur wenn wir genug daten haben (>= 14 tage des jahres).
  // Sonst ist die extrapolation zu noisy (z.B. 5h in 7 tagen → projection
  // 260h, was sinnlos für goal-feedback ist).
  const canProject = dayOfYear >= 14 && goal !== null;
  const projectedTotal = canProject ? (currentYearHours / dayOfYear) * daysInYear : 0;
  const projectionColor = canProject
    ? projectedTotal >= goal!
      ? 'text-emerald-600 dark:text-emerald-400'
      : projectedTotal >= goal! * 0.75
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400'
    : 'text-gray-500';

  function submit() {
    const parsed = parseInt(draftGoal, 10);
    if (!Number.isFinite(parsed) || parsed < 10 || parsed > 2000) {
      setError('Bitte ein ziel zwischen 10 und 2000 stunden eingeben.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await saveAnnualHourGoal(userId, parsed);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Konnte ziel nicht speichern.');
      }
    });
  }

  function clearGoal() {
    setError(null);
    startTransition(async () => {
      try {
        await saveAnnualHourGoal(userId, null);
        setDraftGoal('100');
        setEditing(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Konnte ziel nicht entfernen.');
      }
    });
  }

  return (
    <section className="mt-6 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wider text-gray-500">
          🎯 Jahresziel {new Date().getFullYear()}
        </h2>
        {goal !== null && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Bearbeiten
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {goal === null
              ? 'Setze dir ein ziel für dieses jahr — wir verfolgen deinen progress automatisch aus deinen approved PIREPs.'
              : 'Neues ziel setzen oder bestehendes ändern:'}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <input
                type="number"
                min={10}
                max={2000}
                step={10}
                value={draftGoal}
                onChange={(e) => setDraftGoal(e.target.value)}
                disabled={pending}
                className="w-32 px-3 py-2 pr-10 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-base font-mono tabular-nums focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                aria-label="Jahresziel in stunden"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                h
              </span>
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition"
            >
              {pending ? 'Speichert…' : goal === null ? 'Ziel setzen' : 'Speichern'}
            </button>
            {goal !== null && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraftGoal(String(goal));
                    setError(null);
                  }}
                  disabled={pending}
                  className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={clearGoal}
                  disabled={pending}
                  className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:underline"
                >
                  Ziel entfernen
                </button>
              </>
            )}
          </div>
          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Reichweite: 10–2000 stunden. Tipp: ~100h = casual hobby-pilot,
            ~500h = enthusiast, ~1500h+ = ernsthafter sim-pilot.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Progress display */}
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="text-3xl font-bold tabular-nums">
              {currentYearHours.toFixed(1)}
              <span className="text-base font-normal text-gray-500 ml-1">
                / {goal} h
              </span>
            </p>
            <span className="text-sm font-mono px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
              {progressPct.toFixed(0)}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-4 pt-2 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Verbleibend
              </p>
              <p className="font-mono tabular-nums">
                {hoursRemaining.toFixed(1)} h
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Tage übrig
              </p>
              <p className="font-mono tabular-nums">{daysLeft}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Tempo
              </p>
              {canProject ? (
                <p className={`font-mono tabular-nums ${projectionColor}`}>
                  ~{projectedTotal.toFixed(0)} h
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-500 italic">
                  zu früh
                </p>
              )}
            </div>
          </div>

          {canProject && (
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {projectedTotal >= goal!
                ? '✓ Bei aktuellem tempo erreichst du dein ziel.'
                : projectedTotal >= goal! * 0.75
                  ? '↗ Etwas mehr fliegen würde gut tun.'
                  : '⚠ Aktuelles tempo reicht nicht — entweder ziel anpassen oder häufiger fliegen.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
