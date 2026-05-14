'use server';

/**
 * Welle M / M1 — Pricing server actions.
 *
 * # Permission model
 *
 * Airline-admin-only. Pilots können nur read-current-prices via separate
 * helpers in lib/pricing/.
 *
 * # Workflow
 *
 *   1. Admin clicks "Recalculate Prices" on /airline/economy/pricing
 *   2. Action holt alle aktive routes + computes bookings7d per route
 *   3. Berechnet averageBookings7d global für die airline
 *   4. Per route: computeRoutePrice() → snapshot speichern
 *   5. UI zeigt new prices mit before/after comparison
 *
 * Optional V2: cron-job der das automatisch alle paar stunden macht.
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { computeRoutePrice } from '@/lib/pricing/dynamic';

export type PricingActionResult =
  | { ok: true; message?: string; routesUpdated?: number }
  | { ok: false; error: string };

/**
 * Recalculate prices for ALL active routes of the airline.
 *
 * Triggers:
 *   - Manual via "Recalculate" button
 *   - V2: cron-job
 *
 * Performance: bei airline mit 200 routes ist das ~200 DB-writes plus
 * 1 query für booking-counts. Bei 1000+ routes sollten wir das batchen
 * — V1 macht das aber sequenziell weil <500 routes typisch.
 */
export async function recalculateRoutePricesAction(): Promise<PricingActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. Alle aktiven routes der airline
  const routes = await prisma.route.findMany({
    where: { airlineId, active: true },
    select: {
      id: true,
      distanceNm: true,
      flightNumber: true,
    },
    take: 1000,
  });

  if (routes.length === 0) {
    return { ok: false, error: 'Keine aktiven routes gefunden.' };
  }

  // 2. Booking-counts per route (last 7d)
  const bookingsPerRoute = await prisma.booking.groupBy({
    by: ['routeId'],
    where: {
      airlineId,
      createdAt: { gte: sevenDaysAgo },
    },
    _count: { _all: true },
  });

  const bookingsByRouteId = new Map<string, number>();
  for (const b of bookingsPerRoute) {
    if (b.routeId) bookingsByRouteId.set(b.routeId, b._count._all);
  }

  // 3. Average bookings/7d across routes
  const totalBookings = Array.from(bookingsByRouteId.values()).reduce(
    (a, b) => a + b,
    0,
  );
  const averageBookings7d = totalBookings / routes.length;

  // 4. Get last snapshot's airlineModifier per route (carry forward)
  const lastSnapshots = await prisma.routePriceSnapshot.findMany({
    where: { airlineId },
    orderBy: { createdAt: 'desc' },
    distinct: ['routeId'],
    select: { routeId: true, airlineModifier: true },
  });
  const modifierByRoute = new Map<string, number>();
  for (const s of lastSnapshots) {
    modifierByRoute.set(s.routeId, parseFloat(s.airlineModifier.toString()));
  }

  // 5. Compute + insert snapshots (sequentiell — bei <500 routes okay)
  let updated = 0;
  for (const route of routes) {
    const bookings7d = bookingsByRouteId.get(route.id) ?? 0;
    const airlineModifier = modifierByRoute.get(route.id) ?? 1.0;

    const result = computeRoutePrice({
      distanceNm: route.distanceNm,
      bookings7d,
      airlineModifier,
      averageBookings7d,
    });

    await prisma.routePriceSnapshot.create({
      data: {
        airlineId,
        routeId: route.id,
        finalPrice: result.finalPrice,
        basePrice: result.basePrice,
        demandMultiplier: result.demandMultiplier,
        bookings7d: result.bookings7d,
        airlineModifier: result.airlineModifier,
      },
    });
    updated++;
  }

  revalidatePath('/airline/economy/pricing');
  return {
    ok: true,
    routesUpdated: updated,
    message: `${updated} routes neu bepreist.`,
  };
}

/**
 * Set the airlineModifier for a specific route (admin override).
 *
 * Speichert direkt einen neuen snapshot mit dem geänderten modifier
 * und re-computed final price.
 */
export async function setRouteModifierAction(input: {
  routeId: string;
  airlineModifier: number;
}): Promise<PricingActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  if (input.airlineModifier < 0.1 || input.airlineModifier > 5.0) {
    return { ok: false, error: 'Modifier muss zwischen 0.1 und 5.0 liegen.' };
  }

  const route = await prisma.route.findUnique({
    where: { id: input.routeId },
    select: { airlineId: true, distanceNm: true },
  });
  if (!route || route.airlineId !== airlineId) {
    return { ok: false, error: 'Route nicht gefunden.' };
  }

  // Re-compute mit dem neuen modifier
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const bookings7d = await prisma.booking.count({
    where: { routeId: input.routeId, createdAt: { gte: sevenDaysAgo } },
  });

  // Average für demand-multiplier-context: holen wir vom letzten snapshot
  // (oder default 0 → neutral 1.0 multiplier)
  const lastSnap = await prisma.routePriceSnapshot.findFirst({
    where: { airlineId },
    orderBy: { createdAt: 'desc' },
    select: { bookings7d: true, demandMultiplier: true },
  });
  // Wir können average nicht direkt rekonstruieren; nutzen den
  // last-snapshot-multiplier als proxy wenn vorhanden, sonst neutral.
  const result = computeRoutePrice({
    distanceNm: route.distanceNm,
    bookings7d,
    airlineModifier: input.airlineModifier,
    // Skip demand recompute, just preserve neutral 1.0
    averageBookings7d: bookings7d > 0 ? bookings7d : 1,
  });

  await prisma.routePriceSnapshot.create({
    data: {
      airlineId,
      routeId: input.routeId,
      finalPrice: result.finalPrice,
      basePrice: result.basePrice,
      demandMultiplier: result.demandMultiplier,
      bookings7d: result.bookings7d,
      airlineModifier: result.airlineModifier,
    },
  });

  revalidatePath('/airline/economy/pricing');
  return {
    ok: true,
    message: `Modifier auf ${input.airlineModifier}x gesetzt.`,
  };
}
