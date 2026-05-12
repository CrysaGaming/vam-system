import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { RosterCreatorForm } from './roster-form';

/**
 * Track 5 #27 (Section F) — /airline/roster/new
 *
 * Admin-form zum manuellen erstellen von roster-assignments.
 *
 * # Daten-loader (RSC)
 *
 * Lädt alles was die client-form für ihre picker braucht:
 *   1. **Eligible pilots** — alle ACTIVE pilots der airline. Wir lassen
 *      die UI dann nochmal eligibility live-checken pro pilot/flight-
 *      kombo, aber die initial-pilot-liste ist bereits gefiltert (kein
 *      sinn TERMINATED pilots zur auswahl zu stellen).
 *   2. **Verfügbare flights** — alle ScheduledFlights der airline im
 *      window [jetzt, +30 tage], status=Planned, sortiert by departureTime
 *      asc. Filter "nicht-schon-vollständig-gerostert" macht das UI nicht
 *      strikt — admin darf einen pilot zusätzlich rostern selbst wenn
 *      schon andere zugewiesen sind (z.B. captain + FO).
 *   3. **Aircraft** — aktive aircraft der airline für den optionalen
 *      override-picker.
 *
 * # Performance-notes
 *
 * Drei parallele queries via Promise.all. Limits:
 *   - pilots: typisch <100 für eine VA, keine pagination
 *   - flights: 30-tage-window kann je nach airline auf ~500 wachsen.
 *     Wir nehmen ein hard-cap von 500 — falls die airline mehr hat,
 *     soll der admin den date-range im UI eingrenzen. (UI hat keine
 *     date-filter im MVP, aber das limit lässt die page nicht
 *     unendlich-laden.)
 *   - aircraft: typisch <50, keine pagination
 */
export default async function NewRosterAssignmentPage() {
  const user = await requireAirlineManagerWithAirlinePage();

  const now = new Date();
  const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60_000);

  const [pilots, scheduledFlights, aircraft] = await Promise.all([
    prisma.user.findMany({
      where: {
        airlineId: user.airlineId,
        employmentStatus: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        image: true,
        totalFlightHours: true,
        rank: { select: { name: true } },
      },
      orderBy: [{ name: 'asc' }],
    }),
    prisma.scheduledFlight.findMany({
      where: {
        airlineId: user.airlineId,
        status: 'Planned',
        departureTime: { gte: now, lte: inThirtyDays },
      },
      select: {
        id: true,
        departureTime: true,
        preferredAircraftId: true,
        route: {
          select: {
            flightNumber: true,
            aircraftTypeIcao: true,
            estimatedMinutes: true,
            departure: { select: { icao: true } },
            arrival: { select: { icao: true } },
          },
        },
        // Count existing assignments for this flight, so UI can show
        // "already 2 pilots assigned" badge (nice-to-have, low cost).
        _count: { select: { rosterAssignments: true } },
      },
      orderBy: { departureTime: 'asc' },
      take: 500,
    }),
    prisma.aircraft.findMany({
      where: {
        airlineId: user.airlineId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        registration: true,
        type: true,
      },
      orderBy: { registration: 'asc' },
    }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="text-sm text-muted-foreground">
          <Link
            href="/airline/roster"
            className="hover:text-foreground hover:underline"
          >
            Roster
          </Link>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <span>Neue Zuweisung</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">✏️ Neue Roster-Zuweisung</h1>
        <p className="text-sm text-muted-foreground">
          Weise einen Pilot manuell zu einem oder mehreren Flügen zu.
          Eligibility-checks (Type-Rating, Lizenzen, Konflikte) laufen
          automatisch — Warnings können bei Bedarf übersteuert werden.
        </p>
      </header>

      {pilots.length === 0 ? (
        <EmptyState reason="no-pilots" />
      ) : scheduledFlights.length === 0 ? (
        <EmptyState reason="no-flights" />
      ) : (
        <RosterCreatorForm
          pilots={pilots.map((p) => ({
            id: p.id,
            name: p.name,
            image: p.image,
            totalFlightHours: p.totalFlightHours,
            rankName: p.rank?.name ?? null,
          }))}
          flights={scheduledFlights.map((f) => ({
            id: f.id,
            departureTime: f.departureTime.toISOString(),
            flightNumber: f.route.flightNumber,
            aircraftTypeIcao: f.route.aircraftTypeIcao,
            estimatedMinutes: f.route.estimatedMinutes,
            depIcao: f.route.departure.icao,
            arrIcao: f.route.arrival.icao,
            existingAssignmentCount: f._count.rosterAssignments,
          }))}
          aircraft={aircraft.map((a) => ({
            id: a.id,
            registration: a.registration,
            type: a.type,
          }))}
        />
      )}
    </main>
  );
}

function EmptyState({ reason }: { reason: 'no-pilots' | 'no-flights' }) {
  const message =
    reason === 'no-pilots'
      ? 'Keine aktiven Piloten in der Airline. Aktiviere mindestens einen Piloten bevor du Roster-Assignments erstellen kannst.'
      : 'Keine geplanten Flüge in den nächsten 30 Tagen. Erstelle erst Schedule-Templates und generiere Instanzen unter /airline/schedule.';

  return (
    <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/10 p-12 text-center text-amber-700 dark:text-amber-400">
      <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
      <p className="text-sm">{message}</p>
      <Link
        href="/airline/roster"
        className="inline-block mt-4 text-sm font-medium text-amber-700 dark:text-amber-400 hover:underline"
      >
        ← Zurück zum Roster
      </Link>
    </div>
  );
}
