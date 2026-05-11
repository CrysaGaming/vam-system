import Link from 'next/link';
import {
  listClientErrors,
  countClientErrorsSince,
  getTopErrorUrlsLast24h,
} from '@vam/db';
import { requireAdminPage } from '@/lib/roles';

/**
 * Track 4 #103 (Section T) — Client-Error-Log admin viewer.
 *
 * /admin/errors — paginierte liste aller client-side errors mit
 * filtern + drill-down auf stack-traces. requireAdminPage-gate,
 * revalidate=15s.
 *
 * # Filter (URL-params)
 *
 *   - ?userId=...   — nur errors von diesem user
 *   - ?url=...      — nur errors auf dieser URL (exact match)
 *   - ?before=...   — cursor-pagination, ID der letzten gezeigten entry
 *
 * # Stats-header
 *
 *   - 24h-count (alle errors letzte 24h)
 *   - Top-URLs-table (10 URLs mit meisten errors 24h)
 *
 * # Entry-rendering
 *
 * Jeder error eine card mit:
 *   - Timestamp (relative + absolute on hover)
 *   - User-link (oder "Anonym")
 *   - URL (klickbarer filter)
 *   - Message (red, monospace)
 *   - Stack (in <details> expand)
 *   - Context (in <details>, pretty-printed JSON)
 *   - User-agent (compact)
 */

export const revalidate = 15;

interface SearchParams {
  userId?: string;
  url?: string;
  before?: string;
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

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname + (new URL(url).search || '');
  } catch {
    return url;
  }
}

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdminPage();
  const params = await searchParams;

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [{ entries, hasMore, nextCursor }, count24h, topUrls] =
    await Promise.all([
      listClientErrors({
        limit: 50,
        beforeId: params.before ?? null,
        userId: params.userId ?? null,
        url: params.url ?? null,
      }),
      countClientErrorsSince(last24h),
      getTopErrorUrlsLast24h(),
    ]);

  const hasFilters = !!(params.userId || params.url);

  const buildNextLink = () => {
    if (!hasMore || !nextCursor) return null;
    const sp = new URLSearchParams();
    if (params.userId) sp.set('userId', params.userId);
    if (params.url) sp.set('url', params.url);
    sp.set('before', nextCursor);
    return `/admin/errors?${sp.toString()}`;
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">🐛 Client-Error-Log</h1>
            <div className="flex gap-2 flex-wrap">
              <Link
                href="/admin/perf"
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                ⏱ Perf
              </Link>
              <Link
                href="/admin/audit"
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                📜 Audit
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
                ← Dashboard
              </Link>
            </div>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            JavaScript-errors die im browser auftreten (window.onerror,
            unhandledrejection).{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {count24h}
            </span>{' '}
            errors in den letzten 24h. Cache 15s.
          </p>
        </header>

        {/* Top URLs 24h */}
        {topUrls.length > 0 && (
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-3">
              Top URLs letzte 24h
            </h2>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
              {topUrls.map((row) => (
                <Link
                  key={row.url}
                  href={`/admin/errors?url=${encodeURIComponent(row.url)}`}
                  className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition gap-4"
                >
                  <code className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate">
                    {pathFromUrl(row.url)}
                  </code>
                  <span className="text-sm font-mono font-medium text-red-700 dark:text-red-400 flex-shrink-0">
                    {row.count}× error
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Active filters */}
        {hasFilters && (
          <div className="mb-4 flex items-center gap-2 flex-wrap text-sm">
            <span className="text-gray-500 dark:text-gray-400">
              Filter aktiv:
            </span>
            {params.userId && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 rounded font-mono text-xs">
                user={params.userId.slice(0, 8)}…
              </span>
            )}
            {params.url && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 rounded font-mono text-xs">
                url={pathFromUrl(params.url).slice(0, 40)}
                {pathFromUrl(params.url).length > 40 ? '…' : ''}
              </span>
            )}
            <Link
              href="/admin/errors"
              className="px-2 py-0.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-xs"
            >
              Filter löschen
            </Link>
          </div>
        )}

        {/* Entries */}
        {entries.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {hasFilters
                ? '✓ Keine errors für diese filter.'
                : '✓ Keine errors. Yay!'}
            </p>
            {!hasFilters && (
              <p className="text-xs text-gray-400 dark:text-gray-600 max-w-xl mx-auto">
                Sobald ein client einen javascript-error wirft (uncaught
                exception, failed promise, render-error), erscheint er hier.
                Rate-limit: 10/min pro IP/user serverside, 20/min clientseitig.
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => {
              const context = entry.context as Record<string, unknown> | null;
              return (
                <li
                  key={entry.id}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      {entry.user ? (
                        <>
                          {entry.user.image ? (
                            <picture>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={entry.user.image}
                                alt=""
                                className="w-5 h-5 rounded-full"
                              />
                            </picture>
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-700" />
                          )}
                          <Link
                            href={`/admin/errors?userId=${entry.user.id}`}
                            className="font-medium hover:underline"
                            title="Nur errors von diesem user"
                          >
                            {entry.user.name ?? '—'}
                          </Link>
                        </>
                      ) : (
                        <span className="italic text-gray-500 dark:text-gray-500">
                          Anonym
                        </span>
                      )}
                      <Link
                        href={`/admin/errors?url=${encodeURIComponent(entry.url)}`}
                        className="font-mono text-xs text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-md"
                        title={entry.url}
                      >
                        {pathFromUrl(entry.url)}
                      </Link>
                    </div>
                    <span
                      className="text-xs text-gray-500 dark:text-gray-500"
                      title={`Gemeldet: ${entry.occurredAt.toLocaleString('de-DE')}\nIngestiert: ${entry.createdAt.toLocaleString('de-DE')}`}
                    >
                      {formatRelative(entry.createdAt)}
                    </span>
                  </div>

                  {/* Message */}
                  <pre className="font-mono text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded p-2 whitespace-pre-wrap break-words mb-2">
                    {entry.message}
                  </pre>

                  {/* Stack */}
                  {entry.stack && (
                    <details className="mb-2">
                      <summary className="text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
                        Stack-Trace ({entry.stack.length} chars)
                      </summary>
                      <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap break-all">
                        {entry.stack}
                      </pre>
                    </details>
                  )}

                  {/* Context */}
                  {context && Object.keys(context).length > 0 && (
                    <details className="mb-2">
                      <summary className="text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
                        Context ({Object.keys(context).length} keys)
                      </summary>
                      <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto">
                        {JSON.stringify(context, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* User-agent */}
                  {entry.userAgent && (
                    <p
                      className="text-[10px] text-gray-400 dark:text-gray-600 font-mono truncate"
                      title={entry.userAgent}
                    >
                      UA: {entry.userAgent}
                    </p>
                  )}
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
              Ältere errors laden →
            </Link>
          </div>
        )}

        {/* Info footer */}
        <aside className="mt-8 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Erfasst werden:
            </strong>{' '}
            window.onerror (uncaught exceptions, script-errors),
            unhandledrejection (failed promises). React render-errors
            werden separat (Next.js error-overlay) gehandled — V2 könnte
            eine eigene ErrorBoundary auf jeden layout-level mounten.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Rate-limit:
            </strong>{' '}
            Server 10/60s per user oder IP, client 20/60s per browser-tab,
            zusätzlich hash-basierter dedup damit derselbe error nicht
            innerhalb 60s wiederholt postet. Verhindert flood-storms bei
            render-loops.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Retention:
            </strong>{' '}
            V1 kein auto-prune. Bei 50k+ entries → daily-cron mit{' '}
            <code className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              DELETE FROM client_error_log WHERE created_at &lt; now() - 30
              days
            </code>
            .
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">PII:</strong>{' '}
            URLs und stack-traces können sensitive paths/query-params
            enthalten. Admin-only-access via requireAdminPage. Kein
            auto-scrubbing.
          </p>
        </aside>
      </div>
    </main>
  );
}
