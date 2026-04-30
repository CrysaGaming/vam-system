import type { ReactNode } from 'react';

/**
 * Structural subtype of FlightPlanCache covering only the fields rendered
 * by the summary. Keeping this local (instead of importing the Prisma
 * model) means consumers can pass anything shaped like this — which keeps
 * the component cheap to reuse outside the booking-detail page later
 * (e.g. PIREP debrief, dispatch overlay) without dragging in the full
 * Prisma row type.
 */
export type OfpSummaryCache = {
  ofpId: string;
  blockTimeMin: number | null;
  fuelKg: number | null;
  generatedAt: Date;
  routeString: string | null;
  /**
   * Optional cache-validity deadline. When provided and in the past, the
   * component renders a "Stale" badge so the pilot knows the OFP's
   * weather + AIRAC snapshot may be out of date — typically 6h after
   * generation per actions.ts. Older callers that don't pass this still
   * work; they just don't get the staleness hint.
   */
  expiresAt?: Date;
};

export interface OfpSummaryProps {
  cache: OfpSummaryCache;
  /**
   * Optional action row rendered below the route string. When omitted the
   * whole section is muted (opacity-75) to signal a read-only historical
   * view — the convention is "actions present ⇒ live, actions absent ⇒
   * archive". Booking-Detail uses the muted form for final-state bookings
   * (Cancelled/Completed/Expired), the active form for in-progress ones.
   */
  actions?: ReactNode;
}

function formatBlockTime(min: number | null): string {
  if (min === null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/**
 * OFP Summary card.
 *
 * Renders the four canonical headline fields from a SimBrief OFP — id,
 * block time, block fuel, generation timestamp — plus the route string
 * if present. Both Pattern α and Pattern Z funnel into the same
 * FlightPlanCache shape (see actions.ts), so this component is pattern-
 * agnostic: it just knows how to display a cached plan.
 */
export function OfpSummary({ cache, actions }: OfpSummaryProps) {
  const muted = !actions;
  // Server component — Date.now() is the request time, which is the
  // correct frame of reference: the staleness indicator should reflect
  // "is this cache stale at the moment this page is rendered" rather
  // than drifting on the client clock. If the user keeps the page open
  // past the deadline they'll see the badge after a refresh, which is
  // also when they have the option to act on it.
  const isStale =
    cache.expiresAt !== undefined && cache.expiresAt.getTime() < Date.now();
  return (
    <section
      className={`bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8${
        muted ? ' opacity-75' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-wider text-gray-500">
          OFP Summary
        </h2>
        {isStale && (
          <span
            className="px-2 py-1 rounded text-xs font-semibold bg-yellow-500/10 border border-yellow-500/30 text-yellow-400"
            title={`Cache abgelaufen am ${cache.expiresAt!.toLocaleString('de-DE')}`}
          >
            ⚠ Abgelaufen
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            OFP ID
          </p>
          <p className="font-mono">{cache.ofpId}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Block Time
          </p>
          <p>{formatBlockTime(cache.blockTimeMin)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Block Fuel
          </p>
          <p>{cache.fuelKg ? `${cache.fuelKg} kg` : '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Generiert
          </p>
          <p>{new Date(cache.generatedAt).toLocaleString('de-DE')}</p>
        </div>
      </div>
      {cache.routeString && (
        <div className={actions ? 'mb-6' : ''}>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
            Route
          </p>
          <p className="font-mono text-sm bg-gray-950 border border-gray-800 rounded p-3 break-all">
            {cache.routeString}
          </p>
        </div>
      )}
      {actions && (
        <div className="flex gap-3 pt-4 border-t border-gray-800">
          {actions}
        </div>
      )}
    </section>
  );
}
