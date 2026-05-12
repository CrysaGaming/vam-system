import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { AutoRosterClient } from './auto-roster-client';

/**
 * Track 5 #28 (Section F) — /airline/roster/auto
 *
 * Auto-Rostering wizard. Drei-stage workflow:
 *   1. CONFIG: admin wählt date-range + pilot-filter (whitelist /
 *      blacklist) + optional max-flights-per-pilot cap.
 *   2. PREVIEW: server berechnet vorschläge via
 *      `previewAutoRoster` (read-only). Tabelle zeigt pro flight
 *      welcher pilot gepicked wurde (oder warum nicht).
 *   3. COMMIT: admin klickt "Übernehmen", server gruppiert by pilot
 *      und ruft `commitAutoRosterAssignments` mit source='auto'.
 *
 * Page selbst ist ein server-component der nur die pilot-liste lädt
 * für den filter-picker; der wizard-state läuft komplett im
 * client-component AutoRosterClient.
 *
 * # Warum kein RSC-only-flow?
 *
 * Wir könnten config als query-params encoden (?from=X&to=Y) und der
 * server würde direkt preview rendern. Aber:
 *   - URL-state für arrays (pilotIdsWhitelist[]) ist ugly.
 *   - Wir wollen den admin durch preview-review-loop schleifen lassen
 *     ohne URL-thrash.
 *   - Commit ist ein actions-call, kein navigate. Client-orchestriert
 *     den state-übergang preview → committed.
 */
export default async function AutoRosterPage() {
  const user = await requireAirlineManagerWithAirlinePage();

  // Pilot-liste für filter-pickers. Active pilots, sortiert by name.
  const pilots = await prisma.user.findMany({
    where: {
      airlineId: user.airlineId,
      employmentStatus: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      totalFlightHours: true,
      rank: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Default date-range: heute → in 7 tagen. Admin kann das im form ändern.
  // Wir formatieren als YYYY-MM-DD (HTML date input format), uhrzeit wird
  // beim submit auf 00:00:00Z (from) und 23:59:59Z (to) gepatcht.
  const today = new Date();
  const inSevenDays = new Date(today.getTime() + 7 * 24 * 60 * 60_000);
  const toIsoDate = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="text-sm text-muted-foreground">
          <Link
            href="/airline/roster"
            className="hover:text-foreground hover:underline"
          >
            Roster
          </Link>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <span>Auto-Rostering</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">🤖 Auto-Rostering</h1>
        <p className="text-sm text-muted-foreground">
          Generiere Roster-Assignments automatisch mit fairness-rotation.
          Algorithmus verteilt anstehende Flüge an eligible Piloten,
          bevorzugt aktive Piloten mit niedriger Auslastung in der Periode.
        </p>
      </header>

      {pilots.length === 0 ? (
        <EmptyState />
      ) : (
        <AutoRosterClient
          pilots={pilots.map((p) => ({
            id: p.id,
            name: p.name,
            totalFlightHours: p.totalFlightHours,
            rankName: p.rank?.name ?? null,
          }))}
          defaultFromDate={toIsoDate(today)}
          defaultToDate={toIsoDate(inSevenDays)}
        />
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/10 p-12 text-center text-amber-700 dark:text-amber-400">
      <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
      <p className="text-sm">
        Keine aktiven Piloten in der Airline. Auto-Rostering braucht mindestens
        einen aktiven Piloten.
      </p>
      <Link
        href="/airline/roster"
        className="inline-block mt-4 text-sm font-medium text-amber-700 dark:text-amber-400 hover:underline"
      >
        ← Zurück zum Roster
      </Link>
    </div>
  );
}
