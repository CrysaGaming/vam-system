'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { startExamAction } from './actions';

interface PastAttempt {
  id: string;
  startedAt: Date;
  submittedAt: Date | null;
  scorePercent: number | null;
  passed: boolean | null;
}

interface Props {
  enrollmentId: string;
  schoolId: string;
  /** Hat der pilot den theory-test schon bestanden? */
  theoryExamPassedAt: Date | null;
  theoryExamScore: number | null;
  /** Anzahl bisheriger versuche (egal ob passed/failed). */
  attemptCount: number;
  /** Falls running attempt existiert: dessen id für resume-button. */
  activeAttemptId: string | null;
  /** Bisherige attempts (max 5 für UI-kompaktheit), neueste zuerst. */
  recentAttempts: PastAttempt[];
  /** Pass-mark in % für UI-anzeige. */
  passMarkPercent: number;
}

/**
 * Theory-Exam-card im enrollment-block (Welle 13E-13c).
 *
 * Drei states:
 *
 *   PASSED: Pilot hat schon bestanden. Card zeigt grünen check + score
 *   und einen kleinen review-link zum letzten attempt. Kein neuer
 *   start-button — passed-state ist sticky (kein re-take nötig, das wäre
 *   ein "best-pass-policy"-bruch).
 *
 *   ACTIVE-ATTEMPT: Es gibt einen running attempt. Card zeigt "Prüfung
 *   im Gange" + "Fortsetzen"-button der direkt zur quiz-page navigiert.
 *
 *   AVAILABLE: Kein running attempt, noch nicht passed. Card zeigt
 *   "Prüfung starten"-button + recent attempts wenn vorhanden (failed
 *   attempts mit score).
 *
 * Start-flow: Click → startExamAction → bekommt attemptId zurück →
 * router.push auf quiz-page. Wenn die action wirft (z.B. \"keine fragen
 * für deine lizenz\"), zeigen wir den fehler inline.
 *
 * Recent-attempts-history: max 5 angezeigt, ältere via "alle anzeigen"
 * würde theoretisch auf eine separate history-page führen — aktuell
 * (MVP) nicht implementiert weil 5 attempts schon mehr als typisch sind.
 */
export function TheoryExamCard({
  enrollmentId,
  schoolId,
  theoryExamPassedAt,
  theoryExamScore,
  attemptCount,
  activeAttemptId,
  recentAttempts,
  passMarkPercent,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isPassed = theoryExamPassedAt !== null;
  const lastFinishedAttempt = recentAttempts.find(
    (a) => a.submittedAt !== null,
  );

  // Score-stats für trend-display (option #25). Wir berücksichtigen nur
  // submitted attempts (scorePercent !== null). Best-score wird als
  // motivations-anchor in den header gerendert; das delta-zu-pass-mark
  // (only on most-recent-failed) zeigt dem pilot wie nah er war.
  const finishedAttempts = recentAttempts.filter(
    (a) => a.submittedAt !== null && a.scorePercent !== null,
  );
  const bestScore = finishedAttempts.length
    ? Math.max(...finishedAttempts.map((a) => a.scorePercent!))
    : null;
  // "Dir fehlten X%" — nur wenn der LETZTE finished attempt failed war
  // (sonst irreführend). Sortierung in recentAttempts ist DESC by
  // startedAt, also ist der erste finished automatisch der neueste.
  const lastFailedDelta =
    lastFinishedAttempt &&
    lastFinishedAttempt.passed === false &&
    lastFinishedAttempt.scorePercent !== null
      ? passMarkPercent - lastFinishedAttempt.scorePercent
      : null;

  function handleStart() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await startExamAction({ enrollmentId });
        router.push(`/flight-schools/${schoolId}/exam/${res.attemptId}`);
        // Bewusst kein toast für bankTooSmall hier — die quiz-page selbst
        // könnte das anzeigen, aber im MVP ignorieren wir das warning
        // weil die starter-bank groß genug ist (50 fragen für PPL).
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold">📝 Theorie-Prüfung</h3>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Best-score-badge (option #25): explicit positive anchor.
              Sichtbar wenn mindestens ein submitted-attempt vorliegt UND
              passed-state nicht via theoryExamPassedAt explicit gesetzt
              ist (in dem fall zeigen wir den passed-score schon im
              ✓-Bestanden-badge rechts). */}
          {!isPassed && bestScore !== null && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-mono font-semibold">
              Bester: {bestScore.toFixed(1)}%
            </span>
          )}
          {isPassed && (
            <span className="text-xs font-mono font-semibold text-green-700 dark:text-green-400">
              ✓ Bestanden
              {theoryExamScore !== null && ` · ${theoryExamScore.toFixed(1)}%`}
            </span>
          )}
          {!isPassed && activeAttemptId && (
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              ⏳ Im Gange
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* PASSED state */}
      {isPassed && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Du hast die Theorie-Prüfung am{' '}
            {theoryExamPassedAt!.toLocaleDateString('de-DE')} bestanden.
            Der praktische Teil wird im nächsten Schritt freigeschaltet.
          </p>
          {lastFinishedAttempt && (
            <Link
              href={`/flight-schools/${schoolId}/exam/${lastFinishedAttempt.id}`}
              className="inline-block text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Letzten Versuch ansehen →
            </Link>
          )}
        </div>
      )}

      {/* ACTIVE-ATTEMPT state */}
      {!isPassed && activeAttemptId && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Du hast eine laufende Prüfung. Du kannst sie jederzeit
            fortsetzen und abgeben — deine bisherigen Antworten sind
            gespeichert.
          </p>
          <Link
            href={`/flight-schools/${schoolId}/exam/${activeAttemptId}`}
            className="inline-block px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-semibold transition"
          >
            Prüfung fortsetzen →
          </Link>
        </div>
      )}

      {/* AVAILABLE state — kein active, nicht passed */}
      {!isPassed && !activeAttemptId && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {attemptCount === 0
              ? 'Bereit für die Theorie-Prüfung? 20 Multiple-Choice-Fragen, '
              : `Bisher ${attemptCount} Versuch${attemptCount === 1 ? '' : 'e'} — `}
            Bestehensgrenze {passMarkPercent}%.
          </p>
          {/* Distance-to-pass-hint (option #25). Nur nach failed attempt
              sichtbar; encouraging tone wenn die delta klein ist (<5%),
              sonst neutral. Hilft dem pilot zu sehen ob "knapp daneben"
              oder "viel zu lernen". */}
          {lastFailedDelta !== null && (
            <p className="text-xs text-gray-600 dark:text-gray-400 px-3 py-2 rounded border bg-indigo-500/5 border-indigo-500/20">
              {lastFailedDelta < 5 ? '🎯' : '📚'} Dir fehlten{' '}
              <span className="font-mono font-semibold">
                {lastFailedDelta.toFixed(1)}%
              </span>{' '}
              beim letzten Versuch
              {lastFailedDelta < 5
                ? ' — du warst nah dran!'
                : ' — der nächste Versuch sitzt.'}
            </p>
          )}
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
          >
            {pending
              ? 'Starte…'
              : attemptCount === 0
                ? 'Prüfung starten'
                : 'Erneut versuchen'}
          </button>
        </div>
      )}

      {/* Score-trend chart (option #25). Nur sichtbar wenn ≥ 2 finished
          attempts vorliegen — bei 1 attempt ist die existing list
          informativ genug. Dargestellt als horizontale bar-zeile in
          chronologischer reihenfolge (älteste links → neueste rechts),
          mit gestrichelter pass-mark-line. So sieht der pilot trends
          (improving / declining) auf einen blick. */}
      {finishedAttempts.length >= 2 && (
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
            Trend
          </p>
          <ScoreTrendChart
            attempts={finishedAttempts}
            passMarkPercent={passMarkPercent}
          />
        </div>
      )}

      {/* History (alle states außer first-time-not-started) */}
      {recentAttempts.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
            Versuche
          </p>
          <ul className="space-y-1 text-xs">
            {recentAttempts.slice(0, 5).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-gray-500 dark:text-gray-500">
                  {a.startedAt.toLocaleDateString('de-DE')}
                </span>
                <span className="flex items-center gap-2">
                  {a.submittedAt === null ? (
                    <span className="text-amber-600 dark:text-amber-400 italic">
                      laufend
                    </span>
                  ) : a.passed ? (
                    <span className="text-green-700 dark:text-green-400 font-mono">
                      ✓ {a.scorePercent?.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-red-700 dark:text-red-400 font-mono">
                      ✗ {a.scorePercent?.toFixed(1)}%
                    </span>
                  )}
                  {a.submittedAt !== null && (
                    <Link
                      href={`/flight-schools/${schoolId}/exam/${a.id}`}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Details
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Score-trend mini-chart (option #25).
 *
 * Renders score-history als horizontale bar-zeile mit pass-mark-referenz-
 * linie. Bars sind absteigend sortiert by startedAt — d.h. älteste links,
 * neueste rechts (umgekehrt zur recentAttempts-default-sortierung). So
 * liest sich der trend chronologisch wie eine zeitleiste.
 *
 * Visuelle dimensionen:
 *   - Bar-höhe encodiert score% (0-100). 100% = full height (40px).
 *   - Bar-farbe: green wenn passed, red wenn failed.
 *   - Pass-mark line ist eine gestrichelte horizontale linie auf der
 *     entsprechenden Y-position. Damit sieht der pilot, welche bars
 *     darüber/darunter sind.
 *
 * SVG inline weil das ohne externe lib (recharts) trivial ist und kein
 * client-bundle-overhead. Width responsive via 100% (preserveAspectRatio
 * none); fixed height 60px reicht für glance-readability.
 */
function ScoreTrendChart({
  attempts,
  passMarkPercent,
}: {
  attempts: PastAttempt[];
  passMarkPercent: number;
}) {
  // Reverse-chronological → chronological für trend-reading.
  const chrono = [...attempts].reverse();
  const n = chrono.length;
  // SVG-koordinaten: 0..100 X (% width), 0..100 Y (% height — wir flipen
  // beim rendern damit höhere scores oben sind).
  const barWidth = 100 / n - 2; // 2 units gap zwischen bars
  const passMarkY = 100 - passMarkPercent; // flip
  return (
    <div className="relative w-full">
      <svg
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
        className="w-full h-12"
        role="img"
        aria-label={`Score-Trend der letzten ${n} Versuche`}
      >
        {/* Pass-mark reference-line. Gestrichelt, dezent grau, damit es
            als sekundäre information lesbar ist ohne mit den bars zu
            konkurrieren. */}
        <line
          x1="0"
          x2="100"
          y1={passMarkY * 0.6}
          y2={passMarkY * 0.6}
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="2 1.5"
          className="text-gray-400 dark:text-gray-600"
        />
        {/* Bars in chronological order. */}
        {chrono.map((a, idx) => {
          const score = a.scorePercent ?? 0;
          const barHeight = (score / 100) * 60;
          const x = idx * (barWidth + 2);
          const y = 60 - barHeight;
          const colorClass = a.passed
            ? 'fill-green-500/70 dark:fill-green-500/60'
            : 'fill-red-500/70 dark:fill-red-500/60';
          return (
            <rect
              key={a.id}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={0.5}
              className={colorClass}
            >
              <title>
                {a.startedAt.toLocaleDateString('de-DE')}: {score.toFixed(1)}%{' '}
                {a.passed ? '(bestanden)' : '(nicht bestanden)'}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="flex items-baseline justify-between text-[10px] text-gray-500 dark:text-gray-500 mt-1">
        <span>älter</span>
        <span className="font-mono">Pass-Mark {passMarkPercent}%</span>
        <span>neuer</span>
      </div>
    </div>
  );
}
