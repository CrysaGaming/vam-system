import Link from 'next/link';
import { prisma, MentorshipStatus } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import {
  createMentorship,
  acceptMentorship,
  rejectMentorship,
  endMentorship,
  deleteMentorship,
} from './actions';

/**
 * Track 4 #93 (Section R) — Mentor-Mentee Matching.
 *
 * /airline/mentorship — admin-view aller Mentorship-records der eigenen
 * airline. Filter-tabs nach status, create-form oben, action-buttons
 * per row (accept/reject/end/delete je nach status).
 *
 * Architektur:
 * - Server-component mit ?status= filter über query-params
 * - Pilots (employmentStatus=ACTIVE in airline) als dropdown-source für
 *   mentor + mentee select (gleicher pool, app-layer prüft mentor!=mentee)
 * - Action-buttons als inline-<form action={serverAction}> (analog #91
 *   Type-Rating Exams)
 *
 * Filter-tabs (per query-param):
 *   - alle      (default)
 *   - active    (status=ACTIVE)
 *   - proposed  (status=PROPOSED)
 *   - past      (status in [ENDED, REJECTED])
 *
 * Out-of-scope für v1:
 * - Mentor-workload-view (eigene seite wenn relevant)
 * - Topics als chips-input mit autocomplete — text-input mit
 *   comma-separated reicht für MVP
 * - Per-pilot-mentorship-history-section auf pilot-detail
 */

const STATUS_LABELS: Record<MentorshipStatus, string> = {
  PROPOSED: '💌 Vorgeschlagen',
  ACTIVE: '🤝 Aktiv',
  ENDED: '✓ Beendet',
  REJECTED: '✗ Abgelehnt',
};

const STATUS_BADGE_STYLES: Record<MentorshipStatus, string> = {
  PROPOSED:
    'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  ACTIVE:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  ENDED:
    'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
  REJECTED:
    'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
};

type FilterTab = 'alle' | 'active' | 'proposed' | 'past';

function parseFilter(value: string | undefined): FilterTab {
  if (value === 'active' || value === 'proposed' || value === 'past') {
    return value;
  }
  return 'alle';
}

function statusWhere(filter: FilterTab): MentorshipStatus[] | undefined {
  switch (filter) {
    case 'active':
      return ['ACTIVE'];
    case 'proposed':
      return ['PROPOSED'];
    case 'past':
      return ['ENDED', 'REJECTED'];
    case 'alle':
      return undefined;
  }
}

export default async function MentorshipPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requireAirlineManagerWithAirlinePage();
  const params = await searchParams;
  const filter = parseFilter(params.status);
  const statusList = statusWhere(filter);

  const [mentorships, allCounts, pilots] = await Promise.all([
    prisma.mentorship.findMany({
      where: {
        airlineId: actor.airlineId,
        ...(statusList ? { status: { in: statusList } } : {}),
      },
      select: {
        id: true,
        status: true,
        topics: true,
        notes: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        mentor: {
          select: { id: true, name: true, email: true, image: true },
        },
        mentee: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.mentorship.groupBy({
      by: ['status'],
      where: { airlineId: actor.airlineId },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: {
        airlineId: actor.airlineId,
        employmentStatus: 'ACTIVE',
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    }),
  ]);

  // Sortiere display: PROPOSED first (need attention), dann ACTIVE,
  // dann past (ENDED/REJECTED).
  const STATUS_PRIORITY: Record<MentorshipStatus, number> = {
    PROPOSED: 0,
    ACTIVE: 1,
    ENDED: 2,
    REJECTED: 3,
  };
  const sortedMentorships = [...mentorships].sort((a, b) => {
    const pDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (pDiff !== 0) return pDiff;
    // Innerhalb gleichem status: neueste zuerst
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const countByStatus: Record<MentorshipStatus, number> = {
    PROPOSED: 0,
    ACTIVE: 0,
    ENDED: 0,
    REJECTED: 0,
  };
  for (const c of allCounts) {
    countByStatus[c.status] = c._count._all;
  }
  const totalAll = Object.values(countByStatus).reduce((s, n) => s + n, 0);
  const countActive = countByStatus.ACTIVE;
  const countProposed = countByStatus.PROPOSED;
  const countPast = countByStatus.ENDED + countByStatus.REJECTED;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Mentor-Mentee Matching</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              🤝 Senior pilots als mentors für trainees. Informelle guidance —
              außerhalb des structured flight-school-curriculums.
            </p>
          </div>
          <Link
            href="/airline"
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Airline
          </Link>
        </header>

        {/* Create-form */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-1">Neue Mentorship anlegen</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Wähle mentor (senior) + mentee (junior). Direkt-aktivieren
            (admin-assign) oder als Vorschlag (mentee/mentor bestätigt).
          </p>
          <form
            action={createMentorship}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <label className="text-sm">
              <span className="block mb-1 font-medium">Mentor</span>
              <select
                name="mentorId"
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
              <span className="block mb-1 font-medium">Mentee</span>
              <select
                name="menteeId"
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

            <label className="md:col-span-2 text-sm">
              <span className="block mb-1 font-medium">
                Themen{' '}
                <span className="text-xs text-gray-500">
                  (optional, komma-separiert, max 20)
                </span>
              </span>
              <input
                name="topicsRaw"
                placeholder="z.B. IFR-Flying, CRM, Long-haul ops"
                maxLength={1000}
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
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
                placeholder="Kontext für das pairing (z.B. mentor hat A320-erfahrung die mentee braucht)"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
            </label>

            <fieldset className="md:col-span-2 flex flex-wrap items-center gap-4 text-sm">
              <legend className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-500 font-medium w-full mb-1">
                Initial-Status
              </legend>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="initialStatus"
                  value="ACTIVE"
                  defaultChecked
                  className="accent-emerald-600"
                />
                <span>🤝 Direkt aktivieren</span>
                <span className="text-xs text-gray-500">
                  (admin-assign, sofort wirksam)
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="initialStatus"
                  value="PROPOSED"
                  className="accent-indigo-600"
                />
                <span>💌 Als Vorschlag</span>
                <span className="text-xs text-gray-500">
                  (wartet auf accept)
                </span>
              </label>
            </fieldset>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition text-sm"
              >
                🤝 Mentorship anlegen
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
              href="/airline/mentorship"
            />
            <FilterTabLink
              label="🤝 Aktiv"
              count={countActive}
              active={filter === 'active'}
              href="/airline/mentorship?status=active"
            />
            <FilterTabLink
              label="💌 Vorgeschlagen"
              count={countProposed}
              active={filter === 'proposed'}
              href="/airline/mentorship?status=proposed"
            />
            <FilterTabLink
              label="✓ Vergangen"
              count={countPast}
              active={filter === 'past'}
              href="/airline/mentorship?status=past"
            />
          </div>
        )}

        {/* Mentorship list */}
        {sortedMentorships.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            {totalAll === 0 ? (
              <>
                <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
                  Noch keine Mentorships
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Lege oben dein erstes mentor-mentee-paar an.
                </p>
              </>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">
                Keine Mentorships passen zum aktuellen Filter.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedMentorships.map((m) => (
              <MentorshipCard key={m.id} mentorship={m} />
            ))}
          </div>
        )}

        {/* Info-footer */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Lifecycle:
            </strong>{' '}
            PROPOSED (💌) → ACTIVE (🤝) → ENDED (✓), oder PROPOSED → REJECTED
            (✗). Nur PROPOSED kann accepted/rejected werden, nur ACTIVE kann
            beendet werden. Past-mentorships bleiben als audit-trail.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Constraint:
            </strong>{' '}
            Pro Mentee max 1 ACTIVE Mentorship gleichzeitig. Mehrere
            PROPOSED-vorschläge erlaubt, mentee/admin akzeptiert dann einen
            und die anderen können rejected werden.
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
          ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
      <span
        className={`ml-1.5 text-xs ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-600'}`}
      >
        {count}
      </span>
    </Link>
  );
}

interface MentorshipCardData {
  id: string;
  status: MentorshipStatus;
  topics: string[];
  notes: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  mentor: { id: string; name: string | null; email: string; image: string | null };
  mentee: { id: string; name: string | null; email: string; image: string | null };
}

function MentorshipCard({ mentorship }: { mentorship: MentorshipCardData }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <PersonChip person={mentorship.mentor} role="Mentor" />
        <span className="text-gray-400 dark:text-gray-600 text-xl" aria-hidden="true">
          →
        </span>
        <PersonChip person={mentorship.mentee} role="Mentee" />
        <span
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${STATUS_BADGE_STYLES[mentorship.status]}`}
        >
          {STATUS_LABELS[mentorship.status]}
        </span>
      </div>

      {/* Meta: started/ended */}
      <div className="text-xs text-gray-500 dark:text-gray-500 mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {mentorship.startedAt && (
          <span>
            <span className="font-medium">Start:</span>{' '}
            {mentorship.startedAt.toLocaleDateString('de-DE')}
          </span>
        )}
        {mentorship.endedAt && (
          <span>
            <span className="font-medium">Ende:</span>{' '}
            {mentorship.endedAt.toLocaleDateString('de-DE')}
          </span>
        )}
        {mentorship.startedAt && mentorship.endedAt && (
          <span className="text-gray-400 dark:text-gray-600 italic">
            ({daysBetween(mentorship.startedAt, mentorship.endedAt)} Tage)
          </span>
        )}
        {mentorship.status === 'ACTIVE' && mentorship.startedAt && (
          <span className="text-emerald-600 dark:text-emerald-400 italic">
            (läuft seit {daysBetween(mentorship.startedAt, new Date())} Tagen)
          </span>
        )}
      </div>

      {/* Topics */}
      {mentorship.topics.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {mentorship.topics.map((t) => (
            <span
              key={t}
              className="inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-500/40"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Notes */}
      {mentorship.notes && (
        <div className="mb-3 p-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded text-xs text-gray-600 dark:text-gray-400">
          <p className="font-semibold mb-0.5 text-gray-700 dark:text-gray-300">
            📝 Notizen
          </p>
          <p className="whitespace-pre-line break-words leading-snug">
            {mentorship.notes}
          </p>
        </div>
      )}

      {/* Actions */}
      <Actions mentorship={mentorship} />
    </div>
  );
}

function PersonChip({
  person,
  role,
}: {
  person: { id: string; name: string | null; email: string; image: string | null };
  role: string;
}) {
  return (
    <Link
      href={`/airline/pilots/${person.id}`}
      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition min-w-0"
    >
      {person.image ? (
        <picture className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={person.image}
            alt=""
            className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-800"
          />
        </picture>
      ) : (
        <div
          className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-400 shrink-0"
          aria-hidden="true"
        >
          {(person.name ?? person.email).charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">
          {person.name ?? person.email}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500">
          {role}
        </div>
      </div>
    </Link>
  );
}

function Actions({ mentorship }: { mentorship: MentorshipCardData }) {
  if (mentorship.status === 'PROPOSED') {
    return (
      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
        <FormButton
          action={acceptMentorship}
          id={mentorship.id}
          label="✓ Accept"
          className="bg-emerald-600 hover:bg-emerald-700"
        />
        <FormButton
          action={rejectMentorship}
          id={mentorship.id}
          label="✗ Reject"
          className="bg-red-600 hover:bg-red-700"
        />
        <FormButton
          action={deleteMentorship}
          id={mentorship.id}
          label="🗑️ Löschen"
          className="text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
          ghost
        />
      </div>
    );
  }
  if (mentorship.status === 'ACTIVE') {
    return (
      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
        <FormButton
          action={endMentorship}
          id={mentorship.id}
          label="🏁 Beenden"
          className="bg-amber-600 hover:bg-amber-700"
        />
        <FormButton
          action={deleteMentorship}
          id={mentorship.id}
          label="🗑️ Löschen"
          className="text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
          ghost
        />
      </div>
    );
  }
  // ENDED / REJECTED: nur delete als admin-tool
  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
      <FormButton
        action={deleteMentorship}
        id={mentorship.id}
        label="🗑️ Löschen"
        className="text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
        ghost
      />
    </div>
  );
}

function FormButton({
  action,
  id,
  label,
  className,
  ghost = false,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  label: string;
  className: string;
  ghost?: boolean;
}) {
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className={`px-2.5 py-1 text-xs font-medium rounded ${ghost ? '' : 'text-white'} ${className}`}
      >
        {label}
      </button>
    </form>
  );
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}
