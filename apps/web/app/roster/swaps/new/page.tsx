import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import {
  getAssignmentById,
  prisma,
  type RosterAssignmentStatus,
} from '@vam/db';
import Link from 'next/link';
import { SwapNewForm } from './swap-new-form';

/**
 * Track 5 #29 — /roster/swaps/new?assignmentId=...
 *
 * Initiate-swap page. Erwartet `assignmentId` als query-param — die
 * MEINE assignment die ich abgeben will. Zeigt dann eine liste aller
 * eligible target-assignments (andere pilots, selbe airline, ähnliche
 * future-zeitfenster).
 *
 * # Eligible targets filter
 *
 *   - status: ASSIGNED oder ACCEPTED (kein swap mit completed/no-show)
 *   - airline: gleich
 *   - pilot: NICHT ich
 *   - departureTime: ±30 tage um meine assignment (sonst ist die liste
 *     riesig + die meisten swaps sind eh in einem ähnlichen zeitfenster)
 *
 * # Was nicht hier ist
 *
 *   - Compatibility-check (kann ich das aircraft fliegen, kann der
 *     andere meines fliegen). Der createSwapRequest-helper macht keine
 *     eligibility-checks — das ist intentional MVP. Wenn nach swap ein
 *     pilot ohne type-rating dasteht, ist das ein admin-problem (er
 *     kann die assignment cancel-en). Spätere version könnte hier
 *     `checkRosterEligibility` integrieren für UX-pre-warn.
 */

type SearchParams = Promise<{ assignmentId?: string }>;

export default async function NewSwapPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const userId = session.user.id;
  const params = await searchParams;
  const assignmentId = params.assignmentId;

  if (!assignmentId) {
    return (
      <ErrorPage
        message="Keine Assignment angegeben."
        helpText="Du musst eine eigene Assignment auswählen, die du abgeben willst. Geh zu deinem Dashboard und klick auf das Swap-Icon bei einer deiner Assignments."
      />
    );
  }

  const myAssignment = await getAssignmentById(assignmentId);
  if (!myAssignment) {
    return <ErrorPage message="Assignment nicht gefunden." />;
  }
  if (myAssignment.pilotId !== userId) {
    return (
      <ErrorPage
        message="Das ist nicht deine Assignment."
        helpText="Du kannst nur deine eigenen Assignments zum Swap anbieten."
      />
    );
  }
  if (!['ASSIGNED', 'ACCEPTED'].includes(myAssignment.status)) {
    return (
      <ErrorPage
        message="Diese Assignment kann nicht getauscht werden."
        helpText={`Status: ${myAssignment.status}. Swap nur möglich für Zugewiesen oder Akzeptiert.`}
      />
    );
  }

  // ±30 tage window um meine assignment
  const myDeparture = myAssignment.scheduledFlight.departureTime;
  const windowStart = new Date(myDeparture.getTime() - 30 * 24 * 60 * 60_000);
  const windowEnd = new Date(myDeparture.getTime() + 30 * 24 * 60 * 60_000);

  const eligibleTargets = await prisma.rosterAssignment.findMany({
    where: {
      airlineId: myAssignment.airlineId,
      status: { in: ['ASSIGNED', 'ACCEPTED'] as RosterAssignmentStatus[] },
      pilotId: { not: userId },
      scheduledFlight: {
        departureTime: { gte: windowStart, lte: windowEnd },
      },
    },
    select: {
      id: true,
      pilot: {
        select: { id: true, name: true, image: true, rank: { select: { name: true } } },
      },
      scheduledFlight: {
        select: {
          departureTime: true,
          route: {
            select: {
              flightNumber: true,
              aircraftTypeIcao: true,
              departure: { select: { icao: true } },
              arrival: { select: { icao: true } },
            },
          },
        },
      },
    },
    orderBy: { scheduledFlight: { departureTime: 'asc' } },
    take: 100,
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground hover:underline">
            Dashboard
          </Link>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <Link href="/roster/swaps" className="hover:text-foreground hover:underline">
            Swap-Anfragen
          </Link>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <span>Neue Anfrage</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">🔄 Swap anfragen</h1>
        <p className="text-sm text-muted-foreground">
          Du gibst eine deiner Assignments ab und bekommst stattdessen eine
          andere. Beide Piloten müssen zustimmen.
        </p>
      </header>

      <SwapNewForm
        myAssignment={{
          id: myAssignment.id,
          flightNumber: myAssignment.scheduledFlight.route.flightNumber,
          departureTime: myAssignment.scheduledFlight.departureTime.toISOString(),
          depIcao: myAssignment.scheduledFlight.route.departure.icao,
          arrIcao: myAssignment.scheduledFlight.route.arrival.icao,
          aircraftTypeIcao: myAssignment.scheduledFlight.route.aircraftTypeIcao,
        }}
        candidates={eligibleTargets.map((t) => ({
          id: t.id,
          pilotId: t.pilot.id,
          pilotName: t.pilot.name,
          rankName: t.pilot.rank?.name ?? null,
          flightNumber: t.scheduledFlight.route.flightNumber,
          departureTime: t.scheduledFlight.departureTime.toISOString(),
          depIcao: t.scheduledFlight.route.departure.icao,
          arrIcao: t.scheduledFlight.route.arrival.icao,
          aircraftTypeIcao: t.scheduledFlight.route.aircraftTypeIcao,
        }))}
      />
    </main>
  );
}

function ErrorPage({ message, helpText }: { message: string; helpText?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/10 p-6 text-amber-700 dark:text-amber-400">
        <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
        <h2 className="font-bold text-lg mb-1">{message}</h2>
        {helpText && <p className="text-sm">{helpText}</p>}
        <Link
          href="/dashboard"
          className="inline-block mt-4 text-sm font-medium hover:underline"
        >
          ← Zurück zum Dashboard
        </Link>
      </div>
    </main>
  );
}
