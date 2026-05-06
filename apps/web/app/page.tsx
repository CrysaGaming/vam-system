import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';

/**
 * Public landing page (one-pager) für VAM System.
 *
 * Server-component. Authed users werden direkt zum dashboard weitergeleitet —
 * die marketing-page sehen nur unauthenticated visitors. Discord-login ist
 * über eine inline server action verkabelt (auth.js v5 pattern), identisch
 * zur originalen page.tsx-implementierung.
 *
 * Hero: full-bleed video-slot. Drop ein loop-video als
 *   apps/web/public/hero.mp4
 * (z.B. via Seedance 2.0 generiert) — wenn die file fehlt, zeigt der
 * gradient-fallback dahinter durch und das layout bleibt intakt.
 *
 * Content-data ist als top-level const-arrays organisiert (STATS, FEATURES,
 * ROADMAP_DONE, ROADMAP_NEXT, ROADMAP_VISION, TECH_STACK) — Änderungen an
 * der feature-liste brauchen keine JSX-surgery, nur die arrays editieren.
 * Die SVG-globus-illustration in der live-map-showcase-section ist
 * `GlobeIllustration` am file-ende; falls ein screenshot als
 * /public/screenshots/live-map.png existiert, einfach dort den `<img>` statt
 * der `<GlobeIllustration />` einsetzen (siehe inline-comment in der section).
 *
 * Inhalts-quellen (Stand 2026-05-04):
 * - README.md (Foundation features bis Tag 5)
 * - docs/vision/Wellen-Roadmap.md (operative wellen 0-19)
 * - docs/vision/Economy-Karriere.md (deep-dive für Wellen 12+)
 * - docs/vision/twitch-to-sim-integration.md (Welle 11+14)
 * - git log (187 commits, Wellen 4-12 alle shipped)
 */

// ============================================================================
// Content-data — top-level damit edits nicht durch die JSX müssen
// ============================================================================

const STATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '187+', label: 'Commits in 11 Tagen aktiver Entwicklung' },
  { value: '34', label: 'Prisma-Modelle in der Datenbank' },
  { value: '~3500', label: 'Live-Piloten parallel getrackt (VATSIM + IVAO)' },
  { value: '12', label: 'Abgeschlossene Wellen seit Tag 1' },
];

type FeatureBadgeColor = 'indigo' | 'green' | 'blue' | 'purple';

type FeatureIconName =
  | 'globe'
  | 'checklist'
  | 'briefcase'
  | 'shield'
  | 'discord'
  | 'chart'
  | 'antenna'
  | 'video'
  | 'calendar'
  | 'plane'
  | 'pin'
  | 'twitch';

interface Feature {
  title: string;
  description: string;
  iconName: FeatureIconName;
  badges: ReadonlyArray<{ label: string; color: FeatureBadgeColor }>;
}

const FEATURES: ReadonlyArray<Feature> = [
  {
    title: 'Live Map (3D Mapbox)',
    description:
      'Mapbox GL JS 3.x mit Hillshade, Fog und dynamischem Licht. ~3500 VATSIM- und IVAO-Piloten weltweit, METAR-Overlay mit VFR/IFR-Farbcodierung, RainViewer-Wetterradar, Cockpit-Wettereffekte gekoppelt an die nächste METAR.',
    iconName: 'globe',
    badges: [
      { label: 'Mapbox 3D', color: 'indigo' },
      { label: 'VATSIM', color: 'blue' },
      { label: 'IVAO', color: 'green' },
    ],
  },
  {
    title: 'Bookings + SimBrief',
    description:
      'Flight-Bookings mit OFP-Generierung über SimBrief. Pattern Z (Partner-API): One-Click Popup-Dispatch mit auto-close. Pattern α (Fallback): Tab-Redirect ohne API-Key. Override-Hierarchie Aircraft → Fleet → Airline → Route. Plan-vs-Actual Comparison.',
    iconName: 'briefcase',
    badges: [
      { label: 'Pattern Z', color: 'indigo' },
      { label: 'Pattern α', color: 'blue' },
    ],
  },
  {
    title: 'ACARS Telemetry & Auto-PIREP',
    description:
      'Eigener ACARS-Client mit Pairing-Code-System. Heartbeat-API, Live-Telemetry-Stream, automatische PIREP-Erstellung beim Flight-End. dataSource Quality-Tier (ACARS > VATSIM > IVAO > Manual) — angezeigt als Badge auf Live-Map und Overlay.',
    iconName: 'antenna',
    badges: [
      { label: 'Auto-PIREP', color: 'green' },
      { label: 'Pairing-Code', color: 'indigo' },
    ],
  },
  {
    title: 'Hub-System & Free-Flight',
    description:
      'Multi-Hub Airlines mit Primary-Hub, Position-Tracking pro Pilot (current location updated nach jedem PIREP). Free-Flight ohne Route-Restriction. Jumpseat-Page für Hub-Transfer mit voll auditiertem Verlauf.',
    iconName: 'pin',
    badges: [
      { label: 'Multi-Hub', color: 'indigo' },
      { label: 'Position-Tracking', color: 'blue' },
      { label: 'Jumpseat', color: 'green' },
    ],
  },
  {
    title: 'Fleet & Aircraft Management',
    description:
      'Aircraft-Type-Catalog mit Autocomplete, Subfleet-Übersicht, individuelle Airframes (D-AISL etc.) mit Status (active/maintenance/retired). Auto-Position-Update der Aircraft beim PIREP-Approval. CSV-Bulk-Import.',
    iconName: 'plane',
    badges: [
      { label: 'CRUD', color: 'indigo' },
      { label: 'Auto-Position', color: 'green' },
      { label: 'CSV-Import', color: 'blue' },
    ],
  },
  {
    title: 'Schedule Generator',
    description:
      'Recurring Schedule-Templates pro Route (welche Tage/Zeiten). Daily-Cron erzeugt Instances als "open bookings" für die nächsten 7 Tage. Pilot-Booking direkt aus dem Schedule, Week-View mit Cancel-Option.',
    iconName: 'calendar',
    badges: [
      { label: 'Recurring', color: 'indigo' },
      { label: 'Auto-Generation', color: 'green' },
    ],
  },
  {
    title: 'Public Airline Pages',
    description:
      'Jede Airline kriegt eine öffentliche Landing-Page unter /a/[icao] mit Branding (Logo + Custom-Colors), Roster, Fleet, Routes und Recent-PIREPs. Globales Airline-Directory unter /airlines listet alle public-visible VAs.',
    iconName: 'shield',
    badges: [
      { label: 'Branding', color: 'indigo' },
      { label: 'Multi-Tenant', color: 'blue' },
    ],
  },
  {
    title: 'Streamer Overlay (OBS)',
    description:
      'Browser-Source für OBS mit Cockpit-Layout, Live-ACARS-Telemetry-Feldern, SVG-Mini-Map mit Trail-Polyline. Custom-Branding (Logo + Farben) pro Streamer. Twitch-OAuth + EventSub-WebSocket für künftige Channel-Point-Integration.',
    iconName: 'video',
    badges: [
      { label: 'OBS-Ready', color: 'indigo' },
      { label: 'Twitch', color: 'purple' },
    ],
  },
  {
    title: 'Discord-First Multi-Network',
    description:
      'Discord-Login (NextAuth v5) als primärer Anker, optional VATSIM, IVAO und Twitch-Accounts verknüpfen. Discord-Bot mit 5 Slash-Commands, automatischer Role-Sync bei Rank-Up, PIREP-Embeds in #pireps, Auto-Onboarding für neue Piloten.',
    iconName: 'discord',
    badges: [
      { label: 'Discord', color: 'indigo' },
      { label: 'VATSIM', color: 'blue' },
      { label: 'IVAO', color: 'green' },
      { label: 'Twitch', color: 'purple' },
    ],
  },
];

const ROADMAP_DONE: ReadonlyArray<string> = [
  'Discord + VATSIM + IVAO + Twitch OAuth (multi-network linking)',
  'Auto-Onboarding für neue Piloten als Trainees',
  '3D-Live-Map mit Hillshade, Fog, dynamischem Licht',
  'Worldwide VATSIM + IVAO Tracking (~3500 Piloten parallel)',
  'METAR-Overlay + RainViewer Worldwide Radar',
  'Cockpit-Wettereffekte (METAR-gekoppelt, auto + manual)',
  'PIREP-Workflow + Approval + Auto-Rank-Up',
  'Bookings + SimBrief Pattern Z & Pattern α',
  'OFP-Override-Hierarchie (Aircraft / Fleet / Airline / Route)',
  'Plan-vs-Actual Comparison auf PIREP-Detail',
  'Hub-System mit Multi-Hub + Primary-Hub-Setting',
  'Free-Flight-Mode + Jumpseat-Page',
  'Position-Tracking (5 LocationSources mit Audit-Trail)',
  'Aircraft-Type-Catalog (System-curated, request-flow)',
  'Airport-Catalog (85.266 ICAOs aus OurAirports.com)',
  'Routes-CRUD + CSV-Bulk-Import',
  'Fleet & Aircraft Management mit Auto-Position-Update',
  'Personnel-Management + Auto-Promotion-Logic',
  'EmploymentStatus-Workflow (Active/Inactive/Terminated)',
  'Schedule-Templates + Daily-Cron für Instances',
  'Pilot-Booking direkt aus Schedule-Week-View',
  'Public Airline Pages (/a/[icao]) mit Branding',
  'Airline-Directory (/airlines)',
  'ACARS Pairing-Code + Heartbeat + Telemetry',
  'Auto-PIREP via /api/acars/event',
  'dataSource Quality-Tier-Badges in Live-Map + Overlay',
  'Streamer-Overlay mit Cockpit-Layout + Mini-Map',
  'Custom Branding (Logo + Colors) für Streamer-Overlay',
  'Twitch EventSub WebSocket-Bridge im Bot',
  'Discord Bot: 5 Slash-Commands + Event-Bridge',
  'Auto-Role-Update bei Rank-Up + Discord-Embeds',
  'Light/Dark Mode mit System-Pref-Detection',
  'Persistent Sidebar + Responsive Layout',
  'Prisma 7 + Driver-Adapter Migration (ESM)',
];

const ROADMAP_NEXT: ReadonlyArray<string> = [
  'Awards-System UI (DB-Modell existiert seit Tag 1)',
  'Sceneries-Catalog UI (Community-submitted)',
  'Callsign-Suche auf der Live-Map',
  'Public Pilot-Sidebars (Click-on-Plane für Non-Member)',
  'PIREP-Heatmap (Worldwide Route Density)',
  'Replay-Modus für Completed Flights',
  'NestJS API für 3rd-Party-Integrationen',
  'FeatureFlag Toggle-System UI',
  'Discord-Role-Mapping-Konfiguration UI',
];

const ROADMAP_VISION: ReadonlyArray<string> = [
  'Economy MVP — Wallets, Transactions, Revenue/Expense pro Flug',
  'Career-System mit Lizenzen (PPL → ATPL) und Type-Ratings',
  'Twitch-Channel-Points → Tickets — Viewer kaufen Plätze auf laufenden Flügen',
  'Subscriptions als Business/First-Class, Bits als Cargo (1 Bit = 1 kg)',
  'Hype-Train Revenue-Multiplier (+10/20/35/50/75 %)',
  'Aircraft-Marketplace mit Buy/Sell + Used-Pricing',
  'Maintenance-Checks (A/B/C/D) mit Cost + Downtime',
  'Stock-Market (VAMSE) — IPOs, Order-Matching, Bonds',
  'Multi-Airline Alliances + M&A (friendly + hostile takeover)',
  'Real-World Event-Mirror (Olympics, World-Cup, Hajj)',
  'Disaster-Events (Volcano, Fuel-Crisis, ATC-Strike)',
  'Mobile-Companion-App + VR-Airport-Tours + Voice-ATC-Bot',
];

const TECH_STACK: ReadonlyArray<string> = [
  'Next.js 16',
  'React 19',
  'Tailwind v4',
  'TypeScript strict',
  'Mapbox GL 3.x',
  'PostgreSQL 16',
  'Prisma 7',
  'Auth.js v5',
  'discord.js 14',
  'Twitch EventSub',
  'pnpm + Turborepo',
  'Docker Compose',
  'Cloudflare Tunnel',
];

// ============================================================================
// Page
// ============================================================================

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <main className="text-gray-900 dark:text-white">
      {/* ============================================================
          HERO
          ============================================================ */}
      <section className="relative isolate min-h-screen flex items-center justify-center overflow-hidden px-6 py-24">
        {/* Background-stack: gradient → video → vignette. Inline-styles für
            die gradients statt from-/via-/to-utilities — die werden v4
            manchmal nicht detected und sind hier sowieso komplexer
            (radial + linear kombiniert). */}
        <div className="absolute inset-0 -z-10">
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse at top, rgba(99, 102, 241, 0.28), transparent 55%), linear-gradient(180deg, #0a0a0a 0%, #050817 50%, #0a0a0a 100%)',
            }}
            aria-hidden="true"
          />

          {/* Video slot — drop /public/hero.mp4 hier rein (z.B. Seedance 2.0
              generiertes loop-clip, ~5–10s, 1920×1080, h264). Wenn die file
              fehlt, zeigt der gradient durch. Kein broken state. */}
          <video
            className="absolute inset-0 h-full w-full object-cover opacity-50"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
          >
            <source src="/hero.mp4" type="video/mp4" />
          </video>

          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(10, 10, 10, 0.35) 0%, rgba(10, 10, 10, 0.55) 55%, rgba(10, 10, 10, 0.95) 100%)',
            }}
            aria-hidden="true"
          />
        </div>

        <div className="relative z-10 max-w-3xl text-center space-y-8">
          {/* Status badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-sm">
            <span
              className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse"
              aria-hidden="true"
            />
            187 Commits · 34 DB-Modelle · 11 Tage
          </div>

          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-white">
            Fliege deine Airline.
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: 'linear-gradient(135deg, #818cf8 0%, #60a5fa 100%)',
              }}
            >
              Führe sie wie ein Profi.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
            Self-hosted Virtual Airline Management mit Live-Tracking auf VATSIM und IVAO,
            ACARS-Auto-PIREP, Hub-System, Schedule-Generator, Public Airline-Pages und
            Streamer-Overlay — alles in einem Stack.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <form
              action={async () => {
                'use server';
                await signIn('discord', { redirectTo: '/dashboard' });
              }}
            >
              <button
                type="submit"
                className="inline-flex items-center gap-3 px-7 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-base transition shadow-lg hover:shadow-indigo-500/40"
              >
                <DiscordIcon className="h-5 w-5" />
                <span>Mit Discord anmelden</span>
              </button>
            </form>

            <a
              href="#features"
              className="inline-flex items-center gap-2 px-6 py-3.5 text-gray-300 hover:text-white transition"
            >
              Was steckt drin?
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
      </section>

      {/* ============================================================
          STATS STRIP
          ============================================================ */}
      <section className="relative px-6 py-16 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 lg:grid-cols-2 gap-8">
            {/* 4 stats in 2x2-grid (sowohl mobile als auch desktop). */}
            {STATS.map((stat) => (
              <StatBlock key={stat.label} value={stat.value} label={stat.label} />
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          FEATURES (9 cards, 3-col on lg)
          ============================================================ */}
      <section
        id="features"
        className="relative px-6 py-24 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800"
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
              Was du heute schon machen kannst
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
              Neun Säulen, ein Stack.
            </h2>
            <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              Von der ersten Anmeldung über den Flugplan und ACARS-Telemetrie bis zum
              Streamer-Overlay und der eigenen Airline-Public-Page — komplett durchgängig.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature) => (
              <FeatureCard key={feature.title} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          LIVE MAP SHOWCASE — text + SVG illustration side-by-side
          ============================================================ */}
      <section
        id="live-map"
        className="relative px-6 py-24 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 overflow-hidden"
      >
        {/* Subtle background grid for depth */}
        <div
          className="absolute inset-0 opacity-30 dark:opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.08), transparent 60%)',
          }}
          aria-hidden="true"
        />

        <div className="relative max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: text */}
            <div className="space-y-6">
              <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                Killer-Feature
              </p>
              <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
                Die Welt fliegt — und du siehst zu.
              </h2>
              <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
                Die <strong className="text-gray-900 dark:text-white">Live Map</strong> ist
                kein Nachgedanke, sondern das Herz des Systems. Mapbox GL JS 3.x mit echtem
                3D-Terrain, dynamischem Licht und Hillshade. Alle ~3500 VATSIM- und
                IVAO-Piloten weltweit, deine Member visuell hervorgehoben.
              </p>

              <ul className="space-y-3 text-gray-600 dark:text-gray-400">
                <FeatureListItem>
                  Click-on-Plane für volle Flight-Details, Trail, Distance, ETA
                </FeatureListItem>
                <FeatureListItem>
                  METAR-Overlay mit Farbcodierung (VFR / MVFR / IFR / LIFR)
                </FeatureListItem>
                <FeatureListItem>
                  RainViewer-Wetterradar weltweit, auto-hide ab Zoom-Level 10
                </FeatureListItem>
                <FeatureListItem>
                  Cockpit-Wettereffekte — Regen / Schnee, gekoppelt an die nächste METAR
                </FeatureListItem>
                <FeatureListItem>
                  dataSource-Tier-Badge zeigt ACARS / VATSIM / IVAO / Manual pro Plane
                </FeatureListItem>
              </ul>

              <div className="pt-2">
                <a
                  href="https://vam.kevindrack.de/live"
                  className="inline-flex items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium transition"
                >
                  Live ansehen unter /live
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>

            {/* Right: SVG globe illustration. Wenn du einen screenshot der
                live-map als /public/screenshots/live-map.png ablegst, kannst
                du die <GlobeIllustration /> hier durch ein <img> ersetzen:

                  <img
                    src="/screenshots/live-map.png"
                    alt="VAM System Live Map"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-800 shadow-2xl"
                  />
            */}
            <div className="relative">
              <div
                className="absolute inset-0 -z-10 blur-3xl opacity-40"
                style={{
                  background:
                    'radial-gradient(circle, rgba(129, 140, 248, 0.4), transparent 60%)',
                }}
                aria-hidden="true"
              />
              <GlobeIllustration />
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          ROADMAP — 3 columns: Done + Soon + Vision
          ============================================================ */}
      <section
        id="roadmap"
        className="relative px-6 py-24 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800"
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
              Roadmap & Vision
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
              Vom MVP zur Welt-Mirror-Sim.
            </h2>
            <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              Gestartet vor 11 Tagen. Wo wir heute stehen — was als nächstes kommt — und
              wo die Reise hingeht. Ehrlich aufgeschlüsselt.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Done */}
            <RoadmapColumn
              title="Live im System"
              subtitle={`${ROADMAP_DONE.length} Features geshipped`}
              accent="green"
              icon={
                <svg
                  className="h-5 w-5 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              }
              items={ROADMAP_DONE}
              status="done"
            />

            {/* Soon */}
            <RoadmapColumn
              title="In Arbeit / Geplant"
              subtitle={`${ROADMAP_NEXT.length} Items im Backlog`}
              accent="indigo"
              icon={
                <svg
                  className="h-5 w-5 text-indigo-500 dark:text-indigo-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              }
              items={ROADMAP_NEXT}
              status="next"
            />

            {/* Vision */}
            <RoadmapColumn
              title="Long-Term Vision"
              subtitle={`${ROADMAP_VISION.length} Wellen ahead`}
              accent="purple"
              icon={
                <svg
                  className="h-5 w-5 text-purple-500 dark:text-purple-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              }
              items={ROADMAP_VISION}
              status="vision"
            />
          </div>

          {/* Vision-narrative block — gibt der vision-spalte den nötigen kontext.
              Erklärt warum das ambitioniert klingende auch wirklich kommt
              (referenziert Economy-Karriere.md + twitch-to-sim docs). */}
          <div className="mt-12 max-w-4xl mx-auto rounded-xl border border-purple-500/20 bg-white dark:bg-gray-900 p-8">
            <h3 className="text-2xl font-bold tracking-tight mb-3">
              Wo das ganze hinläuft
            </h3>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              VAM System ist nicht nur ein vAirline-Tracker. Die Vision: eine{' '}
              <strong className="text-gray-900 dark:text-white">
                lebendige Airline-Welt
              </strong>{' '}
              mit echter Economy, Pilot-Karrieren von SPL bis ATPL,{' '}
              <strong className="text-purple-600 dark:text-purple-400">
                Twitch-Viewern, die Tickets auf laufenden Flügen kaufen
              </strong>
              , einem Aircraft-Marketplace, einer Stock-Exchange (VAMSE) für börsennotierte
              Airlines, und Multi-Airline-Alliances inklusive M&A. Schritt für Schritt, in
              wellen — die meisten Foundation-Flags (economyEnabled, careerEnabled, FlightType)
              sind schon im Schema, kosten nichts und ersparen massive Migrationen.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-4">
              Detailliert dokumentiert in <code>docs/vision/Wellen-Roadmap.md</code> (19
              Wellen) und <code>docs/vision/Economy-Karriere.md</code> (61 Sections).
            </p>
          </div>
        </div>
      </section>

      {/* ============================================================
          TECH STACK STRIP
          ============================================================ */}
      <section className="relative px-6 py-16 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-8 uppercase tracking-wide">
            Built with
          </p>
          <div className="flex flex-wrap justify-center items-center gap-3">
            {TECH_STACK.map((tech) => (
              <span
                key={tech}
                className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-400"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          FINAL CTA
          ============================================================ */}
      <section className="relative px-6 py-24 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 overflow-hidden">
        {/* Decorative gradient blob behind CTA */}
        <div
          className="absolute inset-0 -z-10 opacity-50"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(99, 102, 241, 0.15), transparent 60%)',
          }}
          aria-hidden="true"
        />
        <div className="relative max-w-3xl mx-auto text-center space-y-8">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Bereit für den Takeoff?
          </h2>
          <p className="text-lg text-gray-500 dark:text-gray-400">
            Melde dich mit Discord an. Du landest direkt im Dashboard und kannst sofort
            deinen ersten PIREP einreichen, einen Booking starten oder dem Schedule
            folgen.
          </p>
          <form
            action={async () => {
              'use server';
              await signIn('discord', { redirectTo: '/dashboard' });
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center gap-3 px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-lg transition shadow-lg hover:shadow-indigo-500/40"
            >
              <DiscordIcon className="h-5 w-5" />
              <span>Mit Discord anmelden</span>
            </button>
          </form>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Self-hosted · Discord-First · Active Development
          </p>
        </div>
      </section>

      {/* ============================================================
          FOOTER
          ============================================================ */}
      <footer className="relative px-6 py-8 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-500 dark:text-gray-500">
          <div>© {new Date().getFullYear()} VAM System</div>
          <div className="flex items-center gap-6">
            <a
              href="https://vam.kevindrack.de/live"
              className="hover:text-gray-900 dark:hover:text-white transition"
            >
              Live Map
            </a>
            <a
              href="https://vam.kevindrack.de/airlines"
              className="hover:text-gray-900 dark:hover:text-white transition"
            >
              Airlines
            </a>
            <a
              href="https://github.com/CrysaGaming/vam-system"
              className="hover:text-gray-900 dark:hover:text-white transition"
            >
              GitHub
            </a>
            <a href="#" className="hover:text-gray-900 dark:hover:text-white transition">
              Impressum
            </a>
            <a href="#" className="hover:text-gray-900 dark:hover:text-white transition">
              Datenschutz
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ============================================================================
// Helper components — alle in dieser file gehalten weil sie ausschließlich
// von der landing-page benutzt werden. Wenn das mal woanders gebraucht wird,
// in components/landing/ extrahieren.
// ============================================================================

/**
 * Stat-block für die stats-strip-section. Große indigo zahl + label.
 */
function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div
        className="text-5xl sm:text-7xl font-bold tracking-tight bg-clip-text text-transparent"
        style={{
          backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)',
        }}
      >
        {value}
      </div>
      <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

/**
 * Feature-card für die features-grid section. Card mit icon, title,
 * description und tag-badges am ende.
 */
function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <div className="relative p-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-500/30 transition flex flex-col">
      <div className="h-10 w-10 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4">
        <FeatureIcon name={feature.iconName} />
      </div>
      <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed flex-1">
        {feature.description}
      </p>
      <div className="flex flex-wrap gap-2 mt-4">
        {feature.badges.map((badge) => (
          <Badge key={badge.label} color={badge.color}>
            {badge.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Kleiner colored badge für feature-tags. 4 farben — indigo (default),
 * blue (network: VATSIM), green (network: IVAO oder positives wie
 * Auto-Rank-Up), purple (Twitch / streaming-related). Alle 4 sind in
 * globals.css safelisted.
 */
function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: FeatureBadgeColor;
}) {
  const colorClasses = {
    indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    blue: 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400',
    green: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
    purple:
      'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400',
  } satisfies Record<FeatureBadgeColor, string>;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClasses[color]}`}
    >
      {children}
    </span>
  );
}

/**
 * Eine Spalte in der 3-spaltigen Roadmap-section. Gemeinsamer card-frame
 * mit accent-color (green/indigo/purple), icon-headline-block, dann liste
 * der items via RoadmapItem.
 */
function RoadmapColumn({
  title,
  subtitle,
  accent,
  icon,
  items,
  status,
}: {
  title: string;
  subtitle: string;
  accent: 'green' | 'indigo' | 'purple';
  icon: React.ReactNode;
  items: ReadonlyArray<string>;
  status: 'done' | 'next' | 'vision';
}) {
  const borderClass = {
    green: 'border-green-500/30',
    indigo: 'border-indigo-500/30',
    purple: 'border-purple-500/30',
  }[accent];

  const iconBgClass = {
    green: 'bg-green-500/10 border-green-500/30',
    indigo: 'bg-indigo-500/10 border-indigo-500/30',
    purple: 'bg-purple-500/10 border-purple-500/30',
  }[accent];

  return (
    <div
      className={`rounded-xl border ${borderClass} bg-white dark:bg-gray-900 p-8 flex flex-col`}
    >
      <div className="flex items-center gap-3 mb-6">
        <span
          className={`h-10 w-10 rounded-lg ${iconBgClass} border flex items-center justify-center flex-shrink-0`}
        >
          {icon}
        </span>
        <div>
          <h3 className="text-2xl font-bold tracking-tight">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>
      <ul className="space-y-3 flex-1">
        {items.map((item) => (
          <RoadmapItem key={item} status={status}>
            {item}
          </RoadmapItem>
        ))}
      </ul>
    </div>
  );
}

/**
 * Roadmap list-item mit status-dot. 3 stati:
 * - done: grünes checkmark in solid-circle
 * - next: outlined indigo arrow-circle
 * - vision: outlined purple sparkle-dot
 */
function RoadmapItem({
  children,
  status,
}: {
  children: React.ReactNode;
  status: 'done' | 'next' | 'vision';
}) {
  return (
    <li className="flex items-start gap-3 text-gray-700 dark:text-gray-300">
      {status === 'done' && (
        <span
          className="h-5 w-5 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center flex-shrink-0 mt-0.5"
          aria-label="Done"
        >
          <svg
            className="h-3 w-3 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {status === 'next' && (
        <span
          className="h-5 w-5 rounded-full border border-indigo-500/40 bg-indigo-500/10 flex-shrink-0 mt-0.5"
          aria-label="Coming next"
        />
      )}
      {status === 'vision' && (
        <span
          className="h-5 w-5 rounded-full border border-purple-500/40 bg-purple-500/10 flex items-center justify-center flex-shrink-0 mt-0.5"
          aria-label="Long-term vision"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-purple-500/60" aria-hidden="true" />
        </span>
      )}
      <span className="text-sm">{children}</span>
    </li>
  );
}

/**
 * Bullet-checkmark-item für die feature-listing in der live-map-showcase.
 */
function FeatureListItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <svg
        className="h-5 w-5 text-indigo-500 dark:text-indigo-400 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/**
 * Icon-router für FeatureCard. Maps die feature-iconName auf das passende
 * inline-SVG. Alle icons sind 20×20 (h-5 w-5) und nutzen currentColor.
 */
function FeatureIcon({ name }: { name: FeatureIconName }) {
  switch (name) {
    case 'globe':
      return <GlobeIcon />;
    case 'checklist':
      return <ChecklistIcon />;
    case 'briefcase':
      return <BriefcaseIcon />;
    case 'shield':
      return <ShieldIcon />;
    case 'discord':
      return <DiscordIcon className="h-5 w-5" />;
    case 'chart':
      return <ChartIcon />;
    case 'antenna':
      return <AntennaIcon />;
    case 'video':
      return <VideoIcon />;
    case 'calendar':
      return <CalendarIcon />;
    case 'plane':
      return <PlaneIcon />;
    case 'pin':
      return <PinIcon />;
    case 'twitch':
      return <TwitchIcon />;
  }
}

function GlobeIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
    </svg>
  );
}

/** Antenna / signal-broadcast — passt zu ACARS / Telemetry. */
function AntennaIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.636 5.636a9 9 0 1012.728 0M8.464 8.464a5 5 0 107.072 0M12 12h.01"
      />
    </svg>
  );
}

/** Video / camera — Streamer-Overlay. */
function VideoIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

/** Calendar — Schedule-Generator. */
function CalendarIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

/** Plane (paper-plane silhouette) — Fleet & Aircraft. */
function PlaneIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  );
}

/** Map-pin — Hub-System. */
function PinIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/** Twitch icon (für features-card 'Streamer Overlay' kann alternativ
    verwendet werden). Brand-asset von Twitch im "log in with"-context
    erlaubt. currentColor für theming. */
function TwitchIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );
}

/**
 * Inline Discord-icon SVG. Brand-asset von Discord, hier im standard-
 * "log in with"-context der von Discord's brand-guidelines explizit
 * erlaubt ist. currentColor → erbt vom parent text-color.
 */
function DiscordIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

/**
 * Stylized SVG globe für die live-map-showcase. Pure SVG mit SMIL-
 * animations (animate-tags) — keine JS, keine deps. Funktioniert in
 * allen modernen browsern.
 *
 * Design: konzentrische ellipsen für meridiane + parallele, ein paar
 * flight-arc-paths zwischen markern, plane-dots mit pulsing-rings, und
 * ein subtiler center-glow. Indigo/blue palette passend zur brand-color.
 *
 * Wenn du das durch einen echten screenshot ersetzen willst, schau in den
 * inline-comment in der live-map-showcase-section oben — du kannst die
 * <GlobeIllustration /> einfach durch ein <img> tag tauschen.
 */
function GlobeIllustration() {
  // Marker-positionen relativ zum 600x600 viewBox.
  const markers = [
    { x: 180, y: 200, delay: '0s' },
    { x: 420, y: 240, delay: '0.5s' },
    { x: 350, y: 380, delay: '1s' },
    { x: 200, y: 400, delay: '1.5s' },
    { x: 480, y: 320, delay: '0.8s' },
    { x: 130, y: 320, delay: '1.3s' },
  ];

  return (
    <svg
      viewBox="0 0 600 600"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      role="img"
      aria-label="Stilisierte Welt-Karte mit Flugverbindungen"
    >
      <defs>
        <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="markerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="300" cy="300" r="280" fill="url(#centerGlow)" />

      <circle
        cx="300"
        cy="300"
        r="280"
        fill="none"
        stroke="rgba(99, 102, 241, 0.25)"
        strokeWidth="1"
        strokeDasharray="2 6"
      />

      <circle
        cx="300"
        cy="300"
        r="240"
        fill="none"
        stroke="rgba(99, 102, 241, 0.4)"
        strokeWidth="1.5"
      />

      <ellipse
        cx="300"
        cy="300"
        rx="80"
        ry="240"
        fill="none"
        stroke="rgba(99, 102, 241, 0.18)"
        strokeWidth="1"
      />
      <ellipse
        cx="300"
        cy="300"
        rx="160"
        ry="240"
        fill="none"
        stroke="rgba(99, 102, 241, 0.15)"
        strokeWidth="1"
      />

      <ellipse
        cx="300"
        cy="300"
        rx="240"
        ry="60"
        fill="none"
        stroke="rgba(99, 102, 241, 0.18)"
        strokeWidth="1"
      />
      <ellipse
        cx="300"
        cy="300"
        rx="240"
        ry="140"
        fill="none"
        stroke="rgba(99, 102, 241, 0.15)"
        strokeWidth="1"
      />
      <ellipse
        cx="300"
        cy="300"
        rx="240"
        ry="220"
        fill="none"
        stroke="rgba(99, 102, 241, 0.12)"
        strokeWidth="1"
      />

      {/* Flight arcs — quadratic bezier curves zwischen markern,
          mit animated dasharray für motion-feel. */}
      <path
        d="M 180 200 Q 300 100 420 240"
        fill="none"
        stroke="#818cf8"
        strokeWidth="1.5"
        strokeDasharray="6 4"
        opacity="0.8"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-20"
          dur="2s"
          repeatCount="indefinite"
        />
      </path>
      <path
        d="M 200 400 Q 350 450 480 320"
        fill="none"
        stroke="#60a5fa"
        strokeWidth="1.5"
        strokeDasharray="6 4"
        opacity="0.7"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-20"
          dur="3s"
          repeatCount="indefinite"
        />
      </path>
      <path
        d="M 130 320 Q 250 250 350 380"
        fill="none"
        stroke="#a5b4fc"
        strokeWidth="1.5"
        strokeDasharray="6 4"
        opacity="0.6"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-20"
          dur="2.5s"
          repeatCount="indefinite"
        />
      </path>

      {markers.map((m) => (
        <g key={`${m.x}-${m.y}`}>
          <circle cx={m.x} cy={m.y} r="20" fill="url(#markerGlow)" />
          <circle cx={m.x} cy={m.y} r="4" fill="#818cf8" />
          <circle
            cx={m.x}
            cy={m.y}
            r="6"
            fill="none"
            stroke="#818cf8"
            strokeWidth="1"
            opacity="0.6"
          >
            <animate
              attributeName="r"
              values="6;14;6"
              dur="2.5s"
              begin={m.delay}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.6;0;0.6"
              dur="2.5s"
              begin={m.delay}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ))}

      <g transform="translate(440, 90)">
        <rect
          x="0"
          y="0"
          width="80"
          height="24"
          rx="12"
          fill="rgba(34, 197, 94, 0.15)"
          stroke="rgba(34, 197, 94, 0.4)"
          strokeWidth="1"
        />
        <circle cx="14" cy="12" r="3" fill="#22c55e">
          <animate
            attributeName="opacity"
            values="1;0.3;1"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </circle>
        <text
          x="26"
          y="16"
          fontSize="11"
          fontWeight="600"
          fill="#22c55e"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          LIVE · 3500
        </text>
      </g>
    </svg>
  );
}
