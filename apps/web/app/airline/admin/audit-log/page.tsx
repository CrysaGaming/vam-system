import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listAuditEntries } from '@vam/db';
import { requireAirlineManagerPage } from '@/lib/roles';

/**
 * Welle F / F1 — Airline-scoped audit-log viewer.
 *
 * /airline/admin/audit-log shows the chronological list of admin-actions
 * for the calling user's airline. Mirror of /admin/audit but filtered to
 * `airlineId = own` so airline-admins can audit their own staff without
 * needing system-admin access.
 *
 * # Why a second page rather than RBAC on /admin/audit?
 *
 * /admin/audit is system-admin-only and shows EVERYTHING (cross-airline,
 * global system actions, etc.). Adding "if airline-admin, filter to own"
 * branching to that page would create two distinct UI behaviours hidden
 * behind one URL — confusing for both code and users. A separate page
 * also lives in the airline-admin sub-tree alongside roster, fleet,
 * pilots etc., which is where airline-admins naturally look.
 *
 * # What's logged here
 *
 * Anything passed `airlineId: X` to logAdminAction. Currently includes
 * (Welle F / F1):
 *   - airline.member.role.changed
 *   - airline.member.rank.changed
 *   - airline.member.removed
 * Future actions to log: airline.settings.updated, airline.hub.added,
 * airline.rank.*, airline.aircraft.* — coverage expansion lands in F1.5.
 *
 * # Auth
 *
 * requireAirlineManagerPage gates the route (admin / airline-admin /
 * instructor) and redirects non-managers to /dashboard. We then read
 * user.airlineId to scope the query — managers without an airline-FK
 * (rare, but possible for system-admin without airline-assignment)
 * see an empty result-set, which is intentional: there's no airline
 * for them to audit on this page.
 *
 * # Filter UI
 *
 * Query params:
 *   - ?actorId=...   restrict to one acting admin (clickable from rows)
 *   - ?targetId=...  restrict to all actions on one target user
 *   - ?before=...    pagination cursor (entry id of last shown row)
 *
 * No timeframe filter in v1 — the list is small (one airline's actions)
 * and cursor-pagination handles deep browsing. A date-range filter
 * lands in F1.5 if traffic grows.
 */

// Page-segment cache: 30s. Audit-log is append-only via admin-actions,
// stale-reads are ok.
export const revalidate = 30;

interface SearchParams {
  actorId?: string;
  targetId?: string;
  before?: string;
}

/**
 * Action-string → emoji + tone for visual scan. Same mapping as
 * /admin/audit/page.tsx — kept inline rather than extracting to a
 * shared helper because (a) the two pages don't share other code and
 * (b) the airline-scoped page might diverge (e.g. drop emojis for a
 * tighter look). When it stabilises, factor out.
 */
function actionStyle(action: string): { emoji: string; tone: string } {
  if (/\.(deleted|destroyed|removed)$/.test(action)) {
    return {
      emoji: '🗑️',
      tone: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300',
    };
  }
  if (/\.(cancelled|suspended|disabled|revoked)$/.test(action)) {
    return {
      emoji: '⛔',
      tone: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300',
    };
  }
  if (/\.(published|approved|completed|granted|enabled|activated)$/.test(action)) {
    return {
      emoji: '✓',
      tone: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    };
  }
  if (/\.(changed|updated|modified)$/.test(action)) {
    return {
      emoji: '✎',
      tone: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300',
    };
  }
  if (/\.(created|registered|added)$/.test(action)) {
    return {
      emoji: '+',
      tone: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-300',
    };
  }
  return {
    emoji: '•',
    tone: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  };
}

function formatRelative(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return `vor ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `vor ${diffHr}h`;
  return `vor ${Math.floor(diffHr / 24)}d`;
}

export default async function AirlineAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAirlineManagerPage();
  if (!user.airlineId) {
    // Should be rare — a manager without an airline FK. Send them back
    // to dashboard rather than show an empty "this airline" page.
    redirect('/dashboard');
  }

  const params = await searchParams;

  const { entries, hasMore, nextCursor } = await listAuditEntries({
    limit: 50,
    beforeId: params.before ?? null,
    actorId: params.actorId ?? null,
    targetId: params.targetId ?? null,
    airlineId: user.airlineId, // ← the F1 scoping line
  });

  const hasFilters = !!(params.actorId || params.targetId);

  const buildNextLink = () => {
    if (!hasMore || !nextCursor) return null;
    const sp = new URLSearchParams();
    if (params.actorId) sp.set('actorId', params.actorId);
    if (params.targetId) sp.set('targetId', params.targetId);
    sp.set('before', nextCursor);
    return `/airline/admin/audit-log?${sp.toString()}`;
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">📜 Audit-Log</h1>
            <Link
              href="/airline"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Airline-Verwaltung
            </Link>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Chronologische Historie aller Admin-Aktionen in{' '}
            <span className="font-semibold">{user.airline?.name ?? 'dieser Airline'}</span>
            {' — '}Rollen-/Rang-Änderungen, Member-Entfernungen,
            Settings-Updates.
          </p>
        </header>

        {hasFilters && (
          <div className="mb-4 flex items-center gap-3 text-sm">
            <span className="text-gray-500">Aktive Filter:</span>
            {params.actorId && (
              <span className="px-2 py-1 rounded bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 font-mono text-xs">
                Actor: {params.actorId.slice(0, 8)}…
              </span>
            )}
            {params.targetId && (
              <span className="px-2 py-1 rounded bg-purple-100 dark:bg-purple-500/15 text-purple-800 dark:text-purple-300 font-mono text-xs">
                Target: {params.targetId.slice(0, 8)}…
              </span>
            )}
            <Link
              href="/airline/admin/audit-log"
              className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
            >
              Filter zurücksetzen
            </Link>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-12 text-center">
            <div className="text-5xl mb-3" aria-hidden="true">
              📭
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              {hasFilters
                ? 'Keine Aktionen für die gewählten Filter.'
                : 'Noch keine Admin-Aktionen protokolliert.'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-950/50 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    Aktion
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    Details
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                    Wann
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {entries.map((entry) => {
                  const style = actionStyle(entry.action);
                  const meta = (entry.metadata as Record<string, unknown> | null) ?? {};
                  const targetName = typeof meta.targetName === 'string' ? meta.targetName : null;
                  const fromRole = typeof meta.fromRole === 'string' ? meta.fromRole : null;
                  const toRole = typeof meta.toRole === 'string' ? meta.toRole : null;
                  const roleAtRemoval =
                    typeof meta.roleAtRemoval === 'string' ? meta.roleAtRemoval : null;
                  const selfRemoval = meta.selfRemoval === true;

                  return (
                    <tr
                      key={entry.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-950/30 transition"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${style.tone}`}
                        >
                          <span aria-hidden="true">{style.emoji}</span>
                          <span className="font-mono">{entry.action}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.actor ? (
                          <Link
                            href={`/airline/admin/audit-log?actorId=${entry.actor.id}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {entry.actor.name ?? 'Unbekannt'}
                          </Link>
                        ) : (
                          <span className="text-gray-400 italic">gelöscht</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {entry.targetId && targetName ? (
                          <Link
                            href={`/airline/admin/audit-log?targetId=${entry.targetId}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {targetName}
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {fromRole !== null || toRole !== null ? (
                          <span>
                            {fromRole ?? '—'}{' → '}
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {toRole ?? '—'}
                            </span>
                          </span>
                        ) : roleAtRemoval ? (
                          <span>
                            war <span className="font-mono">{roleAtRemoval}</span>
                            {selfRemoval && (
                              <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                                (selbst-entfernung)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap"
                        title={entry.createdAt.toISOString()}
                      >
                        {formatRelative(entry.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="mt-6 flex justify-center">
            <Link
              href={buildNextLink() ?? '#'}
              className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm transition"
            >
              Ältere Einträge laden →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
