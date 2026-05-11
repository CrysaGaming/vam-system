import Link from 'next/link';
import { listAuditEntries, countAuditEntriesSince } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';

/**
 * Track 4 #101 (Section T) — Admin-Audit-Log viewer.
 *
 * /admin/audit — chronologisches admin-action-log. Append-only display:
 * jede admin-action die via logAdminAction() geschrieben wurde.
 *
 * # Filter
 *
 * Query-params:
 *   - ?actorId=...     nur actions von bestimmtem admin
 *   - ?targetType=...  nur actions auf bestimmtem ressourcen-typ (Event, User...)
 *   - ?targetId=...    nur actions auf bestimmtem objekt
 *   - ?before=...      pagination-cursor (ID der letzten gezeigten entry)
 *
 * # Pagination
 *
 * Cursor-based via `before` query-param. 50 entries per page. Cursor wird
 * aus dem letzten entry der current page generiert.
 *
 * # Read-only
 *
 * Keine actions auf dieser page. Audit-log ist append-only — entries
 * können nur via DB-truncate gelöscht werden (forensic-trail-erhaltung).
 */

// Page-segment cache: 30s. Audit-log ist write-only via admin-actions,
// stale-reads sind ok.
export const revalidate = 30;

interface SearchParams {
  actorId?: string;
  targetType?: string;
  targetId?: string;
  before?: string;
}

/**
 * Action-string → emoji + tone für visuellen scan. Convention basiert
 * auf der dot-notation in audit/index.ts (event.*, user.*, award.*, ...).
 */
function actionStyle(action: string): { emoji: string; tone: string } {
  // Destructive: deleted/cancelled/revoked
  if (/\.(deleted|destroyed|removed)$/.test(action)) {
    return { emoji: '🗑️', tone: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300' };
  }
  if (/\.(cancelled|suspended|disabled|revoked)$/.test(action)) {
    return { emoji: '⛔', tone: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300' };
  }
  // Positive state-transitions
  if (/\.(published|approved|completed|granted|enabled|activated)$/.test(action)) {
    return { emoji: '✓', tone: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' };
  }
  // Mutations
  if (/\.(changed|updated|modified)$/.test(action)) {
    return { emoji: '✎', tone: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300' };
  }
  // Creation
  if (/\.(created|registered|added)$/.test(action)) {
    return { emoji: '+', tone: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-300' };
  }
  // Default
  return { emoji: '•', tone: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300' };
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

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdminPage();

  const params = await searchParams;
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [{ entries, hasMore, nextCursor }, count24h] = await Promise.all([
    listAuditEntries({
      limit: 50,
      beforeId: params.before ?? null,
      actorId: params.actorId ?? null,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
    }),
    countAuditEntriesSince(last24h),
  ]);

  const hasFilters = !!(params.actorId || params.targetType || params.targetId);

  // Build the "next page" link preserving filters
  const buildNextLink = () => {
    if (!hasMore || !nextCursor) return null;
    const sp = new URLSearchParams();
    if (params.actorId) sp.set('actorId', params.actorId);
    if (params.targetType) sp.set('targetType', params.targetType);
    if (params.targetId) sp.set('targetId', params.targetId);
    sp.set('before', nextCursor);
    return `/admin/audit?${sp.toString()}`;
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">📜 Admin-Audit-Log</h1>
            <div className="flex gap-2 flex-wrap">
              <Link
                href="/admin/errors"
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                🐛 Errors
              </Link>
              <Link
                href="/admin/perf"
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                ⏱ Perf
              </Link>
              <Link
                href="/admin/status"
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                🩺 Status
              </Link>
              <Link
                href="/admin"
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                ← Admin-Dashboard
              </Link>
            </div>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Append-only trail aller admin-actions.{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {count24h}
            </span>{' '}
            actions in den letzten 24h.
          </p>
        </header>

        {/* Active filters */}
        {hasFilters && (
          <div className="mb-4 flex items-center gap-2 flex-wrap text-sm">
            <span className="text-gray-500 dark:text-gray-400">Filter aktiv:</span>
            {params.actorId && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 rounded font-mono text-xs">
                actor={params.actorId.slice(0, 8)}…
              </span>
            )}
            {params.targetType && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 rounded font-mono text-xs">
                targetType={params.targetType}
              </span>
            )}
            {params.targetId && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 rounded font-mono text-xs">
                targetId={params.targetId.slice(0, 8)}…
              </span>
            )}
            <Link
              href="/admin/audit"
              className="px-2 py-0.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-xs"
            >
              Filter löschen
            </Link>
          </div>
        )}

        {/* Entries list */}
        {entries.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {hasFilters
                ? 'Keine audit-entries für diese filter.'
                : 'Noch keine audit-entries.'}
            </p>
            {!hasFilters && (
              <p className="text-xs text-gray-400 dark:text-gray-600">
                Sobald ein admin event.published / event.cancelled / etc.
                triggert, erscheinen entries hier.
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const style = actionStyle(entry.action);
              const metadata = entry.metadata as Record<string, unknown> | null;
              return (
                <li
                  key={entry.id}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 sm:p-4"
                >
                  <div className="flex items-start gap-3">
                    {/* Action-badge */}
                    <span
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base ${style.tone}`}
                      aria-hidden="true"
                    >
                      {style.emoji}
                    </span>

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline flex-wrap gap-2 mb-1">
                        <code
                          className={`font-mono text-xs px-1.5 py-0.5 rounded ${style.tone}`}
                        >
                          {entry.action}
                        </code>
                        {entry.targetType && (
                          <Link
                            href={`/admin/audit?targetType=${entry.targetType}${entry.targetId ? `&targetId=${entry.targetId}` : ''}`}
                            className="font-mono text-xs text-gray-600 dark:text-gray-400 hover:underline"
                            title="Nur diese target-art / dieses objekt zeigen"
                          >
                            on {entry.targetType}
                            {entry.targetId && (
                              <span className="text-gray-400 dark:text-gray-600">
                                {' '}
                                #{entry.targetId.slice(0, 8)}
                              </span>
                            )}
                          </Link>
                        )}
                        <span
                          className="text-xs text-gray-500 dark:text-gray-500 ml-auto"
                          title={entry.createdAt.toLocaleString('de-DE')}
                        >
                          {formatRelative(entry.createdAt)}
                        </span>
                      </div>

                      {/* Actor */}
                      <div className="flex items-center gap-2 text-sm">
                        {entry.actor ? (
                          <>
                            {entry.actor.image ? (
                              <picture>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={entry.actor.image}
                                  alt=""
                                  className="w-5 h-5 rounded-full"
                                />
                              </picture>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-700" />
                            )}
                            <Link
                              href={`/admin/audit?actorId=${entry.actor.id}`}
                              className="font-medium hover:underline"
                              title="Nur actions von diesem admin"
                            >
                              {entry.actor.name ?? '—'}
                            </Link>
                          </>
                        ) : (
                          <span className="italic text-gray-500 dark:text-gray-500">
                            (deleted admin)
                          </span>
                        )}
                      </div>

                      {/* Metadata */}
                      {metadata && Object.keys(metadata).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-500 dark:text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                            Metadata ({Object.keys(metadata).length} keys)
                          </summary>
                          <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto">
                            {JSON.stringify(metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Pagination */}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <Link
              href={buildNextLink() ?? '#'}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition"
            >
              Ältere entries laden →
            </Link>
          </div>
        )}

        {/* Info footer */}
        <aside className="mt-8 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Append-only:</strong>{' '}
            Audit-entries können nicht editiert oder gelöscht werden (außer per
            DB-truncate für test-cleanup). Auch bei user-delete bleibt die action-
            history erhalten — nur der actor-name verschwindet (anonyme entries).
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Action-konvention:</strong>{' '}
            Dot-separated lowercase, format <code>noun.verb[.qualifier]</code> —
            z.B. <code>event.published</code>, <code>user.role.changed</code>,
            <code> award.granted</code>. Neue action-types können frei
            hinzugefügt werden ohne schema-migration.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Gewirte actions (V1):</strong>{' '}
            <code>event.published</code>, <code>event.cancelled</code>,
            <code> event.completed</code>, <code>event.deleted</code>.
            Weitere actions (user-role-change, award-grant, pirep-approve) folgen
            in zukünftigen wellen.
          </p>
        </aside>
      </div>
    </main>
  );
}
