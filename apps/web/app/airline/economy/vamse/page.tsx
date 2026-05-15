/**
 * Welle M / M5 — Airline admin VAMSE page.
 *
 * Route: /airline/economy/vamse
 *
 * Setup + monitoring der eigenen airline-aktie. Zeigt:
 *   - Ticker setup form (initial oder rename)
 *   - Aktueller preis + lastPricedAt
 *   - Recalculate button
 *   - Snapshot history (letzte 20)
 *   - Stats: sharesOutstanding/totalShares, holdings-count
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { TickerSetForm, RecalculatePriceButton } from './_controls';

export const dynamic = 'force-dynamic';

export default async function AirlineVamsePage() {
  const user = await requireAirlineManagerWithAirlinePage();

  const stock = await prisma.vamseStock.findUnique({
    where: { airlineId: user.airlineId },
    select: {
      id: true,
      tickerSymbol: true,
      currentPrice: true,
      totalShares: true,
      sharesOutstanding: true,
      lastPricedAt: true,
      createdAt: true,
      snapshots: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          price: true,
          pireps7d: true,
          totalRevenue7d: true,
          createdAt: true,
        },
      },
    },
  });

  const holderCount = stock
    ? await prisma.vamseHolding.count({ where: { stockId: stock.id } })
    : 0;

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Airline · Economy
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            📈 VAMSE Stock
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Eigene airline-aktie auf der VAMSE-börse. Pilots können shares
            kaufen/verkaufen unter <Link href="/vamse" className="text-indigo-600 hover:underline dark:text-indigo-400">/vamse</Link>.
          </p>
        </header>

        {/* Ticker setup */}
        <section className="mb-6">
          <TickerSetForm currentTicker={stock?.tickerSymbol ?? null} />
        </section>

        {stock && (
          <>
            {/* Stats */}
            <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Aktueller Preis
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {parseFloat(stock.currentPrice.toString()).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">VAM$ / share</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Im Umlauf
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {stock.sharesOutstanding}
                </p>
                <p className="text-xs text-muted-foreground">
                  von {stock.totalShares}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Shareholder
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {holderCount}
                </p>
                <p className="text-xs text-muted-foreground">pilots</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Market Cap
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {Math.round(
                    parseFloat(stock.currentPrice.toString()) *
                      stock.totalShares,
                  ).toLocaleString('de-DE')}
                </p>
                <p className="text-xs text-muted-foreground">VAM$</p>
              </div>
            </section>

            {/* Recalculate */}
            <section className="mb-6 flex items-center justify-between rounded-lg border border-border bg-card p-4">
              <div>
                <p className="text-sm font-semibold">Preis-Recalculation</p>
                <p className="text-xs text-muted-foreground">
                  {stock.lastPricedAt
                    ? `Zuletzt: ${stock.lastPricedAt.toLocaleString('de-DE')}`
                    : 'Noch nie berechnet'}
                </p>
              </div>
              <RecalculatePriceButton />
            </section>

            {/* Formula */}
            <section className="mb-6 rounded-lg border border-border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Preis-Formel
              </h2>
              <pre className="rounded bg-muted/30 p-3 text-xs">
                {`activityScore  = pireps7d × 1.0 + activePilots7d × 5.0
revenueScore   = log10(max(1, totalRevenue7d / 1000))
ageBonus       = min(5, airlineAgeDays / 73)
rawPrice       = activityScore × 0.5 + revenueScore × 20
                 + ageBonus + 1.0
price          = clamp(rawPrice, 0.10, 10000.00)`}
              </pre>
              <p className="mt-2 text-xs text-muted-foreground">
                Deterministisch: gleiche inputs = gleicher preis. Spekulation
                kommt von tatsächlicher airline-performance, nicht von
                random noise.
              </p>
            </section>

            {/* Snapshot history */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Preis-Historie (letzte 20)
              </h2>
              {stock.snapshots.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
                  Noch keine snapshots. Trigger oben einen recompute.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Zeitpunkt</th>
                        <th className="px-3 py-2 text-right">Preis</th>
                        <th className="px-3 py-2 text-right">PIREPs 7d</th>
                        <th className="px-3 py-2 text-right">Revenue 7d</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {stock.snapshots.map((s, idx) => {
                        const prevPrice =
                          idx < stock.snapshots.length - 1
                            ? parseFloat(
                                stock.snapshots[idx + 1].price.toString(),
                              )
                            : null;
                        const thisPrice = parseFloat(s.price.toString());
                        const delta =
                          prevPrice !== null ? thisPrice - prevPrice : 0;
                        return (
                          <tr key={s.createdAt.toISOString()}>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {s.createdAt.toLocaleString('de-DE')}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                              {thisPrice.toFixed(2)}
                              {prevPrice !== null && delta !== 0 && (
                                <span
                                  className={`ml-2 text-xs ${
                                    delta > 0
                                      ? 'text-green-600 dark:text-green-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }`}
                                >
                                  {delta > 0 ? '+' : ''}
                                  {delta.toFixed(2)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {s.pireps7d}
                            </td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                              {s.totalRevenue7d
                                ? `${Math.round(parseFloat(s.totalRevenue7d.toString())).toLocaleString('de-DE')}`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
