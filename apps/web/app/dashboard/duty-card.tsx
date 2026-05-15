import {
  getPilotDutyStatus,
  advisoryBadgeStyle,
  type DutyWindowStats,
} from '@/lib/duty/ftl-tracker';

/**
 * Welle P / P2 — Dashboard duty/fatigue card.
 *
 * Server component. Shows the pilot's rolling 24h / 7d / 28d flight
 * hours with a traffic-light advisory and per-window progress bars.
 * Rendered in the main dashboard grid alongside Wallet + Currency.
 *
 * The display is intentionally informational, not corrective: there's
 * no "go rest now" button or hard blocker. The CAUTION/REST tones are
 * a nudge, not a mandate — sim flying is supposed to be fun.
 */

export async function DutyCard({ userId }: { userId: string }) {
  const status = await getPilotDutyStatus(userId);
  const overallStyle = advisoryBadgeStyle(status.overall);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            😴 Duty Status
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Rolling Flugstunden + Pause-Empfehlung
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${overallStyle.bg} ${overallStyle.text}`}
          title={
            status.reasons.length > 0
              ? status.reasons.join('\n')
              : 'Alle limits im grünen bereich.'
          }
        >
          <span aria-hidden="true">{overallStyle.emoji}</span>
          {overallStyle.label}
        </span>
      </div>

      <div className="space-y-3">
        <WindowRow label="Letzte 24h" stats={status.last24h} unit="h" />
        <WindowRow label="Letzte 7 Tage" stats={status.last7d} unit="h" />
        <WindowRow label="Letzte 28 Tage" stats={status.last28d} unit="h" />
      </div>

      {status.hoursSinceLastFlight !== null && (
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          Letzter Flug{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-200">
            vor {formatHoursAgo(status.hoursSinceLastFlight)}
          </span>
        </p>
      )}

      {status.reasons.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            Warum die warnung?
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
            {status.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 text-[10px] text-gray-400 dark:text-gray-500">
        Limits sind beratend (kein hard-block). EASA-style, gesoftet
        für sim-use.
      </p>
    </section>
  );
}

function WindowRow({
  label,
  stats,
  unit,
}: {
  label: string;
  stats: DutyWindowStats;
  unit: string;
}) {
  // Progress: % of the REST threshold (the higher of the two). Color
  // shifts from emerald → amber → rose as we approach.
  const pct = Math.min(
    100,
    Math.round((stats.hours / stats.threshold.rest) * 100),
  );
  const barColor =
    stats.classification === 'REST_RECOMMENDED'
      ? 'bg-rose-500 dark:bg-rose-400'
      : stats.classification === 'CAUTION'
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-emerald-500 dark:bg-emerald-400';

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-mono tabular-nums text-gray-700 dark:text-gray-200">
          {stats.hours.toFixed(1)}
          {unit}{' '}
          <span className="text-gray-400 dark:text-gray-500">
            / {stats.threshold.rest}
            {unit}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
          aria-label={`${pct}% des rest-thresholds erreicht`}
        />
      </div>
    </div>
  );
}

function formatHoursAgo(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)} min`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)} h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
  }
  return `${Math.floor(days / 30)} Monaten`;
}
