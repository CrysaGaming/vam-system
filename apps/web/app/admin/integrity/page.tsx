import Link from 'next/link';
import { runIntegrityChecks } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';

/**
 * Track 4 #104 (Section T) — Data-Integrity-Check viewer.
 *
 * /admin/integrity — read-only dashboard that runs 10 invariant-checks
 * across orphan-rows, counter-drift, state-machine-inconsistencies,
 * negative-values und stale-state. Zeigt summary + per-check drill-down.
 *
 * # revalidate=60s
 *
 * Integrity-checks sind teurer als die anderen admin-pages (10 queries
 * mit JOINs + GROUP BY). 60s cache hält die last-min-stale-warnings im
 * akzeptablen bereich ohne dauer-pressure auf der DB.
 *
 * # No actions
 *
 * Reine detection-page. Repair-actions (z.b. "delete orphan rows") sind
 * out-of-scope V1 weil sie fall-by-fall manual analysis brauchen.
 */

export const revalidate = 60;

function severityIcon(severity: 'ok' | 'warn' | 'error'): string {
  switch (severity) {
    case 'ok':
      return '✓';
    case 'warn':
      return '⚠️';
    case 'error':
      return '❌';
  }
}

function severityCardStyles(severity: 'ok' | 'warn' | 'error'): string {
  switch (severity) {
    case 'ok':
      return 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10';
    case 'warn':
      return 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10';
    case 'error':
      return 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10';
  }
}

function severityBadgeStyles(severity: 'ok' | 'warn' | 'error'): string {
  switch (severity) {
    case 'ok':
      return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300';
    case 'warn':
      return 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300';
    case 'error':
      return 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300';
  }
}

interface SummaryCardProps {
  label: string;
  value: number;
  tone: 'default' | 'emerald' | 'amber' | 'red';
}

function SummaryCard({ label, value, tone }: SummaryCardProps) {
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
    </div>
  );
}

export default async function AdminIntegrityPage() {
  await requireAdminPage();

  const report = await runIntegrityChecks();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">🔍 Data-Integrity</h1>
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
            Read-only invariant-checks für orphan-rows, counter-drift,
            state-machine-inconsistencies, negative-values und stale-state.
            Lief in{' '}
            <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
              {report.durationMs}ms
            </span>{' '}
            · cache: 60s · Stand:{' '}
            {report.runAt.toLocaleString('de-DE')}
          </p>
        </header>

        {/* Summary */}
        <section className="mb-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              label="Total"
              value={report.summary.total}
              tone="default"
            />
            <SummaryCard
              label="✓ OK"
              value={report.summary.ok}
              tone={
                report.summary.ok === report.summary.total ? 'emerald' : 'default'
              }
            />
            <SummaryCard
              label="⚠️ Warn"
              value={report.summary.warn}
              tone={report.summary.warn > 0 ? 'amber' : 'default'}
            />
            <SummaryCard
              label="❌ Error"
              value={report.summary.error}
              tone={report.summary.error > 0 ? 'red' : 'default'}
            />
          </div>
          {report.summary.warn === 0 && report.summary.error === 0 && (
            <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
              ✓ Alle invariants halten. DB ist konsistent.
            </p>
          )}
          {(report.summary.warn > 0 || report.summary.error > 0) && (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
              {report.summary.error > 0
                ? `${report.summary.error} kritische probleme erkannt. Sofortige untersuchung empfohlen.`
                : `${report.summary.warn} warnungen. Inspizieren wenn zeit ist.`}
            </p>
          )}
        </section>

        {/* Checks */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Checks</h2>
          <ul className="space-y-3">
            {report.checks.map((check, i) => (
              <li
                key={i}
                className={`border rounded-lg p-4 ${severityCardStyles(check.severity)}`}
              >
                <div className="flex items-start gap-3 flex-wrap">
                  <span
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-lg ${severityBadgeStyles(check.severity)}`}
                    aria-hidden="true"
                  >
                    {severityIcon(check.severity)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline flex-wrap gap-2 mb-1">
                      <h3 className="font-semibold text-base">{check.name}</h3>
                      <span
                        className={`font-mono text-xs px-2 py-0.5 rounded ${severityBadgeStyles(check.severity)}`}
                      >
                        {check.count} {check.count === 1 ? 'row' : 'rows'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                      {check.description}
                    </p>
                    <code className="block text-[11px] text-gray-500 dark:text-gray-500 font-mono break-all mb-2">
                      {check.query}
                    </code>
                    {check.examples && check.examples.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
                          Beispiel-IDs ({check.examples.length}
                          {check.count > check.examples.length
                            ? ` von ${check.count}`
                            : ''}
                          )
                        </summary>
                        <ul className="mt-2 space-y-1 font-mono text-[11px] text-gray-700 dark:text-gray-300">
                          {check.examples.map((id) => (
                            <li key={id}>{id}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Info footer */}
        <aside className="bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Wann beobachten?
            </strong>{' '}
            Nach migrations, größeren admin-actions oder unerwarteten errors
            (siehe{' '}
            <Link
              href="/admin/errors"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              🐛 Client-Errors
            </Link>
            ).
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Severity-bedeutung:
            </strong>{' '}
            <code className="bg-emerald-100 dark:bg-emerald-500/20 px-1.5 py-0.5 rounded">
              ok
            </code>{' '}
            invariant hält.{' '}
            <code className="bg-amber-100 dark:bg-amber-500/20 px-1.5 py-0.5 rounded">
              warn
            </code>{' '}
            inkonsistenz erkannt aber nicht akut.{' '}
            <code className="bg-red-100 dark:bg-red-500/20 px-1.5 py-0.5 rounded">
              error
            </code>{' '}
            DB-corruption oder schema-violation — sollte technisch unmöglich
            sein.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Repair-actions:
            </strong>{' '}
            Out-of-scope V1. Fall-by-fall manual analysis nötig — z.b.
            orphan-booking kann delete-OR-restore sein, hängt vom kontext ab.
            Beispiel-IDs reichen für direkte DB-investigation.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Performance:
            </strong>{' '}
            10 parallele queries via Promise.all, ca. {report.durationMs}ms für
            den ganzen report. Bei 100k+ rows pro tabelle erwartet 1-3s, bei
            1M+ rows wäre ein nightly-cron-job sinnvoll.
          </p>
        </aside>
      </div>
    </main>
  );
}
