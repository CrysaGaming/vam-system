import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
import { EconomyCard } from './economy-card';
import { CareerCard } from './career-card';

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
      // Welle 11 commit 11C: Twitch-account-fields. Username + verifiedAt
      // werden in der ConnectionCard angezeigt; userId ist optional (in
      // der card als ID-fallback wenn username null wäre, aber username
      // ist beim erfolgreichen connect immer gesetzt). Tokens lesen wir
      // hier NICHT — die brauchen wir nur in den OAuth-routes und im
      // bot-EventSub. Settings-page-load soll keine secrets in die
      // server-component-render-payload ziehen.
      twitchUserId: true,
      twitchUsername: true,
      twitchVerifiedAt: true,
      simBriefUsername: true,
      // Welle 13D-1: economy-flag + airline-flag für die <EconomyCard>
      // im Profil-tab. user.economyEnabled ist der toggle-state, die
      // airline-flag dient für den hint-text wenn beide voneinander
      // abhängen. Wenn user.airlineId null, ist airline.economyEnabled
      // ebenfalls null.
      economyEnabled: true,
      // Welle 13E-3: career-flag analog zu economy. Selber dual-flag-
      // pattern — User.careerEnabled UND Airline.careerEnabled müssen
      // beide true sein für aktive license-gates.
      careerEnabled: true,
      airline: {
        select: { economyEnabled: true, careerEnabled: true },
      },
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
    <>
      <Card className="gap-4 p-6">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
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
                className="h-16 w-16 rounded-full border border-border"
              />
            </picture>
          ) : (
            <div className="h-16 w-16 rounded-full border border-border bg-muted" />
          )}
          <div>
            <p className="text-lg font-semibold">{user.name ?? 'Unbenannt'}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </Card>

      {/* Welle 13D-1: Economy opt-in. Bewusst im Profil-tab statt
          eigene tab — economy-features sind persönliche präferenzen
          (wie der avatar oder die display-name), keine separate
          domain. Sichtbar für ALLE user (auch ohne airline) damit
          das mental-model "ich aktivier das, sobald airline ready
          ist" möglich bleibt. EconomyCard rendert eigene hint-states
          basierend auf hasAirline + airlineEconomyEnabled. */}
      <div className="mt-6">
        <EconomyCard
          initialEnabled={user.economyEnabled}
          airlineEconomyEnabled={user.airline?.economyEnabled ?? null}
          hasAirline={!!user.airline}
        />
      </div>

      {/* Welle 13E-3: Career opt-in. Direkt unter EconomyCard im Profil-
          tab — identisches dual-flag-pattern, sodass user beide opt-ins
          räumlich nebeneinander sieht. Career ist konzeptionell unabhängig
          von Economy: ein pilot kann Career ohne Economy haben (license-
          gates aber kein wallet) oder vice versa (wallet aber keine
          license-gates). Beide einzeln togglebar. */}
      <div className="mt-6">
        <CareerCard
          initialEnabled={user.careerEnabled}
          airlineCareerEnabled={user.airline?.careerEnabled ?? null}
          hasAirline={!!user.airline}
        />
      </div>
    </>
  );

  const connectionsContent = (
    <Card className="gap-4 p-6">
      <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
        Account-Verknüpfungen
      </h2>
      <p className="text-sm text-muted-foreground">
        Verknüpfe deine Netzwerk-Accounts um Live-Tracking, Flight-Stats und
        automatische PIREP-Erkennung zu aktivieren.
      </p>

      <div className="flex flex-col gap-4">
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

        {/*
          Welle 11 commit 11C: Twitch-card. Stack mit den anderen
          netzwerk-cards weil "account-verknüpfung" die richtige
          mental-map ist (eine eigene "streaming"-tab wäre verwirrend
          gewesen — der pilot denkt "ich link mein twitch-account",
          nicht "ich konfiguriere streaming"). Twitch-spezifika:
            - accountId zeigt twitchUsername (display-name) statt der
              numerischen user-id — viel besser scannbar im UI.
              twitchUsername ist beim erfolgreichen connect immer
              gesetzt; defensives toString-fallback für die unwahr-
              scheinliche edge-case dass nur die userId persistiert
              wurde.
            - Lila brand-color (#9146FF, twitch's offizieller hex)
              via bg-purple-500 — exakte twitch-purple ist nicht in
              der tailwind-default-palette, der unterschied ist im
              kleinen 40px-circle nicht relevant.
            - icon = 📺 — generisches stream-symbol, nicht das twitch-
              glitch-logo (vermeidet trademark-konflikt + braucht keine
              SVG-import-pipeline).
            - canDisconnect=true: pilot kann jederzeit unlinken,
              callback /api/auth/twitch/disconnect cleart DB + revoked
              token bei twitch.
        */}
        <ConnectionCard
          provider="twitch"
          name="Twitch"
          icon="📺"
          colorClass="bg-purple-500"
          connected={!!user.twitchUserId}
          accountId={user.twitchUsername ?? user.twitchUserId ?? null}
          verified={!!user.twitchVerifiedAt}
          verifiedAt={user.twitchVerifiedAt}
          canDisconnect={true}
        />
      </div>
    </Card>
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
      <Card className="gap-4 p-6">
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
          OBS-Overlay
        </h2>
        <p className="text-sm text-muted-foreground">
          Live-Flugdaten für Twitch/YouTube-Streams. URL als Browser-Source
          in OBS einfügen, zeigt während des Fluges automatisch deine
          Live-Daten an.
        </p>
        <OverlayCard token={overlayToken} />
      </Card>

      <section className="mt-8">
        <OverlayPreferences
          initialLayout={overlayPrefs.layout}
          initialCardPosition={overlayPrefs.cardPosition}
          initialColors={overlayPrefs.phaseColors}
          initialBranding={overlayPrefs.branding}
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
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex items-center justify-between border-b border-border pb-6">
          <div>
            <h1 className="text-3xl font-bold">Einstellungen</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Account-Verknüpfungen und Präferenzen
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard">← Dashboard</Link>
          </Button>
        </header>

        {statusBanner && (
          <Alert
            variant={statusBanner.type === 'success' ? 'default' : 'destructive'}
            className={
              statusBanner.type === 'success'
                ? 'mb-6 border-green-500/30 bg-green-500/10'
                : 'mb-6 border-red-500/30 bg-red-500/10'
            }
          >
            <AlertDescription
              className={
                statusBanner.type === 'success'
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
              }
            >
              {statusBanner.message}
            </AlertDescription>
          </Alert>
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
