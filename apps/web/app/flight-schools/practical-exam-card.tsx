'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  markPracticalExamPirepAction,
  unsetPracticalExamPirepAction,
} from './actions';

/**
 * Shape eines PIREP-kandidaten für den picker. Server-side filtered:
 *   - userId === enrollment.userId
 *   - status === 'APPROVED'
 *   - flightTimeMin >= min für license-typ
 *   - submittedAt absteigend, take 20 (recent)
 */
export interface PirepCandidatePublic {
  id: string;
  flightTimeMin: number | null;
  submittedAt: Date;
  approvedAt: Date | null;
  departureIcao: string;
  arrivalIcao: string;
  aircraftType: string | null;
}

interface Props {
  enrollmentId: string;
  schoolId: string;
  /** Status des enrollments — gating: nur bei EXAM_SCHEDULED ist die card aktiv. */
  enrollmentStatus: string;
  /** Aktueller pirepId-zustand: null = nichts zugewiesen, sonst pending review. */
  practicalExamPirepId: string | null;
  /** Falls already passed (defensive, sollte status=PASSED implizieren). */
  practicalExamPassedAt: Date | null;
  /** Counter für UI: \"3. Versuch\" */
  attemptCount: number;
  /** Theorie bestanden? Wenn nein → card zeigt gated-info statt picker. */
  theoryPassedAt: Date | null;
  /** Approved PIREPs die als kandidat in frage kommen (server-filtered). */
  candidates: PirepCandidatePublic[];
  /** Falls practicalExamPirepId gesetzt: details zum gepickten PIREP für anzeige. */
  selectedPirep: PirepCandidatePublic | null;
  /** License-typ und min-flight-time für UI-info. */
  licenseType: string;
  minFlightTimeMin: number;
}

/**
 * Practical-Exam-card im enrollment-block (Welle 13E-14b).
 *
 * Vier states (gegated):
 *
 *   GATED — theoryPassedAt = null:
 *     Card zeigt info-banner \"Erst Theorie-Prüfung bestehen\". Kein
 *     interactive control.
 *
 *   PASSED — practicalExamPassedAt != null:
 *     Defensive — sollte enrollment.status === PASSED implizieren und die
 *     parent-page würde die enrollment-card als past-enrollment rendern.
 *     Falls hier doch sichtbar: nur info \"✓ Bestanden\".
 *
 *   AWAITING_REVIEW — practicalExamPirepId != null:
 *     Pilot hat einen flug zugewiesen, instructor reviewed. Card zeigt
 *     den gepickten PIREP + \"Zuweisung zurücknehmen\"-button. Pilot kann
 *     nicht selbst pass-marken — nur zurückziehen und neu zuweisen.
 *
 *   PICK_PIREP — alles andere (status=EXAM_SCHEDULED, theory passed, kein
 *     pirepId zugewiesen):
 *     Card zeigt picker mit candidates (approved PIREPs ≥ min-flight-time).
 *     Pilot wählt einen aus dropdown, klickt zuweisen, → markAction.
 *
 * Hinweis zur policy: pilot kann nicht selbst pass-marken. Das macht der
 * instructor (instructor-queue, Welle 13E-14c). Auch bei bestätigter
 * zuweisung ist der pilot bewusst auf wartende rolle reduziert.
 */
export function PracticalExamCard({
  enrollmentId,
  schoolId: _schoolId,
  enrollmentStatus,
  practicalExamPirepId,
  practicalExamPassedAt,
  attemptCount,
  theoryPassedAt,
  candidates,
  selectedPirep,
  licenseType,
  minFlightTimeMin,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id ?? '');

  const isPassed = practicalExamPassedAt !== null;
  const hasAssignment = practicalExamPirepId !== null;
  const theoryGate = theoryPassedAt === null;

  function handleAssign() {
    if (!selectedId) {
      setError('Bitte einen Flug auswählen.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await markPracticalExamPirepAction({
          enrollmentId,
          pirepId: selectedId,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleUnassign() {
    if (
      !confirm(
        'Zuweisung zurücknehmen? Du kannst danach einen anderen Flug auswählen.',
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await unsetPracticalExamPirepAction({ enrollmentId });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold">✈️ Praktische Prüfung</h3>
        {isPassed && (
          <span className="text-xs font-mono font-semibold text-green-700 dark:text-green-400">
            ✓ Bestanden
          </span>
        )}
        {!isPassed && hasAssignment && (
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            ⏳ Wartet auf Review
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* GATED state */}
      {theoryGate && (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">
          🔒 Bestehe zuerst die Theorie-Prüfung — dann kannst du einen Flug
          als Prüfungsflug einreichen.
        </p>
      )}

      {/* PASSED state (defensive) */}
      {!theoryGate && isPassed && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Du hast die praktische Prüfung am{' '}
          {practicalExamPassedAt!.toLocaleDateString('de-DE')} bestanden.
          Deine {licenseType}-Lizenz wurde ausgestellt.
        </p>
      )}

      {/* AWAITING_REVIEW state */}
      {!theoryGate && !isPassed && hasAssignment && selectedPirep && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Du hast einen Flug als Prüfungsflug zugewiesen. Ein Instructor
            wird ihn bewerten — du wirst benachrichtigt, sobald die
            Prüfung verifiziert ist.
          </p>
          <PirepRow pirep={selectedPirep} />
          <button
            type="button"
            onClick={handleUnassign}
            disabled={pending || enrollmentStatus !== 'EXAM_SCHEDULED'}
            className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
          >
            Zuweisung zurücknehmen
          </button>
        </div>
      )}

      {/* PICK_PIREP state */}
      {!theoryGate && !isPassed && !hasAssignment && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Wähle einen approved PIREP als deinen Prüfungsflug. Mindestens{' '}
            <span className="font-mono">{minFlightTimeMin} min</span>{' '}
            Flugzeit erforderlich für {licenseType}.
            {attemptCount > 0 && ` · Bisher ${attemptCount} Versuch${attemptCount === 1 ? '' : 'e'}.`}
          </p>

          {candidates.length === 0 ? (
            <div className="px-3 py-3 rounded border bg-amber-500/5 border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs">
              Keine geeigneten PIREPs gefunden. Du brauchst einen approved-
              Flug mit mindestens {minFlightTimeMin} Minuten Flugzeit.
              <br />
              <Link href="/pireps" className="underline mt-1 inline-block">
                Zu meinen PIREPs →
              </Link>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Prüfungsflug
                </label>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  disabled={pending}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-60 font-mono"
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.departureIcao} → {c.arrivalIcao} ·{' '}
                      {c.flightTimeMin}min ·{' '}
                      {c.aircraftType ?? 'unknown'} ·{' '}
                      {c.submittedAt.toLocaleDateString('de-DE')}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Zeigt deine letzten {candidates.length} approved PIREPs ab{' '}
                  {minFlightTimeMin} min.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAssign}
                disabled={pending || !selectedId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
              >
                {pending ? 'Wird zugewiesen…' : 'Als Prüfungsflug zuweisen'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Attempts-counter (alle states wenn > 0) */}
      {attemptCount > 0 && !isPassed && (
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-500">
          Versuche bisher: {attemptCount}
        </div>
      )}
    </div>
  );
}

/**
 * Kompakte zeile für einen ausgewählten PIREP — zeigt route, dauer,
 * aircraft, datum + link zum vollen PIREP.
 */
function PirepRow({ pirep }: { pirep: PirepCandidatePublic }) {
  return (
    <div className="px-3 py-2 rounded border bg-amber-50/50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/30 text-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono">
          <span className="font-semibold">{pirep.departureIcao}</span>
          <span className="text-gray-500 mx-1">→</span>
          <span className="font-semibold">{pirep.arrivalIcao}</span>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 font-mono">
          {pirep.flightTimeMin} min · {pirep.aircraftType ?? 'unknown'}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 mt-1 text-xs">
        <span className="text-gray-500 dark:text-gray-500">
          {pirep.approvedAt
            ? `Approved ${pirep.approvedAt.toLocaleDateString('de-DE')}`
            : `Submitted ${pirep.submittedAt.toLocaleDateString('de-DE')}`}
        </span>
        <Link
          href={`/pireps/${pirep.id}`}
          className="text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          PIREP ansehen →
        </Link>
      </div>
    </div>
  );
}
