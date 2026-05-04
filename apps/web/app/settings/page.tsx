import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { ConnectionCard } from './connection-card';
import { OverlayCard } from './overlay-card';
import {
  getOrCreateOverlayToken,
  getAirlineSimBriefOverlay,
  listAirlineFleets,
  listAirlineAircraft,
  listAirlineRoutes,
} from './actions';
import { OverlayPreferences } from './overlay-preferences';
import { getOverlayPreferences } from './overlay-actions';
import { SimBriefCard } from './simbrief-card';
import { AirlineOverlayCard } from './airline-overlay-card';
import { FleetOverlayCard } from './fleet-overlay-card';
import { AircraftOverlayCard } from './aircraft-overlay-card';
import { RouteOverlayCard } from './route-overlay-card';
import { CollapsibleSection } from './_collapsible-section';
import { SettingsTabs } from './settings-tabs';
import { AcarsCard } from './acars-card';
import { getAcarsStatus } from './acars-actions';

/**
 * Settings page — refactored from a long single-column layout into 4
 * tabs (#15). Server-rendering pattern unchanged: this page does all
 * the data-fetching, then composes per-tab JSX trees and hands them
 * as ReactNode props to <SettingsTabs/>. The client component handles
 * the visibility-toggle + URL-hash deep-linking.
 *
 * Tab-content unchanged from the pre-refactor layout — the cards and
 * sections inside each tab are the same components, just grouped and
 * relabeled. No internal-component logic touched.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; provider?: string; reason?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await searchParams;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      discordId: true,
      vatsimCid: true,
      vatsimVerifiedAt: true,
      ivaoVid: true,
      ivaoVerifiedAt: true,
      simBriefUsername: true,
    },
  });

  if (!user) redirect('/');

  // OBS-Overlay-Token laden (oder generieren falls nicht vorhanden)
  const overlayToken = await getOrCreateOverlayToken();

  // OBS-Overlay User-Preferences laden (Layout + Phase-Colors)
  const overlayPrefs = await getOverlayPreferences();

  // SimBrief Airline-Overlay (Ebene 1 der Override-Hierarchie). Null
  // bedeutet "User ist keiner Airline zugeordnet" — Card wird dann nicht
  // gerendert.
  const airlineOverlay = await getAirlineSimBriefOverlay();

  // SimBrief Fleet-Overlays (Ebene 2). Empty array if user has no airline
  // — same hide-card semantic as airlineOverlay null.
  const fleets = await listAirlineFleets();

  // SimBrief Aircraft-Overlays (Ebene 3) + Route-Overlays (Ebene 4).
  // Both edit-only — the rows exist independently of overlay state.
  const aircraft = await listAirlineAircraft();
  const routes = await listAirlineRoutes();

  // ACARS pairing-status + active-session info for the ACARS-tab card.
  const acarsStatus = await getAcarsStatus();

  const statusBanner =
    params.status === 'success' && params.provider
      ? {
          type: 'success' as const,
          message: `${params.provider.toUpperCase()} erfolgreich verbunden`,
        }
      : params.status === 'error' && params.provider
        ? {
            type: 'error' as const,
            message: `Verbindung mit ${params.provider.toUpperCase()} fehlgeschlagen${params.reason ? `: ${params.reason}` : ''}`,
          }
        : params.status === 'disconnected' && params.provider
          ? {
              type: 'success' as const,
              message: `${params.provider.toUpperCase()} getrennt`,
            }
          : null;

  // === Per-tab content as JSX trees. The status banner is rendered
  //     above the tab-bar (not inside any tab) so connection-status
  //     messages remain visible regardless of which tab is open. ===

  const profileContent = (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
        Profil
      </h2>
      <div className="flex items-center gap-4">
        {/* user.image wird in <picture> gewrapped — siehe
            components/AppShell.tsx:BrandLink für den vollen kontext zur
            preload-warning + warum comments außerhalb des ternary
            stehen müssen (Turbopack-comment-stripping bug). */}
        {user.image ? (
          <picture>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={user.image}
              alt={user.name ?? 'Avatar'}
              className="w-16 h-16 rounded-full border border-gray-300 dark:border-gray-700"
            />
          </picture>
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700" />
        )}
        <div>
          <p className="text-lg font-semibold">{user.name ?? 'Unbenannt'}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
        </div>
      </div>
    </section>
  );

  const connectionsContent = (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
        Account-Verknüpfungen
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Verknüpfe deine Netzwerk-Accounts um Live-Tracking, Flight-Stats und
        automatische PIREP-Erkennung zu aktivieren.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <ConnectionCard
          provider="discord"
          name="Discord"
          icon="💬"
          colorClass="bg-indigo-500"
          connected={!!user.discordId}
          accountId={user.discordId}
          verified={true}
          note="Über Discord verbunden — wird für Login verwendet"
          canDisconnect={false}
        />

        <ConnectionCard
          provider="vatsim"
          name="VATSIM"
          icon="✈️"
          colorClass="bg-blue-500"
          connected={!!user.vatsimCid}
          accountId={user.vatsimCid?.toString() ?? null}
          verified={!!user.vatsimVerifiedAt}
          verifiedAt={user.vatsimVerifiedAt}
          canDisconnect={true}
        />

        <ConnectionCard
          provider="ivao"
          name="IVAO"
          icon="🛫"
          colorClass="bg-emerald-500"
          connected={!!user.ivaoVid}
          accountId={user.ivaoVid?.toString() ?? null}
          verified={!!user.ivaoVerifiedAt}
          verifiedAt={user.ivaoVerifiedAt}
          canDisconnect={true}
        />
      </div>
    </section>
  );

  const simbriefContent = (
    <>
      <SimBriefCard
        initialUsername={user.simBriefUsername}
        patternZAvailable={!!process.env.SIMBRIEF_API_KEY}
        suggestedUsername={user.name}
      />

      {/*
        Override-Hierarchie editor (Airline / Ebene 1). Only renders if
        the user is associated with an airline — getAirlineSimBriefOverlay
        returns null otherwise. Fleet/Aircraft/Route editors are additional
        cards below.
      */}
      {airlineOverlay !== null && (
        <div className="mt-6 space-y-3">
          <CollapsibleSection
            title="SimBrief Override (Airline)"
            badge={(() => {
              const c = Object.keys(airlineOverlay).length;
              return `${c} ${c === 1 ? 'Override' : 'Overrides'}`;
            })()}
            defaultOpen={true}
          >
            <AirlineOverlayCard initial={airlineOverlay} />
          </CollapsibleSection>

          <CollapsibleSection
            title="SimBrief Override (Fleet)"
            badge={`${fleets.length} ${fleets.length === 1 ? 'Eintrag' : 'Einträge'}`}
            defaultOpen={false}
          >
            <FleetOverlayCard initial={fleets} />
          </CollapsibleSection>

          <CollapsibleSection
            title="SimBrief Override (Aircraft)"
            badge={(() => {
              const withOverrides = aircraft.filter(
                (a) => a.populatedCount > 0,
              ).length;
              return `${withOverrides} / ${aircraft.length} mit Overrides`;
            })()}
            defaultOpen={false}
          >
            <AircraftOverlayCard initial={aircraft} />
          </CollapsibleSection>

          <CollapsibleSection
            title="SimBrief Override (Route)"
            badge={(() => {
              const withOverrides = routes.filter(
                (r) => r.populatedCount > 0,
              ).length;
              return `${withOverrides} / ${routes.length} mit Overrides`;
            })()}
            defaultOpen={false}
          >
            <RouteOverlayCard initial={routes} />
          </CollapsibleSection>
        </div>
      )}
    </>
  );

  const overlayContent = (
    <>
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
          OBS-Overlay
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Live-Flugdaten für Twitch/YouTube-Streams. URL als Browser-Source
          in OBS einfügen, zeigt während des Fluges automatisch deine
          Live-Daten an.
        </p>
        <OverlayCard token={overlayToken} />
      </section>

      <section className="mt-8">
        <OverlayPreferences
          initialLayout={overlayPrefs.layout}
          initialCardPosition={overlayPrefs.cardPosition}
          initialColors={overlayPrefs.phaseColors}
          callsign={user.name}
          overlayUrl={`${process.env.NEXTAUTH_URL ?? 'https://vam.kevindrack.de'}/overlay/${overlayToken}`}
        />
      </section>
    </>
  );

  const acarsContent = (
    <AcarsCard
      initial={acarsStatus}
      vatsimLinked={!!user.vatsimCid}
      ivaoLinked={!!user.ivaoVid}
    />
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Einstellungen</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Account-Verknüpfungen und Präferenzen
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        {statusBanner && (
          <div
            className={`mb-6 px-4 py-3 rounded border text-sm ${
              statusBanner.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300'
                : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
            }`}
          >
            {statusBanner.message}
          </div>
        )}

        <SettingsTabs
          profileContent={profileContent}
          connectionsContent={connectionsContent}
          simbriefContent={simbriefContent}
          overlayContent={overlayContent}
          acarsContent={acarsContent}
        />
      </div>
    </main>
  );
}
