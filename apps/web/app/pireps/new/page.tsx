import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { emitPirepSubmitted, emitRankUpgraded } from '@/lib/bot-events';

export default async function NewPirep() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: true },
  });

  if (!user || !user.airline) {
    redirect('/dashboard');
  }

  const routes = await prisma.route.findMany({
    where: { airlineId: user.airline.id, active: true },
    include: { departure: true, arrival: true },
    orderBy: { flightNumber: 'asc' },
  });

  const aircraft = await prisma.aircraft.findMany({
    where: { airlineId: user.airline.id, active: true },
    orderBy: { registration: 'asc' },
  });

  async function submitPirep(formData: FormData) {
    'use server';

    const session = await auth();
    if (!session?.user) {
      throw new Error('Unauthorized');
    }

    const routeId = formData.get('routeId') as string;
    const aircraftId = formData.get('aircraftId') as string;
    const flightTimeMinRaw = formData.get('flightTimeMin') as string;
    const fuelUsedKgRaw = formData.get('fuelUsedKg') as string;
    const landingRateFpmRaw = formData.get('landingRateFpm') as string;
    const remarks = (formData.get('remarks') as string) || null;

    const flightTimeMin = parseInt(flightTimeMinRaw, 10);
    const fuelUsedKg = fuelUsedKgRaw ? parseInt(fuelUsedKgRaw, 10) : null;
    const landingRateFpm = landingRateFpmRaw ? parseInt(landingRateFpmRaw, 10) : null;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { airline: true },
    });
    if (!user || !user.airline) throw new Error('User or airline not found');
    const airlineId = user.airline.id;
    const userId = user.id;

    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: { departure: true, arrival: true },
    });
    if (!route) throw new Error('Route not found');

    const newPirep = await prisma.$transaction(async (tx) => {
      // Phase 2 #2 Lifecycle: find active booking that this PIREP retires.
      //
      // Matching: same user, airline, route. State must be active (Created
      // or SimBriefDispatched) — Completed/Cancelled/Expired bookings stay
      // immutable. The active-booking-guard in createBooking enforces
      // 1-active-per-user-per-airline so multi-match shouldn't occur, but
      // findFirst+orderBy gives a deterministic result if the invariant
      // ever drifts.
      //
      // Why match by route too: user could have an active booking for LH918
      // and decide to file a PIREP for LH200 instead. That's a standalone
      // PIREP — leave the booking alone, it expires naturally.
      const matchingBooking = await tx.booking.findFirst({
        where: {
          userId,
          airlineId,
          routeId: route.id,
          state: { in: ['Created', 'SimBriefDispatched'] },
        },
        select: {
          id: true,
          flightPlanCache: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const pirep = await tx.pirep.create({
        data: {
          airlineId,
          userId,
          routeId: route.id,
          aircraftId,
          departureId: route.departureId,
          arrivalId: route.arrivalId,
          state: 'Landed',
          network: 'Offline',
          status: 'Submitted',
          flightTimeMin,
          fuelUsedKg,
          landingRateFpm,
          remarks,
          // Lifecycle Phase 2: only set when route+state match an active
          // booking. Pirep.bookingId is @unique so this is a clean 1:0..1
          // edge — booking stays unlinked otherwise.
          bookingId: matchingBooking?.id ?? null,
        },
        include: {
          aircraft: true,
        },
      });

      if (matchingBooking) {
        // Cache-transfer: FlightPlanCache had bookingId, now it gets pirepId.
        // Schema allows both nullable so ownership moves atomically. The
        // Booking-Detail-Page will render OFP-summary in muted/read-only
        // mode (cache lookup via Booking.flightPlanCache returns null after
        // this), and the PIREP-Detail-Page (Phase 2 follow-up feature) can
        // render it as the historical OFP for the filed flight.
        if (matchingBooking.flightPlanCache) {
          await tx.flightPlanCache.update({
            where: { id: matchingBooking.flightPlanCache.id },
            data: {
              bookingId: null,
              pirepId: pirep.id,
            },
          });
        }

        // Complete the booking. From here it's read-only — state guards
        // in actions.ts reject mutations on Completed. dispatchedAt stays
        // as-is for audit; Pirep.submittedAt is the new canonical
        // "this flight happened" timestamp.
        await tx.booking.update({
          where: { id: matchingBooking.id },
          data: { state: 'Completed' },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          totalFlightHours: { increment: flightTimeMin / 60 },
          totalFlights: { increment: 1 },
        },
      });

      return pirep;
    });

    // Event: PIREP submitted → Bot postet in #pireps
    await emitPirepSubmitted({
      pirepId: newPirep.id,
      userId: user.id,
      flightNumber: route.flightNumber,
      departureIcao: route.departure.icao,
      arrivalIcao: route.arrival.icao,
      flightTimeMin,
      aircraftRegistration: newPirep.aircraft?.registration ?? null,
      remarks,
    });

    // Rang-Upgrade-Check
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { rank: true },
    });

    if (updatedUser && updatedUser.airlineId) {
      const qualifyingRank = await prisma.rank.findFirst({
        where: {
          airlineId: updatedUser.airlineId,
          minFlightHours: { lte: updatedUser.totalFlightHours },
        },
        orderBy: { order: 'desc' },
      });

      // Nur hochstufen, niemals runterstufen
      const currentOrder = updatedUser.rank?.order ?? -1;
      if (
        qualifyingRank &&
        qualifyingRank.id !== updatedUser.rankId &&
        qualifyingRank.order > currentOrder
      ) {
        await prisma.user.update({
          where: { id: user.id },
          data: { rankId: qualifyingRank.id },
        });
        console.log(
          `[rank-upgrade] ${user.email}: ${updatedUser.rank?.name ?? 'None'} -> ${qualifyingRank.name} (${updatedUser.totalFlightHours.toFixed(1)}h)`
        );

        // Discord-ID des Users für Rolle-Update suchen
        const discordAccount = await prisma.account.findFirst({
          where: { userId: user.id, provider: 'discord' },
          select: { providerAccountId: true },
        });

        // Event: Rank upgraded → Bot aktualisiert Discord-Rolle + postet Announcement
        await emitRankUpgraded({
          userId: user.id,
          discordId: discordAccount?.providerAccountId ?? null,
          oldRankName: updatedUser.rank?.name ?? 'None',
          newRankName: qualifyingRank.name,
          totalFlightHours: updatedUser.totalFlightHours,
        });
      }
    }

    revalidatePath('/dashboard');
    revalidatePath('/pireps');
    redirect('/pireps');
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Neuen PIREP einreichen</h1>
            <p className="text-gray-400 text-sm mt-1">Flugbericht für {user.airline.name}</p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <form action={submitPirep} className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-5">
            <div>
              <label htmlFor="routeId" className="block text-sm font-medium text-gray-300 mb-2">
                Route
              </label>
              <select
                id="routeId"
                name="routeId"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Route wählen --</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.flightNumber} · {r.departure.icao} → {r.arrival.icao} ({r.distanceNm} nm)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="aircraftId" className="block text-sm font-medium text-gray-300 mb-2">
                Flugzeug
              </label>
              <select
                id="aircraftId"
                name="aircraftId"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Flugzeug wählen --</option>
                {aircraft.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.registration} · {a.type}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="flightTimeMin" className="block text-sm font-medium text-gray-300 mb-2">
                  Flugzeit (Min)
                </label>
                <input
                  type="number"
                  id="flightTimeMin"
                  name="flightTimeMin"
                  required
                  min="1"
                  max="1440"
                  placeholder="z.B. 75"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="fuelUsedKg" className="block text-sm font-medium text-gray-300 mb-2">
                  Treibstoff (kg)
                </label>
                <input
                  type="number"
                  id="fuelUsedKg"
                  name="fuelUsedKg"
                  min="0"
                  placeholder="optional"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="landingRateFpm" className="block text-sm font-medium text-gray-300 mb-2">
                  Landing Rate (fpm)
                </label>
                <input
                  type="number"
                  id="landingRateFpm"
                  name="landingRateFpm"
                  max="0"
                  placeholder="z.B. -120"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="remarks" className="block text-sm font-medium text-gray-300 mb-2">
                Bemerkungen
              </label>
              <textarea
                id="remarks"
                name="remarks"
                rows={3}
                placeholder="Optional — z.B. Wetter, Besonderheiten"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition"
          >
            PIREP einreichen
          </button>
        </form>
      </div>
    </main>
  );
}