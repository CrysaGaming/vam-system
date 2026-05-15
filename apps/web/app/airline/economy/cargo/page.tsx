/**
 * Welle M / M4 — Cargo flights admin page.
 *
 * Route: /airline/economy/cargo
 *
 * Listet alle routes der airline mit optional CargoLoadSpec. Admin
 * kann pro route eine cargo-config setzen (tonnage, payout-multiplier,
 * kategorie). Routes ohne spec können trotzdem als CARGO geflogen
 * werden mit default 1.3x bonus.
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { CargoSpecRow } from './_row';
import {
  DEFAULT_CARGO_MULTIPLIER,
  MIN_CARGO_MULTIPLIER,
  MAX_CARGO_MULTIPLIER,
} from '@/lib/pricing/cargo';

export const dynamic = 'force-dynamic';

export default async function CargoFlightsPage() {
  const user = await requireAirlineManagerWithAirlinePage();

  const routes = await prisma.route.findMany({
    where: { airlineId: user.airlineId, active: true },
    orderBy: { flightNumber: 'asc' },
    take: 500,
    select: {
      id: true,
      flightNumber: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      cargoLoadSpec: {
        select: {
          cargoTonnageKg: true,
          payoutMultiplier: true,
          cargoCategory: true,
          notes: true,
        },
      },
    },
  });

  const withSpec = routes.filter((r) => r.cargoLoadSpec).length;
  const withoutSpec = routes.length - withSpec;

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Airline · Economy
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            📦 Cargo Flights
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pro route eine optionale cargo-config. PIREPs mit flightType=
            CARGO bekommen einen payout-multiplier (default {DEFAULT_CARGO_MULTIPLIER}×).
          </p>
        </header>

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Mit Spec
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{withSpec}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Ohne Spec
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{withoutSpec}</p>
            <p className="text-xs text-muted-foreground">
              fliegen mit default {DEFAULT_CARGO_MULTIPLIER}×
            </p>
          </div>
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Multiplier-range
            </p>
            <p className="mt-2 text-xl font-bold tabular-nums">
              {MIN_CARGO_MULTIPLIER}× – {MAX_CARGO_MULTIPLIER}×
            </p>
          </div>
        </section>

        {routes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Keine aktiven routes. Lege erst routes unter /airline/routes an.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Flight</th>
                  <th className="px-3 py-2 text-left">Route</th>
                  <th className="px-3 py-2 text-left">Tonnage (kg)</th>
                  <th className="px-3 py-2 text-left">Multiplier</th>
                  <th className="px-3 py-2 text-left">Kategorie</th>
                  <th className="px-3 py-2 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {routes.map((r) => (
                  <CargoSpecRow
                    key={r.id}
                    routeId={r.id}
                    flightNumber={r.flightNumber}
                    routeLabel={`${r.departure.icao}→${r.arrival.icao}`}
                    existing={
                      r.cargoLoadSpec
                        ? {
                            cargoTonnageKg: r.cargoLoadSpec.cargoTonnageKg,
                            payoutMultiplier: parseFloat(
                              r.cargoLoadSpec.payoutMultiplier.toString(),
                            ),
                            cargoCategory: r.cargoLoadSpec.cargoCategory,
                            notes: r.cargoLoadSpec.notes,
                          }
                        : null
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <section className="mt-8 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="mb-2 font-semibold uppercase tracking-wider">
            Wie funktioniert&apos;s
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Pilot fliegt mit Pirep.flightType=CARGO statt SCHEDULED/FREE.
            </li>
            <li>
              Payout = basis × multiplier. Default {DEFAULT_CARGO_MULTIPLIER}× wenn keine spec
              gesetzt.
            </li>
            <li>
              Kategorie ist free-text — z.B. <em>express</em> (höher),{' '}
              <em>general-freight</em> (default), <em>pharma-cold-chain</em>{' '}
              (premium).
            </li>
            <li>
              V2: Booking-flow zeigt cargo-payout im preview.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
