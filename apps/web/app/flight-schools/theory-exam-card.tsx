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
