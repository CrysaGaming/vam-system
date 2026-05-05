'use client';

import { useState, useTransition, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  saveExamAnswerAction,
  submitExamAction,
  type SubmitExamActionResult,
} from '../../../actions';

/**
 * Public-shape einer question wie sie zum client kommt. Server STRIPPED
 * correctIndex + explanation für in-progress attempts (siehe page.tsx).
 * Bei review-mode (submittedAt != null) sind die felder ausgefüllt damit
 * pilot sich die richtigen antworten anschauen kann.
 */
export interface ExamQuestionPublic {
  id: string;
  questionText: string;
  options: string[];
  /** Nur bei review (submittedAt != null) gefüllt — sonst null. */
  correctIndex: number | null;
  /** Nur bei review gefüllt — sonst null. */
  explanation: string | null;
}

interface Props {
  attemptId: string;
  schoolId: string;
  questions: ExamQuestionPublic[];
  /** Vorab-gespeicherte answers (z.B. nach reload während laufendem attempt). */
  initialAnswers: number[];
  /** Wenn true: review-mode (kein editing, zeigt korrekte antworten). */
  isSubmitted: boolean;
  /** Bei review: pre-computed result aus dem attempt-row. */
  reviewScore?: { scorePercent: number; passed: boolean } | null;
  /** Pass-mark in % für UI-anzeige. */
  passMarkPercent: number;
}

/**
 * Quiz-runner für theory-exam (Welle 13E-13c).
 *
 * Zwei modi:
 *
 *   IN-PROGRESS (isSubmitted=false):
 *     - Pilot wählt antworten, kann zwischen fragen springen
 *     - Auto-save nach jedem klick via debounced server-action
 *     - "Abgeben"-button am ende (mit confirm wenn ungelöste fragen)
 *     - Nach submit: full reload (router.refresh) damit page neu in
 *       review-mode rendered
 *
 *   REVIEW (isSubmitted=true):
 *     - Read-only, zeigt für jede frage die richtige antwort + erklärung
 *     - Header mit final score + pass/fail-status
 *     - Kein submit-button, navigation nur durch fragen
 *
 * State-design: answers[] ist die source-of-truth client-side. Bei in-
 * progress wird jede änderung server-side persistiert via saveExamAnswer-
 * Action (fire-and-forget mit lokalem error-banner falls fail). Bei
 * page-reload wird der state aus initialAnswers (server-side gefetcht)
 * rehydriert — kein verlust.
 *
 * UX-detail: progress-anzeige oben mit current/total + balken zeigt wie
 * viele fragen schon beantwortet sind (nicht: wie weit der pilot durch
 * die liste gescrollt ist). Antworten = answers[i] !== -1 && != undefined.
 *
 * Submit-confirm: wenn ungelöste fragen existieren, dialog mit "X Fragen
 * unbeantwortet — trotzdem abgeben?". Falls alle gelöst, direkter submit.
 *
 * Race-edge: wenn pilot mehrere antworten in schneller folge klickt,
 * können save-actions out-of-order ankommen. Akzeptabel weil server
 * immer den client-side full-state mit submitFinalAnswers überschreibt
 * — die zwischen-saves sind nur für reload-resume, nicht für scoring.
 */
export function ExamRunner({
  attemptId,
  schoolId,
  questions,
  initialAnswers,
  isSubmitted,
  reviewScore,
  passMarkPercent,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Pad initialAnswers auf länge questions[] mit -1 (skipped). Pilot kann
  // dadurch im UI von anfang an zu jeder frage springen ohne dass
  // currentIndex out-of-bounds wird.
  const paddedInitial = useMemo(() => {
    const a = [...initialAnswers];
    while (a.length < questions.length) a.push(-1);
    return a;
  }, [initialAnswers, questions.length]);

  const [answers, setAnswers] = useState<number[]>(paddedInitial);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitExamActionResult | null>(
    null,
  );

  // Track ob ein save in-flight ist — verhindert UI-flicker wenn user
  // schnell clickt. Zeigt einen kleinen "Speichere…"-indicator.
  const [savingIndex, setSavingIndex] = useState<number | null>(null);

  // Saved-flash am rand der frage zum visuellen confirmation.
  const lastSavedRef = useRef<number | null>(null);

  const currentQ = questions[currentIndex];
  const totalCount = questions.length;
  const answeredCount = answers.filter((a) => a >= 0).length;
  const allAnswered = answeredCount === totalCount;

  function handleSelect(answerIdx: number) {
    if (isSubmitted) return; // safety — sollte UI nicht erlauben

    const newAnswers = [...answers];
    newAnswers[currentIndex] = answerIdx;
    setAnswers(newAnswers);
    setError(null);

    // Server-side persist (fire-and-forget mit error-handling).
    setSavingIndex(currentIndex);
    saveExamAnswerAction({
      attemptId,
      questionIndex: currentIndex,
      answerIndex: answerIdx,
    })
      .then(() => {
        lastSavedRef.current = currentIndex;
        setSavingIndex((prev) => (prev === currentIndex ? null : prev));
      })
      .catch((e: unknown) => {
        setError(
          e instanceof Error
            ? `Antwort speichern fehlgeschlagen: ${e.message}`
            : 'Unbekannter Fehler beim Speichern.',
        );
        setSavingIndex(null);
      });
  }

  function handlePrev() {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }
  function handleNext() {
    setCurrentIndex((i) => Math.min(totalCount - 1, i + 1));
  }
  function handleJumpTo(idx: number) {
    setCurrentIndex(idx);
  }

  function handleSubmit() {
    if (isSubmitted) return;

    const unanswered = totalCount - answeredCount;
    if (unanswered > 0) {
      const msg = `${unanswered} Frage${unanswered === 1 ? '' : 'n'} unbeantwortet — trotzdem abgeben? Unbeantwortete Fragen zählen als falsch.`;
      if (!confirm(msg)) return;
    } else {
      if (!confirm('Prüfung jetzt abgeben? Du kannst danach nichts mehr ändern.')) {
        return;
      }
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await submitExamAction({
          attemptId,
          finalAnswers: answers,
        });
        setSubmitResult(result);
        // Refresh damit die page nun in submitted-mode rendered und der
        // pilot die review sehen kann (oder die enrollment-detail-page
        // den neuen status zeigt). Nach kurzer pause damit pilot das
        // result-flash sieht.
        setTimeout(() => {
          router.refresh();
        }, 100);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Unbekannter Fehler beim Abgeben.',
        );
      }
    });
  }

  // Auto-scroll zur frage wenn currentIndex sich ändert (auch bei jump).
  // Verhindert dass user nach navigation noch oben am vorherigen frage-
  // header steht.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentIndex]);

  // Result-display nach successful submit (vor refresh).
  if (submitResult) {
    return (
      <ResultBanner
        result={submitResult}
        passMarkPercent={passMarkPercent}
        schoolId={schoolId}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Review-banner mit final score (oben sichtbar bei review-mode) */}
      {isSubmitted && reviewScore && (
        <ResultBanner
          result={{
            scorePercent: reviewScore.scorePercent,
            passed: reviewScore.passed,
            correctCount: 0, // unbekannt bei review (nur stored in attempt)
            totalCount,
          }}
          passMarkPercent={passMarkPercent}
          schoolId={schoolId}
          inlineMode
        />
      )}

      {/* Progress + frage-navigator-grid */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm">
            <span className="font-semibold">
              Frage {currentIndex + 1}
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              {' '}
              von {totalCount}
            </span>
          </div>
          {!isSubmitted && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {answeredCount}/{totalCount} beantwortet
            </div>
          )}
        </div>

        {/* Frage-grid: jede frage ein klickbares plätze. Farb-coded:
            current = indigo, beantwortet = green, leer = gray. Bei review:
            grün/rot je nach correct/wrong. */}
        <div className="grid grid-cols-10 gap-1 sm:grid-cols-12 md:grid-cols-15 lg:grid-cols-20">
          {questions.map((q, i) => {
            const isCurrent = i === currentIndex;
            const userAnswer = answers[i];
            const answered = userAnswer >= 0;

            let cls = 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500';
            if (isSubmitted && q.correctIndex !== null) {
              if (userAnswer === q.correctIndex) {
                cls = 'bg-green-500/20 text-green-700 dark:text-green-400';
              } else {
                cls = 'bg-red-500/20 text-red-700 dark:text-red-400';
              }
            } else if (answered) {
              cls =
                'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300';
            }
            if (isCurrent) {
              cls += ' ring-2 ring-indigo-500 dark:ring-indigo-400';
            }

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => handleJumpTo(i)}
                className={`aspect-square text-xs font-mono rounded transition ${cls}`}
                aria-label={`Zu Frage ${i + 1} springen`}
                aria-current={isCurrent ? 'true' : undefined}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Aktuelle frage */}
      {currentQ && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-1 leading-snug">
            {currentQ.questionText}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
            Frage {currentIndex + 1} · {totalCount}
          </p>

          <div className="space-y-2" role="radiogroup" aria-label={currentQ.questionText}>
            {currentQ.options.map((opt, optIdx) => {
              const isUserAnswer = answers[currentIndex] === optIdx;
              const isCorrect =
                isSubmitted &&
                currentQ.correctIndex !== null &&
                currentQ.correctIndex === optIdx;
              const isUserWrong = isSubmitted && isUserAnswer && !isCorrect;

              let cls =
                'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5';
              if (isSubmitted) {
                if (isCorrect) {
                  cls =
                    'border-green-500 bg-green-50 dark:bg-green-500/10 text-green-900 dark:text-green-300';
                } else if (isUserWrong) {
                  cls =
                    'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-900 dark:text-red-300';
                } else {
                  cls = 'border-gray-300 dark:border-gray-700 opacity-60';
                }
              } else if (isUserAnswer) {
                cls =
                  'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-200';
              }

              return (
                <button
                  key={optIdx}
                  type="button"
                  onClick={() => handleSelect(optIdx)}
                  disabled={isSubmitted || pending}
                  className={`w-full text-left px-4 py-3 rounded border-2 transition text-sm ${cls} ${isSubmitted || pending ? 'cursor-default' : 'cursor-pointer'}`}
                  role="radio"
                  aria-checked={isUserAnswer}
                >
                  <span className="font-mono text-xs mr-2 text-gray-400">
                    {String.fromCharCode(65 + optIdx)})
                  </span>
                  {opt}
                  {isSubmitted && isCorrect && (
                    <span className="ml-2 text-xs font-semibold">✓ Richtig</span>
                  )}
                  {isSubmitted && isUserWrong && (
                    <span className="ml-2 text-xs font-semibold">
                      ✗ Deine Antwort
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Erklärung im review-mode */}
          {isSubmitted && currentQ.explanation && (
            <div className="mt-4 p-3 rounded bg-gray-50 dark:bg-gray-950/50 border border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-semibold">Erklärung: </span>
              {currentQ.explanation}
            </div>
          )}

          {/* Save-indicator bei in-progress */}
          {!isSubmitted && (
            <div className="mt-4 h-4 text-xs">
              {savingIndex === currentIndex && (
                <span className="text-gray-500 italic">Speichere…</span>
              )}
              {savingIndex !== currentIndex &&
                lastSavedRef.current === currentIndex && (
                  <span className="text-green-600 dark:text-green-400">
                    ✓ Gespeichert
                  </span>
                )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Navigation + submit */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="px-3 py-1.5 bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Zurück
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={currentIndex === totalCount - 1}
            className="px-3 py-1.5 bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Weiter →
          </button>
        </div>

        {!isSubmitted && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className={`px-4 py-2 rounded text-sm font-semibold transition disabled:opacity-50 ${
              allAnswered
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            {pending
              ? 'Sende ab…'
              : allAnswered
                ? 'Prüfung abgeben'
                : `Abgeben (${totalCount - answeredCount} unbeantwortet)`}
          </button>
        )}

        {isSubmitted && (
          <Link
            href={`/flight-schools/${schoolId}`}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition"
          >
            Zurück zur Schule
          </Link>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ResultBanner
// ─────────────────────────────────────────────────────────────────────────

/**
 * Großes result-display nach erfolgreich abgegebener prüfung. Zeigt:
 *   - Pass/Fail mit visual-cue (grün/rot)
 *   - Score-percent groß
 *   - Pass-mark als kontext (\"benötigt: 80%\")
 *   - Bei pass: hinweis dass enrollment auf EXAM_SCHEDULED gewechselt
 *     ist und der praktische teil als nächstes ansteht (Welle 13E-14)
 *   - Bei fail: hinweis dass retry möglich ist
 *
 * inlineMode=true: kompakter banner für review-mode oben auf der page.
 * Default false: full-page-takeover für post-submit-flash.
 */
function ResultBanner({
  result,
  passMarkPercent,
  schoolId,
  inlineMode = false,
}: {
  result: SubmitExamActionResult;
  passMarkPercent: number;
  schoolId: string;
  inlineMode?: boolean;
}) {
  const colorClass = result.passed
    ? 'bg-green-50 dark:bg-green-500/10 border-green-500/40 text-green-900 dark:text-green-200'
    : 'bg-red-50 dark:bg-red-500/10 border-red-500/40 text-red-900 dark:text-red-200';

  return (
    <div
      className={`rounded-lg border-2 p-6 ${colorClass} ${inlineMode ? '' : 'max-w-xl mx-auto'}`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold opacity-70">
            {result.passed ? 'Bestanden' : 'Nicht bestanden'}
          </p>
          <p className="text-4xl font-bold font-mono mt-1">
            {result.scorePercent.toFixed(1)}%
          </p>
          <p className="text-xs opacity-70 mt-1">
            Bestehensgrenze: {passMarkPercent}%
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs opacity-70">
            {result.passed ? '✓' : '✗'}
          </p>
          {result.correctCount > 0 && (
            <p className="text-sm font-mono">
              {result.correctCount}/{result.totalCount}
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-sm">
        {result.passed
          ? 'Glückwunsch! Du hast den Theorie-Teil bestanden. Der praktische Teil wird im nächsten Schritt freigeschaltet.'
          : 'Knapp daneben — du kannst die Prüfung jederzeit erneut versuchen. Übe noch ein wenig, bevor du es nochmal probierst.'}
      </p>

      {!inlineMode && (
        <div className="mt-5">
          <Link
            href={`/flight-schools/${schoolId}`}
            className="inline-block px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 hover:border-indigo-500 rounded text-sm font-semibold transition"
          >
            Zurück zur Schule
          </Link>
        </div>
      )}
    </div>
  );
}
