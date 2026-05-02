import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { AdminPilotsTable, type AdminUser } from './admin-pilots-table';

/**
 * Admin-only globale Piloten-übersicht. Zeigt ALLE user des VAM-Systems
 * — cross-airline, inklusive user ohne airline-zugehörigkeit.
 *
 * Abgrenzung zu /pilots: dort werden nur user der eigenen airline
 * gefiltert (where: { airlineId: currentUser.airlineId }) — das ist
 * die "Mitglieder meiner Airline"-ansicht für alle airline-members.
 * Diese page hier ist die "alle user von VAM-System"-ansicht und
 * gehört in den Admin-sektor des Sidebars.
 *
 * Auth-gate: strict admin-only. airline-admin / instructor sollen das
 * NICHT sehen — sie haben nur airline-scoped management-rechte über
 * /airline (members ihrer eigenen airline). Cross-airline-sicht ist
 * eine system-admin-funktion.
 *
 * Architektur (Phase 1, 2026-05-02):
 *   - Diese page bleibt RSC für data-fetch + auth-gate
 *   - admin-pilots-table.tsx ('use client') macht filter/sort/pagination
 *   - Kein server-action — read-only feature-set; cross-airline-writes
 *     (delete user, force-airline-change, impersonate) sind absichtlich
 *     ausgeschlossen weil sie ein eigenes design-doc + safety-review
 *     verdienen
 *
 * Performance: prisma.user.findMany ohne pagination scannt die ganze
 * user-tabelle. Der client kriegt initial alle daten und filtert
 * clientside — bei aktuellem userbase (handvoll) unproblematisch. Bei
 * 500+ users muss zu serverside-pagination via URL-search-params (siehe
 * comment in admin-pilots-table.tsx).
 */
export default async function AdminPilotsList() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  // Page-level admin-gate. Spiegelt requireAdmin() in admin/roles/actions.ts.
  // Im Sidebar (AppShell.tsx Admin-sektor) wird der link nur für isAdmin
  // gerendert, aber wir prüfen hier nochmal weil URL-direktzugriff diesen
  // client-seitigen gate umgeht. Backend-gates sind die echte safety-line.
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!currentUser?.role || currentUser.role.name !== 'admin') {
    redirect('/dashboard');
  }

  // Alle user fetchen, mit rank/role/airline für die anzeige. Sortierung
  // hier ist nur die initial-default — die client-component erlaubt dem
  // user den sort-key zu wechseln. Trotzdem sinnvoll als fallback wenn
  // Js disabled ist + als deterministische rendering-reihenfolge für SSR.
  const users = await prisma.user.findMany({
    include: {
      rank: { select: { name: true } },
      role: { select: { name: true } },
      airline: { select: { id: true, name: true, icao: true } },
    },
    orderBy: [
      { totalFlightHours: 'desc' },
      { totalFlights: 'desc' },
      { createdAt: 'asc' },
    ],
  });

  // Stats für die page-header (vor-filter-counts). Distinct airlines +
  // user ohne airline. Hilft dem admin die scope sofort einzuordnen.
  const distinctAirlineIds = new Set(
    users.map((u) => u.airlineId).filter((id): id is string => id !== null),
  );
  const airlineCount = distinctAirlineIds.size;
  const noAirlineCount = users.filter((u) => !u.airlineId).length;

  // Filter-options für die client-component dropdowns. Wir liefern nur
  // airlines/rollen die mind. 1x in der user-liste vorkommen — sonst
  // wäre der dropdown unnötig lang und der user könnte nach dingen
  // filtern die garantiert keine treffer haben.
  const availableAirlines = Array.from(
    users.reduce((map, u) => {
      if (u.airline) map.set(u.airline.id, u.airline);
      return map;
    }, new Map<string, { id: string; name: string; icao: string }>()).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const availableRoles = Array.from(
    new Set(
      users.map((u) => u.role?.name).filter((n): n is string => n !== undefined),
    ),
  )
    .sort()
    .map((name) => ({ name }));

  // Alle rollen aus DB für den bulk-assign-dropdown. Anders als
  // availableRoles (nur rollen die mind. 1x vergeben sind, für den
  // filter) brauchen wir hier ALLE rollen + ihre id, damit der admin
  // auch eine bisher nicht zugewiesene rolle (z.B. neu erstellt) per
  // bulk verteilen kann. Sortierung: createdAt asc damit system-rollen
  // (die zuerst durch seed angelegt wurden) oben stehen.
  const allRoles = await prisma.role.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { createdAt: 'asc' },
  });

  // Map zu AdminUser-shape — explicit typing damit der client-component
  // die richtige struktur kriegt, nicht das raw prisma-result mit allen
  // Date-objects, FK-felder etc.
  const adminUsers: AdminUser[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    totalFlightHours: u.totalFlightHours,
    totalFlights: u.totalFlights,
    createdAt: u.createdAt,
    rank: u.rank,
    role: u.role,
    airline: u.airline,
  }));

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Alle Piloten</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {users.length} {users.length === 1 ? 'User' : 'User'} im VAM-System
              {airlineCount > 0 && (
                <>
                  {' · '}
                  {airlineCount} {airlineCount === 1 ? 'Airline' : 'Airlines'}
                </>
              )}
              {noAirlineCount > 0 && (
                <>
                  {' · '}
                  {noAirlineCount} ohne Airline
                </>
              )}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <AdminPilotsTable
          users={adminUsers}
          availableAirlines={availableAirlines}
          availableRoles={availableRoles}
          allRoles={allRoles}
          currentUserId={currentUser.id}
        />
      </div>
    </main>
  );
}
