import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import {
  listAirlineMembers,
  listAvailableRoles,
  getAirlineSettings,
} from './actions';
import { listInvites, listRolesForInvite } from './invites-actions';
import { MemberTable } from './member-table';
import { AirlineSettingsForm } from './airline-settings-form';
import { InviteSection } from './invite-section';

/**
 * Airline-Admin-Panel. Gated on role.name === 'admin' AND user.airlineId
 * present. The double gate is intentional — global admin without an
 * airline still has nothing to manage here.
 *
 * Two main sections:
 *   1) Members table with role-assignment dropdowns
 *   2) Airline metadata form (name, callsign, IATA, logoUrl)
 */
export default async function AirlineAdminPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin' || !user.airlineId) {
    redirect('/dashboard');
  }

  const [members, roles, settings, invites, inviteRoles] = await Promise.all([
    listAirlineMembers(),
    listAvailableRoles(),
    getAirlineSettings(),
    listInvites(),
    listRolesForInvite(),
  ]);

  // App-URL für invite-link construction. Falls process.env.NEXTAUTH_URL
  // nicht gesetzt → fall back auf relative path-only links (browser
  // löst die selbst auf), aber dann ist der copy-link nutzlos. In
  // production sollte die env immer da sein.
  const appUrl =
    process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">{settings.name}</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Airline-Verwaltung · {settings.icao}
              {settings.iata && ` · ${settings.iata}`}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <div className="space-y-6">
          <MemberTable
            members={members}
            roles={roles}
            currentUserId={user.id}
          />
          <InviteSection
            invites={invites}
            roles={inviteRoles}
            appUrl={appUrl}
          />
          <AirlineSettingsForm initial={settings} />
        </div>
      </div>
    </main>
  );
}
