import Link from 'next/link';
import { prisma, TypeRatingExamStatus } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import {
  scheduleTypeRatingExam,
  markExamPassed,
  setExamTerminalStatus,
  rescheduleExam,
  deleteExam,
} from './actions';

/**
 * Track 4 #91 (Section R) — Type-Rating Exam-Scheduler.
 *
 * /airline/exams/type-ratings — admin-view aller TypeRatingExam-records
 * der eigenen airline. Filter-tabs nach status, schedule-form oben,
 * action-buttons per row (pass/fail/cancel/no-show/reschedule/delete).
 *
 * Architektur:
 * - Server-component mit ?status= filter über query-params (GET-form)
 * - Pilots + examiners aus prisma.user.findMany für die dropdowns
 *   (employmentStatus=ACTIVE, airline-scoped)
 * - Action-buttons als inline-<form action={serverAction}>. Confirm-
 *   prompts via native browser-confirm — minimal-intrusive, kein
 *   client-component-overhead.
 *
 * Filter-tabs (per query-param):
 *   - alle       (default, kein filter)
 *   - scheduled  (status=SCHEDULED, upcoming exams)
 *   - past       (status in [PASSED, FAILED, NO_SHOW], abgeschlossen)
 *   - cancelled  (status=CANCELLED)
 *
 * Out-of-scope:
 * - Calendar-view (timeline mit upcoming exams) — könnte später,
 *   list-view reicht für den moment
 * - Bulk-actions
 * - Examiner-workload-view (eigene seite wenn relevant)
 */

const STATUS_LABELS: Record<TypeRatingExamStatus, string> = {
  SCHEDULED: '📅 Geplant',
  PASSED: '✅ Bestanden',
  FAILED: '❌ Nicht bestanden',
  CANCELLED: '🚫 Abgesagt',
  NO_SHOW: '👻 Nicht erschienen',
};

const STATUS_BADGE_STYLES: Record<TypeRatingExamStatus, string> = {
  SCHEDULED:
    'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  PASSED:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  FAILED:
    'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  CANCELLED:
    'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
  NO_SHOW:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
};

type FilterTab = 'alle' | 'scheduled' | 'past' | 'cancelled';

function parseFilter(value: string | undefined): FilterTab {
  if (value === 'scheduled' || value === 'past' || value === 'cancelled') {
    return value;
  }
  return 'alle';
}

function statusWhere(filter: FilterTab): TypeRatingExamStatus[] | undefined {
  switch (filter) {
    case 'scheduled':
      return ['SCHEDULED'];
    case 'past':
      return ['PASSED', 'FAILED', 'NO_SHOW'];
    case 'cancelled':
      return ['CANCELLED'];
    case 'alle':
      return undefined;
  }
}

export default async function TypeRatingExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requireAirlineManagerWithAirlinePage();
  const params = await searchParams;
  const filter = parseFilter(params.status);
  const statusList = statusWhere(filter);

  // Exams + counts + pilots + examiners parallel laden.
  const [exams, allCounts, pilots, examiners] = await Promise.all([
    prisma.typeRatingExam.findMany({
      where: {
        airlineId: actor.airlineId,
        ...(statusList ? { status: { in: statusList } } : {}),
      },
      select: {
        id: true,
        aircraftType: true,
        scheduledFor: true,
        status: true,
        notes: true,
        resultNotes: true,
        completedAt: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
        examiner: {
          select: { id: true, name: true, email: true },
        },
        typeRating: {
          select: { id: true, expiresAt: true },
        },
      },
      // SCHEDULED exams nach datum aufsteigend (nächster zuerst),
      // andere nach completedAt desc (neuester zuerst). DB sortiert
      // nicht so flexibel — wir sortieren in der app.
      orderBy: { scheduledFor: 'asc' },
    }),
    prisma.typeRatingExam.groupBy({
      by: ['status'],
      where: { airlineId: actor.airlineId },
      _count: { _all: true },
    }),
    // Pilots für schedule-form-dropdown: active employees in airline,
    // sortiert nach name. employmentStatus=ACTIVE filter — wir wollen
    // nicht leavers/inactive pilots in dem dropdown.
    prisma.user.findMany({
      where: {
        airlineId: actor.airlineId,
        employmentStatus: 'ACTIVE',
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    }),
    // Examiners: für jetzt alle airline-members (admin kann frei wählen).
    // Echte TRE-license-validation könnte später kommen — gibt aber auch
    // legitimate non-TRE-examiner-cases (training-captain, external).
    prisma.user.findMany({
      where: {
        airlineId: actor.airlineId,
        employmentStatus: 'ACTIVE',
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    }),
  ]);

  // Sort exams: scheduled nach datum aufsteigend, abgeschlossene nach
  // completedAt desc. Wenn filter aktiv ist nur eine art relevant,
  // sonst gemischt.
  const sortedExams = [...exams].sort((a, b) => {
    if (a.status === 'SCHEDULED' && b.status !== 'SCHEDULED') return -1;
    if (a.status !== 'SCHEDULED' && b.status === 'SCHEDULED') return 1;
    if (a.status === 'SCHEDULED') {
      return a.scheduledFor.getTime() - b.scheduledFor.getTime();
    }
    // Beide non-SCHEDULED — sort by completedAt desc fallback createdAt
    const aTime = a.completedAt?.getTime() ?? a.createdAt.getTime();
    const bTime = b.completedAt?.getTime() ?? b.createdAt.getTime();
    return bTime - aTime;
  });

  // Counts pro status für die filter-tabs (immer alle status, nicht
  // gefilterte view).
  const countByStatus: Record<TypeRatingExamStatus, number> = {
    SCHEDULED: 0,
    PASSED: 0,
    FAILED: 0,
    CANCELLED: 0,
    NO_SHOW: 0,
  };
  for (const c of allCounts) {
    countByStatus[c.status] = c._count._all;
  }
  const totalAll = Object.values(countByStatus).reduce((s, n) => s + n, 0);
  const countScheduled = countByStatus.SCHEDULED;
  const countPast = countByStatus.PASSED + countByStatus.FAILED + countByStatus.NO_SHOW;
  const countCancelled = countByStatus.CANCELLED;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Type-Rating Exam-Scheduler</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              ⏰ Termine für Type-Rating-Prüfungen anlegen und nachverfolgen.
              Bei PASSED wird automatisch ein TypeRating-Record erzeugt.
            </p>
          </div>
          <Link
            href="/airline"
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Airline
          </Link>
        </header>

        {/* Schedule-form */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-1">Neuen Exam-Termin anlegen</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Wähle pilot + aircraft-type (ICAO) + datum/uhrzeit. Examiner
            kann später nachgetragen werden.
          </p>
          <form action={scheduleTypeRatingExam} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block mb-1 font-medium">Pilot</span>
              <select
                name="userId"
                required
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              >
                <option value="">— wählen —</option>
                {pilots.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? p.email}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="block mb-1 font-medium">Aircraft-Type (ICAO)</span>
              <input
                name="aircraftType"
                required
                placeholder="z.B. A320, B738"
                pattern="[A-Za-z0-9]{2,8}"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </label>

            <label className="text-sm">
              <span className="block mb-1 font-medium">Termin</span>
              <input
                type="datetime-local"
                name="scheduledFor"
                required
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono"
              />
            </label>

            <label className="text-sm">
              <span className="block mb-1 font-medium">
                Examiner{' '}
                <span className="text-xs text-gray-500">(optional)</span>
              </span>
              <select
                name="examinerId"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              >
                <option value="">— später zuweisen —</option>
                {examiners.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name ?? e.email}
                  </option>
                ))}
              </select>
            </label>

            <label className="md:col-span-2 text-sm">
              <span className="block mb-1 font-medium">
                Notizen{' '}
                <span className="text-xs text-gray-500">(optional)</span>
              </span>
              <textarea
                name="notes"
                rows={2}
                maxLength={2000}
                placeholder="z.B. FFS-time gebucht, sim-center Frankfurt"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition text-sm"
              >
                ⏰ Exam ansetzen
              </button>
            </div>
          </form>
        </section>

        {/* Filter-tabs */}
        {totalAll > 0 && (
          <div className="mb-6 flex flex-wrap gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-1">
            <FilterTabLink
              label="Alle"
              count={totalAll}
              active={filter === 'alle'}
              href="/airline/exams/type-ratings"
            />
            <FilterTabLink
              label="📅 Geplant"
              count={countScheduled}
              active={filter === 'scheduled'}
              href="/airline/exams/type-ratings?status=scheduled"
            />
            <FilterTabLink
              label="✅ Vergangen"
              count={countPast}
              active={filter === 'past'}
              href="/airline/exams/type-ratings?status=past"
            />
            <FilterTabLink
              label="🚫 Abgesagt"
              count={countCancelled}
              active={filter === 'cancelled'}
              href="/airline/exams/type-ratings?status=cancelled"
            />
          </div>
        )}

        {/* Exams list */}
        {sortedExams.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            {totalAll === 0 ? (
              <>
                <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
                  Noch keine Exams angelegt
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Lege oben deinen ersten Type-Rating-Exam-Termin an.
                </p>
              </>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">
                Keine Exams passen zum aktuellen Filter.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedExams.map((exam) => (
              <ExamCard key={exam.id} exam={exam} />
            ))}
          </div>
        )}

        {/* Info-footer */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Lifecycle:
            </strong>{' '}
            SCHEDULED → PASSED (erzeugt TypeRating mit
            12-monatigem-recurrent-cycle) / FAILED / CANCELLED / NO_SHOW.
            Nur SCHEDULED-exams können modifiziert werden — terminal-
            stati sind audit-trail.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Recurrent-checks:
            </strong>{' '}
            Wenn pilot bereits einen TypeRating für diesen aircraft-type
            hat, verlängert markExamPassed nur expiresAt (history bleibt).
            Bei initial-rating wird neu erzeugt.
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

interface FilterTabLinkProps {
  label: string;
  count: number;
  active: boolean;
  href: string;
}

function FilterTabLink({ label, count, active, href }: FilterTabLinkProps) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
        active
          ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
      <span
        className={`ml-1.5 text-xs ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-600'}`}
      >
        {count}
      </span>
    </Link>
  );
}

interface ExamCardData {
  id: string;
  aircraftType: string;
  scheduledFor: Date;
  status: TypeRatingExamStatus;
  notes: string | null;
  resultNotes: string | null;
  completedAt: Date | null;
  user: { id: string; name: string | null; email: string; image: string | null };
  examiner: { id: string; name: string | null; email: string } | null;
  typeRating: { id: string; expiresAt: Date | null } | null;
}

function ExamCard({ exam }: { exam: ExamCardData }) {
  const isScheduled = exam.status === 'SCHEDULED';
  const isOverdue =
    isScheduled && exam.scheduledFor.getTime() < Date.now();

  return (
    <div
      className={`bg-white dark:bg-gray-900 border rounded-lg p-4 sm:p-5 ${
        isOverdue
          ? 'border-amber-500/40'
          : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        {/* Pilot + type + status badge */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {exam.user.image ? (
            <picture className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={exam.user.image}
                alt=""
                className="w-10 h-10 rounded-full object-cover border border-gray-200 dark:border-gray-800"
              />
            </picture>
          ) : (
            <div
              className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-sm font-semibold text-gray-500 dark:text-gray-400 shrink-0"
              aria-hidden="true"
            >
              {(exam.user.name ?? exam.user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/airline/pilots/${exam.user.id}`}
                className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
              >
                {exam.user.name ?? exam.user.email}
              </Link>
              <span className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono">
                {exam.aircraftType}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${STATUS_BADGE_STYLES[exam.status]}`}
              >
                {STATUS_LABELS[exam.status]}
              </span>
              {isOverdue && (
                <span className="text-xs text-amber-700 dark:text-amber-400 font-semibold">
                  ⚠️ Überfällig
                </span>
              )}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              <span className="font-medium">
                {isScheduled ? 'Geplant:' : 'War geplant:'}
              </span>{' '}
              {exam.scheduledFor.toLocaleString('de-DE', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {exam.examiner && (
                <>
                  {' · '}
                  <span className="font-medium">Examiner:</span>{' '}
                  {exam.examiner.name ?? exam.examiner.email}
                </>
              )}
              {!exam.examiner && isScheduled && (
                <>
                  {' · '}
                  <span className="italic text-gray-500">
                    Examiner noch nicht zugewiesen
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {exam.notes && (
        <div className="mt-2 mb-3 p-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded text-xs text-gray-600 dark:text-gray-400">
          <p className="font-semibold mb-0.5 text-gray-700 dark:text-gray-300">
            📝 Notizen
          </p>
          <p className="whitespace-pre-line break-words leading-snug">
            {exam.notes}
          </p>
        </div>
      )}

      {/* Result notes (non-SCHEDULED only) */}
      {exam.resultNotes && !isScheduled && (
        <div className="mt-2 mb-3 p-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded text-xs text-gray-600 dark:text-gray-400">
          <p className="font-semibold mb-0.5 text-gray-700 dark:text-gray-300">
            📋 Ergebnis-Notizen
          </p>
          <p className="whitespace-pre-line break-words leading-snug">
            {exam.resultNotes}
          </p>
        </div>
      )}

      {/* Type-rating link bei PASSED */}
      {exam.status === 'PASSED' && exam.typeRating && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-3">
          ✅ TypeRating erzeugt
          {exam.typeRating.expiresAt && (
            <>
              {' '}
              · gültig bis{' '}
              <span className="font-mono">
                {exam.typeRating.expiresAt.toLocaleDateString('de-DE')}
              </span>
            </>
          )}
        </p>
      )}

      {/* Actions */}
      {isScheduled ? (
        <ScheduledActions exam={exam} />
      ) : exam.status !== 'PASSED' ? (
        <DeleteAction examId={exam.id} />
      ) : null}
    </div>
  );
}

function ScheduledActions({ exam }: { exam: ExamCardData }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
      {/* PASS */}
      <form action={markExamPassed} className="inline-flex items-center gap-1.5">
        <input type="hidden" name="examId" value={exam.id} />
        <input
          type="number"
          name="validForMonths"
          defaultValue={12}
          min={1}
          max={36}
          aria-label="Gültig für (Monate)"
          className="w-14 px-1.5 py-1 text-xs bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded font-mono"
          title="Gültig für (Monate)"
        />
        <span className="text-[10px] text-gray-500">mo</span>
        <button
          type="submit"
          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium"
        >
          ✅ Pass
        </button>
      </form>

      {/* FAIL */}
      <TerminalForm
        examId={exam.id}
        status="FAILED"
        label="❌ Fail"
        className="bg-red-600 hover:bg-red-700"
      />

      {/* CANCEL */}
      <TerminalForm
        examId={exam.id}
        status="CANCELLED"
        label="🚫 Cancel"
        className="bg-gray-600 hover:bg-gray-700"
      />

      {/* NO-SHOW */}
      <TerminalForm
        examId={exam.id}
        status="NO_SHOW"
        label="👻 No-Show"
        className="bg-amber-600 hover:bg-amber-700"
      />

      {/* RESCHEDULE */}
      <form action={rescheduleExam} className="inline-flex items-center gap-1.5">
        <input type="hidden" name="examId" value={exam.id} />
        <input
          type="datetime-local"
          name="scheduledFor"
          required
          className="px-2 py-1 text-xs bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded font-mono"
          aria-label="Neuer Termin"
        />
        <button
          type="submit"
          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium"
        >
          📅 Reschedule
        </button>
      </form>

      {/* DELETE */}
      <DeleteAction examId={exam.id} />
    </div>
  );
}

function TerminalForm({
  examId,
  status,
  label,
  className,
}: {
  examId: string;
  status: 'FAILED' | 'CANCELLED' | 'NO_SHOW';
  label: string;
  className: string;
}) {
  return (
    <form action={setExamTerminalStatus} className="inline-flex">
      <input type="hidden" name="examId" value={examId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={`px-2.5 py-1 text-white rounded text-xs font-medium ${className}`}
      >
        {label}
      </button>
    </form>
  );
}

function DeleteAction({ examId }: { examId: string }) {
  return (
    <form action={deleteExam} className="inline-flex">
      <input type="hidden" name="examId" value={examId} />
      <button
        type="submit"
        className="px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 rounded font-medium"
        title="Exam dauerhaft löschen (PASSED-exams nicht löschbar)"
      >
        🗑️ Löschen
      </button>
    </form>
  );
}
