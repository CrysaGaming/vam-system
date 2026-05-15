/**
 * Welle M / M3 — Fuel pricing admin page.
 *
 * Route: /airline/economy/fuel
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { FuelPriceUpsertForm, DeletePriceButton } from './_form';

export const dynamic = 'force-dynamic';

export default async function FuelPricingPage() {
  const user = await requireAirlineManagerWithAirlinePage();

  const prices = await prisma.airportFuelPrice.findMany({
    where: { airlineId: user.airlineId },
    orderBy: { icao: 'asc' },
    select: {
      icao: true,
      pricePerGallon: true,
      note: true,
      updatedAt: true,
    },
  });

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Airline · Economy
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            ⛽ Fuel Pricing
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pro ICAO ein VAM$/gallon-preis. Wird im booking/PIREP-flow
            für fuel-cost-berechnung genutzt (V2 integration).
          </p>
        </header>

        <section className="mb-6">
          <FuelPriceUpsertForm />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Konfigurierte Preise ({prices.length})
          </h2>

          {prices.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
              <div className="mb-3 text-5xl">⛽</div>
              <h3 className="text-lg font-semibold">Noch keine fuel-preise</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Setze preise für deine häufigsten airports oben im
                formular.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">ICAO</th>
                    <th className="px-4 py-2 text-right">VAM$/gal</th>
                    <th className="px-4 py-2 text-left">Notiz</th>
                    <th className="px-4 py-2 text-left">Updated</th>
                    <th className="px-4 py-2 text-right">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {prices.map((p) => (
                    <tr key={p.icao} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono font-semibold">
                        {p.icao}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {parseFloat(p.pricePerGallon.toString()).toFixed(3)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {p.note ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {p.updatedAt.toLocaleDateString('de-DE')}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <DeletePriceButton icao={p.icao} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-8 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="font-semibold uppercase tracking-wider">Formel</p>
          <pre className="mt-2 rounded bg-muted/30 p-3 font-mono">
            fuelCostVam = fuelGallons × pricePerGallon
          </pre>
          <p className="mt-2">
            Real-world jet-A-preise schwanken ~$3-7/gallon je nach airport.
            VAM$ kann analog (oder als gameplay-balancing) genutzt werden.
          </p>
        </section>
      </div>
    </main>
  );
}
