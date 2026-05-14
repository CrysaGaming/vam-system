/**
 * Welle M / M1 — Dynamic pricing overview page.
 *
 * Route: /airline/economy/pricing
 *
 * Zeigt aktuelle preise pro route (latest snapshot) mit base-price,
 * demand-multiplier, airline-modifier, final-price + bookings7d für
 * transparenz. "Recalculate" button triggert bulk-recompute.
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import RecalculateButton from './_recalc-button';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const user = await requireAirlineManagerWithAirlinePage();

  // Hole für jede route den neuesten snapshot
  const routes = await prisma.route.findMany({
    where: { airlineId: user.airlineId, active: true },
    orderBy: { flightNumber: 'asc' },
    take: 500,
    select: {
      id: true,
      flightNumber: true,
      distanceNm: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      priceSnapshots: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          finalPrice: true,
          basePrice: true,
          demandMultiplier: true,
          airlineModifier: true,
          bookings7d: true,
          createdAt: true,
        },
      },
    },
  });

  // Statistik: wieviele routes haben snapshots vs none
  const withSnapshots = routes.filter((r) => r.priceSnapshots.length > 0);
  const withoutSnapshots = routes.length - withSnapshots.length;

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Airline · Economy
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              💰 Dynamic Pricing
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pilot-payouts basierend auf distance, demand und admin-modifier.
            </p>
          </div>
        </header>

        <section className="mb-6 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Preis-Formel
          </h2>
          <pre className="rounded bg-muted/30 p-3 text-xs">
            {`basePrice    = 500 + (distanceNm × 8), clamp [500, 25000]
demandMult   = bookings7d / averageBookings7d, clamp [0.5, 2.0]
airlineModif = admin-controlled per route, default 1.0
finalPrice   = round(basePrice × demandMult × airlineModif)`}
          </pre>
        </section>

        <section className="mb-6 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {withSnapshots.length} routes mit preisen ·{' '}
            {withoutSnapshots > 0 && (
              <span className="text-yellow-600 dark:text-yellow-400">
                {withoutSnapshots} ohne snapshot
              </span>
            )}
          </div>
          <RecalculateButton />
        </section>

        {routes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Keine aktiven routes. Lege erst routes an unter{' '}
              <Link
                href="/airline/routes"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                /airline/routes
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Flight</th>
                  <th className="px-3 py-2 text-left">Route</th>
                  <th className="px-3 py-2 text-right">NM</th>
                  <th className="px-3 py-2 text-right">Base</th>
                  <th className="px-3 py-2 text-right">Demand</th>
                  <th className="px-3 py-2 text-right">Modifier</th>
                  <th className="px-3 py-2 text-right">Final VAM$</th>
                  <th className="px-3 py-2 text-right">Bookings 7d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {routes.map((r) => {
                  const snap = r.priceSnapshots[0];
                  return (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono font-semibold">
                        {r.flightNumber}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {r.departure.icao}→{r.arrival.icao}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.distanceNm}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {snap ? (
                          parseFloat(snap.basePrice.toString()).toLocaleString(
                            'de-DE',
                            { maximumFractionDigits: 0 },
                          )
                        ) : (
                          <span className="text-muted-foreground italic">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {snap ? (
                          <span
                            className={
                              parseFloat(snap.demandMultiplier.toString()) > 1.2
                                ? 'text-green-600 dark:text-green-400'
                                : parseFloat(snap.demandMultiplier.toString()) <
                                    0.8
                                  ? 'text-red-600 dark:text-red-400'
                                  : ''
                            }
                          >
                            {parseFloat(
                              snap.demandMultiplier.toString(),
                            ).toFixed(2)}
                            ×
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {snap ? (
                          <span
                            className={
                              parseFloat(snap.airlineModifier.toString()) !==
                              1.0
                                ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                                : ''
                            }
                          >
                            {parseFloat(
                              snap.airlineModifier.toString(),
                            ).toFixed(2)}
                            ×
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            1.00×
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                        {snap ? (
                          parseFloat(snap.finalPrice.toString()).toLocaleString(
                            'de-DE',
                            { maximumFractionDigits: 0 },
                          )
                        ) : (
                          <span className="text-muted-foreground italic">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
                        {snap?.bookings7d ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
