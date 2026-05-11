import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import {
  listAirlineMembers,
  listAvailableRoles,
  listAvailableRanks,
  getAirlineSettings,
  getDiscordTemplates,
} from './actions';
import { listInvites, listRolesForInvite } from './invites-actions';
import { MemberTable } from './member-table';
import { AirlineSettingsForm } from './airline-settings-form';
import { InviteSection } from './invite-section';
import { DiscordTemplatesForm } from './discord-templates-form';

/**
 * Airline-Admin-Panel. Gated on role ∈ {admin, airline-admin, instructor}
 * AND user.airlineId present. Die rolle-liste matcht AIRLINE_MANAGER_ROLES
 * in actions.ts — wenn die liste hier divergiert, sehen User den Sidebar-
 * link aber kommen auf /dashboard zurück (verwirrend). Die double gate
 * ist intentional: ein global-admin ohne airline-zuordnung hat hier
 * nichts zu verwalten.
 *
 * Two main sections:
 *   1) Members table with role-assignment dropdowns
 *   2) Airline metadata form (name, callsign, IATA, logoUrl)
 */
export default async function AirlineAdminPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  const [members, roles, ranks, settings, invites, inviteRoles, discordTemplates] =
    await Promise.all([
      listAirlineMembers(),
      listAvailableRoles(),
      listAvailableRanks(),
      getAirlineSettings(),
      listInvites(),
      listRolesForInvite(),
      getDiscordTemplates(),
    ]);

  // App-URL für invite-link construction. Falls process.env.NEXTAUTH_URL
  // nicht gesetzt → fall back auf relative path-only links (browser
  // löst die selbst auf), aber dann ist der copy-link nutzlos. In
  // production sollte die env immer da sein.
  const appUrl =
    process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
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
            ranks={ranks}
            currentUserId={user.id}
            currentUserIsAdmin={user.role.name === 'admin'}
          />
          {/* InviteSection + Settings nebeneinander auf lg+. Beide sind
              admin-tasks der gleichen kategorie und passen visuell gut
              als 2-spalten-layout. Auf schmalen viewports (<lg) stacken
              sie wie früher untereinander. Die MemberTable bleibt full-
              width darüber weil die viele spalten hat und davon profitiert. */}
          <div className="grid gap-6 lg:grid-cols-2">
            <InviteSection
              invites={invites}
              roles={inviteRoles}
              appUrl={appUrl}
            />
            <AirlineSettingsForm initial={settings} />
          </div>
          {/* Track 4 #83 (Section P): Discord-template-overrides. Full-width
              card unter den 2-col-sections weil die hint-spalte rechts auf
              schmalen viewports bereits eine 2nd column innerhalb der card
              hat — eine 3rd dimension wäre too much. */}
          <DiscordTemplatesForm initial={discordTemplates} />
        </div>
      </div>
    </main>
  );
}
