import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import {
  getSlowQueries,
  getSlowQueryStats,
  clearSlowQueryBuffer,
} from '@vam/db';
import { requireAdminPage, requireAdmin } from '@/lib/roles';

/**
 * Track 4 #102 (Section T) — Slow-Query-Monitor admin-page.
 *
 * /admin/perf — read-only display des in-memory slow-query-buffers.
 * Threshold (default 200ms, override VAM_SLOW_QUERY_MS) — queries
 * darüber landen im ring-buffer (max 100 entries, FIFO).
 *
 * # Scope
 *
 * - revalidate=5s für fast-live feeling ohne dauerre-renders
 * - Admin-only via requireAdminPage()
 * - Server-action "Buffer leeren" → clearSlowQueryBuffer()
 *
 * # Buffer-semantik
 *
 * Buffer ist in-memory, single-process. Reset bei dev-server-restart,
 * reset bei admin "Buffer leeren"-button. Capacity 100 — sobald voll,
 * ältester eintrag wird verworfen. Bei multi-instance prod hätte jede
 * instance ihren eigenen buffer (out-of-scope für jetzt).
 *
 * # Empty-state-erklärung
 *
 * Falls keine slow queries: hinweis dass threshold auf 1ms gesetzt
 * werden kann via VAM_SLOW_QUERY_MS=1 env-var um capture zu testen.
 */

// Page-cache 5s — buffer ist write-via-side-effect, polling-like reads.
export const revalidate = 5;

// ─────────────────────────────────────────────────────────────────────────
// Server-action: clear buffer
// ─────────────────────────────────────────────────────────────────────────

async function clearBufferAction(): Promise<void> {
  'use server';
  await requireAdmin();
  clearSlowQueryBuffer();
  revalidatePath('/admin/perf');
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: 'default' | 'emerald' | 'amber' | 'red';
}

function StatCard({ label, value, sublabel, tone = 'default' }: StatCardProps) {
  const toneStyles = {
    default: 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
    emerald:
      'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10',
    amber:
      'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10',
    red: 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10',
  };
  const labelTones = {
    default: 'text-gray-500 dark:text-gray-400',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-red-700 dark:text-red-400',
  };
  return (
    <div className={`border rounded-lg p-4 ${toneStyles[tone]}`}>
      <p
        className={`text-[10px] uppercase tracking-wide font-medium ${labelTones[tone]}`}
      >
        {label}
      </p>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
      {sublabel && (
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
          {sublabel}
        </p>
      )}
    </div>
  );
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

function durationTone(ms: number, threshold: number): 'amber' | 'red' {
  // 2× threshold = "richtig kacke", alles dazwischen amber.
  return ms >= threshold * 2 ? 'red' : 'amber';
}

function durationToneStyles(tone: 'amber' | 'red'): string {
  return tone === 'red'
    ? 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300'
    : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300';
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default async function AdminPerfPage() {
  await requireAdminPage();

  const stats = getSlowQueryStats();
  const entries = getSlowQueries();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">⏱ Slow-Query-Monitor</h1>
            <div className="flex gap-2 flex-wrap">
              <Link
                href="/admin/errors"
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                🐛 Errors
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
                ← Admin-Dashboard
              </Link>
            </div>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            In-memory ring-buffer für queries ≥{' '}
            <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
              {stats.thresholdMs}ms
            </span>
            . Capacity:{' '}
            <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
              {stats.capacity}
            </span>{' '}
            entries · cache: 5s.
          </p>
        </header>

        {/* Stats */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Statistik</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              label="Slow Queries"
              value={stats.count}
              sublabel={`/ ${stats.capacity} buffer`}
              tone={
                stats.count === 0
                  ? 'emerald'
                  : stats.count >= stats.capacity * 0.9
                    ? 'red'
                    : 'default'
              }
            />
            <StatCard
              label="P50"
              value={stats.p50Ms !== null ? `${stats.p50Ms}ms` : '—'}
              sublabel="Median"
            />
            <StatCard
              label="P95"
              value={stats.p95Ms !== null ? `${stats.p95Ms}ms` : '—'}
              sublabel="95th percentile"
              tone={stats.p95Ms !== null && stats.p95Ms >= 1000 ? 'red' : 'default'}
            />
            <StatCard
              label="P99"
              value={stats.p99Ms !== null ? `${stats.p99Ms}ms` : '—'}
              sublabel="99th percentile"
              tone={stats.p99Ms !== null && stats.p99Ms >= 1000 ? 'red' : 'default'}
            />
            <StatCard
              label="Max"
              value={stats.maxMs !== null ? `${stats.maxMs}ms` : '—'}
              sublabel="slowest single query"
              tone={stats.maxMs !== null && stats.maxMs >= 1000 ? 'red' : 'amber'}
            />
          </div>
          {stats.oldestAt && stats.newestAt && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
              Buffer-zeitfenster: {formatRelative(stats.oldestAt)} (älteste) bis{' '}
              {formatRelative(stats.newestAt)} (neueste)
            </p>
          )}
        </section>

        {/* Entries */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Captured Queries</h2>
            {entries.length > 0 && (
              <form action={clearBufferAction}>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-red-100 hover:bg-red-200 dark:bg-red-500/15 dark:hover:bg-red-500/25 text-red-700 dark:text-red-300 rounded text-sm transition"
                >
                  🗑️ Buffer leeren
                </button>
              </form>
            )}
          </div>

          {entries.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-3">
                ✓ Keine slow queries — alles unter {stats.thresholdMs}ms.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-600 max-w-xl mx-auto">
                Um capture zu testen: dev-server mit{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                  VAM_SLOW_QUERY_MS=1
                </code>{' '}
                starten und ein paar pages besuchen. Buffer reset bei
                dev-server-restart und beim "Buffer leeren"-button.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry, i) => {
                const tone = durationTone(entry.durationMs, stats.thresholdMs);
                return (
                  <li
                    key={`${entry.timestamp.getTime()}-${i}`}
                    className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 sm:p-4"
                  >
                    <div className="flex items-start gap-3 flex-wrap">
                      {/* Duration badge */}
                      <span
                        className={`flex-shrink-0 font-mono font-bold text-sm px-2.5 py-1 rounded ${durationToneStyles(tone)}`}
                      >
                        {entry.durationMs}ms
                      </span>

                      {/* Operation badge */}
                      <code className="font-mono text-xs px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-300">
                        {entry.model ? `${entry.model}.` : ''}
                        {entry.operation}
                      </code>

                      {/* Timestamp */}
                      <span
                        className="text-xs text-gray-500 dark:text-gray-500 ml-auto"
                        title={entry.timestamp.toLocaleString('de-DE')}
                      >
                        {formatRelative(entry.timestamp)}
                      </span>
                    </div>

                    {/* Args preview */}
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 dark:text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                        Args ({entry.argsPreview.length} chars)
                      </summary>
                      <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap break-all">
                        {entry.argsPreview}
                      </pre>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Info footer */}
        <aside className="bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Threshold:</strong>{' '}
            Default 200ms. Override mit env-var{' '}
            <code className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              VAM_SLOW_QUERY_MS
            </code>{' '}
            (z.b. <code>=50</code> für aggressiveres capture oder{' '}
            <code>=1</code> zum testen). Threshold wird bei jedem query frisch
            gelesen — restart nötig nur wenn env-var-change nicht propagiert.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Was wird gemessen:</strong>{' '}
            Wall-clock duration einer Prisma-operation inkl. network-roundtrip,
            query-planning, execution, ergebnis-serialisierung. NICHT enthalten:
            connection-acquire-wartezeit (im pool), Next.js-rendering-time,
            JS-post-processing.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Was tun bei slow queries:</strong>{' '}
            Args inspizieren → ist's eine N+1? Fehlt ein composite-index?
            Vollscan auf einer großen tabelle? Bei wiederholten ähnlichen
            entries → prisma-query in code anschauen, ggf. include/select
            verschlanken oder $queryRaw mit EXPLAIN ANALYZE in psql.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Caveats:</strong>{' '}
            Single-process scope (jede dev-server- oder prod-instance hat
            eigenen buffer). Reset bei process-restart. Buffer-size hardcoded
            auf {stats.capacity}, FIFO bei overflow.
          </p>
        </aside>
      </div>
    </main>
  );
}
