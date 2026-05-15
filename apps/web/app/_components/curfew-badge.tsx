import {
  curfewBadgeStyle,
  formatMinutes,
  type CurfewStatus,
} from '@/lib/curfews/airport-curfew';

/**
 * Welle P / P3 — Curfew status badge for dispatch surfaces.
 *
 * Server component. Like WeatherBadge (P1), supports compact and
 * expanded modes:
 *
 *   compact=true  →  small pill ("🚫 EDDF closed") for inline placement
 *   compact=false →  card with full window details + notes
 *
 * If the status is `no-curfew` and `hideWhenNoCurfew` is set, renders
 * nothing — useful for grids where most airports have no curfew and
 * we don't want visual clutter.
 */
export function CurfewBadge({
  status,
  compact = false,
  hideWhenNoCurfew = false,
}: {
  status: CurfewStatus;
  compact?: boolean;
  hideWhenNoCurfew?: boolean;
}) {
  if (status.kind === 'no-curfew' && hideWhenNoCurfew) return null;

  const style = curfewBadgeStyle(status);

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text}`}
        title={describeStatusForTooltip(status)}
      >
        <span aria-hidden="true">{style.emoji}</span>
        {style.label}
      </span>
    );
  }

  // Expanded form. Shows window + source + notes when present.
  if (status.kind === 'no-curfew') {
    return (
      <div className={`rounded-md border border-border bg-card p-2 text-xs ${style.text}`}>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">{style.emoji}</span>
          {style.label}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-semibold ${style.bg} ${style.text}`}
        >
          <span aria-hidden="true">{style.emoji}</span>
          {style.label}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
        <dt>Window</dt>
        <dd className="text-right font-mono">
          {formatLocalHHMMFromMinutes(status.curfew.curfewStartLocalMin)}
          {' → '}
          {formatLocalHHMMFromMinutes(status.curfew.curfewEndLocalMin)}
          {' '}local
        </dd>
        <dt>Timezone</dt>
        <dd className="text-right font-mono text-[10px]">
          {status.curfew.timezone}
        </dd>
        {status.kind === 'closed' && (
          <>
            <dt>Öffnet in</dt>
            <dd className="text-right font-mono">
              {formatMinutes(status.minutesUntilOpen)}
            </dd>
          </>
        )}
        {(status.kind === 'open' || status.kind === 'closes-soon') && (
          <>
            <dt>Schließt in</dt>
            <dd className="text-right font-mono">
              {formatMinutes(status.minutesUntilClose)}
            </dd>
          </>
        )}
      </dl>
      {status.curfew.source && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          📜 {status.curfew.source}
        </p>
      )}
      {status.curfew.notes && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
            Details
          </summary>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {status.curfew.notes}
          </p>
        </details>
      )}
    </div>
  );
}

function describeStatusForTooltip(status: CurfewStatus): string {
  switch (status.kind) {
    case 'no-curfew':
      return `${status.icao} — kein Curfew bekannt`;
    case 'open':
      return `${status.icao} — schließt um ${status.nextCloseAtLocal} local (in ${formatMinutes(status.minutesUntilClose)})`;
    case 'closes-soon':
      return `${status.icao} — schließt bald, um ${status.nextCloseAtLocal} local`;
    case 'closed':
      return `${status.icao} — geschlossen, öffnet um ${status.nextOpenAtLocal} local (in ${formatMinutes(status.minutesUntilOpen)})`;
  }
}

function formatLocalHHMMFromMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}
