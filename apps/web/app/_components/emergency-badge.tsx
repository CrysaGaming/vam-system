import {
  getEmergencyReportsForPirep,
  emergencyTypeLabel,
  emergencyTypeEmoji,
  emergencySeverityStyle,
} from '@/lib/emergency/detector';
import type { EmergencyReport } from '@vam/db';

/**
 * Welle P / P5 — Emergency badge for PIREP detail pages.
 *
 * Server component. Renders nothing when the PIREP has no emergency
 * reports (the common case for normal flights). When reports exist,
 * renders a vertical list of severity-styled pills with emoji, type
 * label, severity tag, and the details one-liner (e.g. touchdown rate).
 *
 * Ordering is most-severe-first (MAYDAY → EMERGENCY → INCIDENT) so
 * the pilot's eye lands on the heaviest entry first.
 *
 * Two call patterns:
 *   <EmergencyBadge pirepId="..." />            — fetches inside
 *   <EmergencyBadge reports={someArray} />      — caller already has them
 *
 * The reports-array variant exists so a page that already queries
 * `pirep.emergencyReports` via prisma-include can pass them in
 * directly without a second round-trip.
 */

type Props =
  | { pirepId: string; reports?: never }
  | { pirepId?: never; reports: EmergencyReport[] };

export async function EmergencyBadge(props: Props) {
  const reports: EmergencyReport[] =
    'reports' in props && props.reports
      ? props.reports
      : await getEmergencyReportsForPirep(props.pirepId!);

  if (reports.length === 0) return null;

  // Severity ranking for display order. The DB query in
  // getEmergencyReportsForPirep already orders by severity desc, but
  // we re-sort defensively in case the caller passed an un-ordered
  // array via the `reports` prop.
  const SEVERITY_ORDER: Record<string, number> = {
    MAYDAY: 0,
    EMERGENCY: 1,
    INCIDENT: 2,
  };
  const sorted = [...reports].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );

  return (
    <section
      aria-label="Emergency reports"
      className="rounded-lg border border-rose-300 bg-rose-50 p-4 dark:border-rose-700/50 dark:bg-rose-900/10"
    >
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-rose-900 dark:text-rose-200">
        <span aria-hidden="true">🚨</span>
        <span>
          {sorted.length === 1
            ? 'Emergency Report'
            : `${sorted.length} Emergency Reports`}
        </span>
      </h3>

      <ul className="space-y-2">
        {sorted.map((report) => {
          const sev = emergencySeverityStyle(report.severity);
          return (
            <li
              key={report.id}
              className={`rounded-md border ${sev.border} ${sev.bg} px-3 py-2`}
            >
              <div className="flex items-baseline gap-2 text-xs">
                <span aria-hidden="true">{emergencyTypeEmoji(report.type)}</span>
                <span className={`font-semibold ${sev.text}`}>
                  {emergencyTypeLabel(report.type)}
                </span>
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] ${sev.text}`}
                  style={{ letterSpacing: '0.05em' }}
                >
                  {sev.label}
                </span>
              </div>
              {report.details && (
                <p className={`mt-1 text-xs leading-snug ${sev.text}`}>
                  {report.details}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
