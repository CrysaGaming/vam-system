import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { auth } from '@/auth';
import { prisma, countLivePilots } from '@vam/db';
import { AppShell, type ShellUser } from '@/components/AppShell';
import { ThemeProvider, themeInitScript } from '@/components/Theme';
import { Providers } from '@/components/Providers';
import { AirlineBrandingProvider } from '@/components/AirlineBrandingProvider';
import { ErrorReporter } from '@/components/error-reporter';
import { isApproverRole } from '@/lib/roles';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'VAM System',
  description: 'Virtual Airline Management Platform',
  // Track 4 #75 (Section O): PWA-manifest. Browser liest /manifest.webmanifest
  // → blendet "App installieren" anweisung ein, behandelt das ding als
  // installable PWA. Path ist relativ zum origin damit es unabhängig vom
  // basePath funktioniert. Next.js fügt automatisch <link rel="manifest">
  // ins <head> ein.
  manifest: '/manifest.webmanifest',
  // Apple-spezifische meta-tags damit iOS-add-to-homescreen den richtigen
  // namen + display-mode + status-bar-style zeigt. iOS ignoriert den
  // manifest bisher (Stand 2026) und liest nur diese legacy-tags.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'VAM',
  },
};

// Track 4 #75: Viewport-config separat exportieren weil Next.js 16 das
// aus metadata herausgezogen hat (Vite-style). themeColor steuert die
// browser-chrome-farbe auf mobile (android-toolbar, ios-status-bar im
// installed-mode). Match zum manifest.theme_color damit es konsistent
// wirkt. Light + dark variants damit dark-mode user nicht plötzlich
// einen hellblauen status-bar haben.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#4f46e5' },
    { media: '(prefers-color-scheme: dark)', color: '#1e1b4b' },
  ],
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout. Server component — fetches the auth session + minimal
 * user/airline/role data needed to render the shell (header + sidebar),
 * then hands it to <AppShell/>. The shell is responsible for deciding
 * whether to actually render the chrome (only on lg+ viewports for
 * sidebar; header always when authed + non-public).
 *
 * Why fetch user data here instead of per-page: every authenticated
 * page already does its own user lookup, so this is a small additive
 * query (~1ms) for the shell metadata that needs to render consistently
 * across pages. The query runs only when there's a session — anonymous
 * users hit zero DB queries from this layout.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  let shellUser: ShellUser | null = null;
  // Track 3 #11.2.4 Phase 4 + #11.2.6 v2: airline-primary-color für den
  // <head> branding-style-block. Separate variable statt im shellUser
  // weil AppShell die farbe nicht braucht (CSS-variable kaskadiert über
  // alle children automatisch).
  let airlinePrimaryColor: string | null = null;

  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        image: true,
        // Welle 14C: airlineId für den countLivePilots-call (live-counter
        // im header). Brauchen wir nur für den separaten count-query
        // unten — nicht direkt in shellUser durchgereicht weil airlineName
        // schon airline-context für die UI liefert.
        airlineId: true,
        // logoUrl mit fetchen für den header-brand-block. Optional auf der
        // airline; wenn null, fällt der BrandLink auf einen ICAO-monogramm
        // zurück.
        airline: {
          select: {
            name: true,
            icao: true,
            logoUrl: true,
            economyEnabled: true,
            careerEnabled: true,
            // Track 3 #11.2.4 Phase 4 + #11.2.6 v2: per-airline-branding.
            // primaryColor wird im <head> als CSS-var-override für --primary
            // gerendert (siehe AirlineBrandingProvider). Null → globals.css
            // default-indigo gewinnt.
            primaryColor: true,
          },
        },
        // rank.name für das header user-info display (vAMSYS-style:
        // pilot-name oben, rank-bezeichnung darunter). Optional FK —
        // user kann ohne rank existieren (z.B. neuer pilot vor zuweisung).
        rank: { select: { name: true } },
        role: { select: { name: true } },
        // Welle 4: Position-tracking. baseIcao = pilot's hub innerhalb
        // der airline (z.B. "EDDF"), currentLocationIcao = wo er grade
        // ist (gesetzt nach approved PIREPs, jumpseats, etc.). Beide
        // optional — neuer pilot ohne hub-zuweisung oder erstem flug
        // hat nulls. Sidebar-position-block rendert dann "Position
        // unbekannt".
        baseIcao: true,
        currentLocationIcao: true,
        // Welle 13D: Economy opt-in flag. Gepaart mit airline.economyEnabled
        // (oben im airline-select) ergibt das hasEconomy in shellUser.
        economyEnabled: true,
        // Welle 13E-5: Career opt-in flag. Gepaart mit airline.careerEnabled
        // (oben im airline-select) ergibt das hasCareer in shellUser. Steuert
        // die sichtbarkeit des "Lizenzen"-sidebar-links.
        careerEnabled: true,
      },
    });

    if (user) {
      const roleName = user.role?.name ?? null;
      airlinePrimaryColor = user.airline?.primaryColor ?? null;

      // Welle 14C: Live-stream-count für den header-counter ("🔴 N live").
      // Filter auf airlineId — counter zeigt nur live-pilots der eigenen
      // airline (cross-airline-snooping ist out-of-scope und auch UX-mäßig
      // verwirrend wenn ein admin in einer anderen airline werkelt).
      // Wenn user.airlineId null (rare — solo-pilot vor airline-zuweisung),
      // fällt count auf 0 zurück und der counter wird nicht gerendert.
      const liveStreamCount = user.airlineId
        ? await countLivePilots({ airlineId: user.airlineId })
        : 0;

      shellUser = {
        // Welle Q follow-up: user.id durchreichen damit der dropdown-
        // identity-block einen profil-link auf /p/[id] hat (Track 5 #11
        // public profile route). Ohne das schlägt der ShellUser-typecheck
        // fehl, weil id: string jetzt required ist. Wir nehmen
        // session.user.id (statt user.id) weil das prisma-select id nicht
        // explizit fetcht — und session.user.id ist garantiert == user.id
        // weil die where-clause oben darauf basiert.
        id: session.user.id,
        name: user.name,
        image: user.image,
        airlineName: user.airline?.name ?? null,
        airlineIcao: user.airline?.icao ?? null,
        airlineLogoUrl: user.airline?.logoUrl ?? null,
        rankName: user.rank?.name ?? null,
        // Treat role.name === 'admin' as the admin gate. Mirrors the
        // existing convention in airline/actions.ts requireAirlineAdmin
        // and admin/roles/actions.ts requireAdmin. When permission-based
        // gating ships, this single read can switch to permissions.includes.
        isAdmin: roleName === 'admin',
        // isApprover: admin, airline-admin oder instructor. Single source
        // of truth ist APPROVER_ROLES in @/lib/roles.ts — siehe dort warum
        // airline-admin seit 2026-05-02 dabei ist (seed-permission war
        // schon 'pirep:review', wurde aber nie ge-enforced).
        isApprover: isApproverRole(roleName),
        // canManageAirline: admin OR airline-admin OR instructor.
        // Spiegelt AIRLINE_MANAGER_ROLES in airline/actions.ts +
        // allowedRoles in airline/page.tsx — alle drei müssen synchron
        // bleiben, sonst sieht der User entweder einen broken Sidebar-link
        // (gating zu eng hier) oder kommt durch ein non-functional gate
        // (gating zu locker hier vs. backend).
        canManageAirline: roleName !== null && ['admin', 'airline-admin', 'instructor'].includes(roleName),
        hasAirline: !!user.airline,
        // Welle 13D: Economy ist opt-in BEIDERSEITIG. hasEconomy=true nur
        // wenn der user ZU EINER AIRLINE GEHÖRT, der user-flag ON ist UND
        // der airline-flag ON ist. Das spiegelt die WalletCard-gating-
        // logik im /dashboard und entscheidet ob der "Wallet"-sidebar-
        // link erscheint.
        hasEconomy: !!(user.airline && user.economyEnabled && user.airline.economyEnabled),
        // Welle 13D-4: airlineEconomyEnabled ist getrennt von hasEconomy
        // weil die /airline/finance-page einen eigenen flag braucht. Admins
        // sollen die airline-finanzen sehen können auch wenn ihre eigene
        // economy off ist (privater wallet ≠ airline-finance-overview).
        // Bedingung: airline.economyEnabled UND canManageAirline (admin/
        // airline-admin/instructor) UND user gehört zur airline. Wenn
        // alle drei zutreffen → "Finanzen"-link in Airline-Admin-section.
        airlineEconomyEnabled: !!(
          user.airline &&
          user.airline.economyEnabled &&
          roleName !== null &&
          ['admin', 'airline-admin', 'instructor'].includes(roleName)
        ),
        // Welle 13E-5: Career ist opt-in BEIDERSEITIG (selbe philosophie
        // wie hasEconomy). hasCareer=true nur wenn user.careerEnabled UND
        // airline.careerEnabled. Steuert die sichtbarkeit des "Lizenzen"-
        // sidebar-links + den booking-gate (13E-7) der canPilotFlyAircraft
        // bei jeder neuen buchung anwendet. Roleplay-airlines lassen
        // mindestens einen flag false und hasCareer bleibt false für alle.
        hasCareer: !!(user.airline && user.careerEnabled && user.airline.careerEnabled),
        // Welle 13E-14c: airlineCareerEnabled ist getrennt von hasCareer
        // (selbe trennung wie airlineEconomyEnabled vs hasEconomy). Steuert
        // den "Praktische Prüfungen"-link im Admin-section. Bedingung:
        // airline.careerEnabled UND canManageAirline. Ein admin/instructor
        // mit eigener career-toggle off kann trotzdem die airline-side
        // reviews machen (das ist ein instructor-tool, kein pilot-progress).
        airlineCareerEnabled: !!(
          user.airline &&
          user.airline.careerEnabled &&
          roleName !== null &&
          ['admin', 'airline-admin', 'instructor'].includes(roleName)
        ),
        // Welle 4: Position-felder direkt aus der user-row durchgereicht.
        // Nullable strings — sidebar-position-block hat alle 5 fallback-cases
        // dokumentiert (siehe Sidebar-component-comment).
        baseIcao: user.baseIcao,
        currentLocationIcao: user.currentLocationIcao,
        // Welle 14C: Live-stream-count für den header-counter. 0 wenn keine
        // pilots live oder user keiner airline angehört. Header rendert
        // den counter nur wenn > 0 — versteckt sich also unauffällig wenn
        // grade niemand streamt.
        liveStreamCount,
      };
    }
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Pre-hydration script. Runs synchronously before React hydrates,
            sets the .dark class on <html> based on localStorage + system
            pref. Without this, every page would flash light-mode briefly
            (FOUC) before the React provider mounts. The script body is
            defined in components/Theme.tsx for centralized theme logic.

            Wrapped in next/script with strategy=beforeInteractive (statt
            raw <script>): Next.js 16 warnt bei raw <script> tags innerhalb
            React-components weil sie bei client-renders nicht ausgeführt
            werden. beforeInteractive injiziert das script SSR-side ins
            initial-HTML — funktional identisch, aber ohne dev-warning. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        {/* Track 3 #11.2.4 Phase 4 + #11.2.6 v2: airline-brand-color
            override für --primary CSS-variable. Server-rendered <style>-
            tag — kein FOUC, kein client-bundle, kein context-overhead.
            Wenn user keine airline hat oder primaryColor null ist,
            rendert die component null und globals.css-default-indigo
            bleibt aktiv. */}
        <AirlineBrandingProvider primaryColor={airlinePrimaryColor} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <Providers>
            {/* Track 4 #103 (Section T): client-error-reporter. Mounted hier
                damit window.onerror + unhandledrejection auf jeder page
                aktiv sind. Pure side-effect-component, rendert null —
                installiert window-listeners die errors an POST /api/errors
                schicken mit hash-basiertem dedup + 20-per-minute client-throttle. */}
            <ErrorReporter />
            <AppShell user={shellUser}>{children}</AppShell>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
