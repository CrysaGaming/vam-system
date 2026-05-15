/**
 * Welle M / M5 — Pilot VAMSE exchange page.
 *
 * Route: /vamse
 *
 * Listet alle stocks aller airlines mit aktuellem preis. Pilot sieht:
 *   - alle verfügbaren stocks
 *   - seine holdings mit P&L (aktueller wert − avg-purchase)
 *   - trade-form für selected stock (URL ?stock=<id>)
 */

import { prisma } from '@vam/db';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import TradeForm from './_trade-form';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ stock?: string }>;

export default async function VamseExchangePage(props: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;
  const sp = await props.searchParams;
  const selectedStockId = sp.stock ?? null;

  const [stocks, holdings] = await Promise.all([
    prisma.vamseStock.findMany({
      orderBy: { currentPrice: 'desc' },
      take: 200,
      select: {
        id: true,
        tickerSymbol: true,
        currentPrice: true,
        totalShares: true,
        sharesOutstanding: true,
        lastPricedAt: true,
        airline: { select: { name: true, icao: true } },
      },
    }),
    prisma.vamseHolding.findMany({
      where: { userId },
      select: {
        id: true,
        stockId: true,
        shares: true,
        avgPurchasePrice: true,
      },
    }),
  ]);

  const holdingByStock = new Map(holdings.map((h) => [h.stockId, h]));

  // Portfolio P&L
  let totalCostBasis = 0;
  let totalCurrentValue = 0;
  for (const h of holdings) {
    const stock = stocks.find((s) => s.id === h.stockId);
    if (!stock) continue;
    const avg = parseFloat(h.avgPurchasePrice.toString());
    const current = parseFloat(stock.currentPrice.toString());
    totalCostBasis += h.shares * avg;
    totalCurrentValue += h.shares * current;
  }
  const totalPnl = totalCurrentValue - totalCostBasis;
  const totalPnlPct =
    totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : 0;

  const selectedStock = selectedStockId
    ? stocks.find((s) => s.id === selectedStockId)
    : null;
  const selectedHolding = selectedStock
    ? holdingByStock.get(selectedStock.id)
    : null;

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            VAMSE · Virtual Airline & Money Stock Exchange
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">📈 Stocks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spekulier auf airlines. Preise schwanken mit ihrer performance
            (PIREPs, pilots, revenue, age).
          </p>
        </header>

        {/* Portfolio summary */}
        {holdings.length > 0 && (
          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Holdings
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {holdings.length}
              </p>
              <p className="text-xs text-muted-foreground">
                {holdings.reduce((s, h) => s + h.shares, 0)} shares total
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Cost basis
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {Math.round(totalCostBasis).toLocaleString('de-DE')}
              </p>
              <p className="text-xs text-muted-foreground">VAM$ invested</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Current value
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {Math.round(totalCurrentValue).toLocaleString('de-DE')}
              </p>
              <p className="text-xs text-muted-foreground">VAM$ if sold now</p>
            </div>
            <div
              className={`rounded-lg border p-4 ${
                totalPnl >= 0
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-red-500/30 bg-red-500/5'
              }`}
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                P&amp;L
              </p>
              <p
                className={`mt-1 text-2xl font-bold tabular-nums ${
                  totalPnl >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {totalPnl >= 0 ? '+' : ''}
                {Math.round(totalPnl).toLocaleString('de-DE')}
              </p>
              <p
                className={`text-xs ${
                  totalPnl >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {totalPnl >= 0 ? '+' : ''}
                {totalPnlPct.toFixed(2)}%
              </p>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          {/* Stock list */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Verfügbare stocks ({stocks.length})
            </h2>
            {stocks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
                <div className="mb-3 text-5xl">📊</div>
                <h3 className="text-lg font-semibold">
                  Noch keine stocks gelistet
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Airline-admins müssen erst einen ticker setzen unter{' '}
                  <code>/airline/economy/vamse</code>.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Ticker</th>
                      <th className="px-3 py-2 text-left">Airline</th>
                      <th className="px-3 py-2 text-right">Preis</th>
                      <th className="px-3 py-2 text-right">Verfügbar</th>
                      <th className="px-3 py-2 text-right">Du hältst</th>
                      <th className="px-3 py-2 text-right">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stocks.map((s) => {
                      const h = holdingByStock.get(s.id);
                      const price = parseFloat(s.currentPrice.toString());
                      const available = s.totalShares - s.sharesOutstanding;
                      const pnl =
                        h !== undefined
                          ? (price -
                              parseFloat(h.avgPurchasePrice.toString())) *
                            h.shares
                          : 0;
                      const isSelected = selectedStockId === s.id;
                      return (
                        <tr
                          key={s.id}
                          className={
                            isSelected
                              ? 'bg-indigo-500/10'
                              : 'hover:bg-muted/20'
                          }
                        >
                          <td className="px-3 py-2 font-mono font-bold">
                            <Link
                              href={`/vamse?stock=${s.id}`}
                              className="hover:text-indigo-600 dark:hover:text-indigo-400"
                            >
                              {s.tickerSymbol}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {s.airline.icao} · {s.airline.name}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {price.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                            {available}/{s.totalShares}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {h ? h.shares : '—'}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              h
                                ? pnl >= 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-600 dark:text-red-400'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {h
                              ? `${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString('de-DE')}`
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

          {/* Trade panel */}
          <aside>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Trade
            </h2>
            {selectedStock ? (
              <TradeForm
                stockId={selectedStock.id}
                ticker={selectedStock.tickerSymbol}
                currentPrice={parseFloat(selectedStock.currentPrice.toString())}
                availableShares={
                  selectedStock.totalShares - selectedStock.sharesOutstanding
                }
                myShares={selectedHolding?.shares ?? 0}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Wähle einen ticker links zum traden.
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
