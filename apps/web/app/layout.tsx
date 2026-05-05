import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { AppShell, type ShellUser } from '@/components/AppShell';
import { ThemeProvider, themeInitScript } from '@/components/Theme';
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

  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        image: true,
        // logoUrl mit fetchen für den header-brand-block. Optional auf der
        // airline; wenn null, fällt der BrandLink auf einen ICAO-monogramm
        // zurück.
        airline: { select: { name: true, icao: true, logoUrl: true, economyEnabled: true } },
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
      },
    });

    if (user) {
      const roleName = user.role?.name ?? null;
      shellUser = {
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
        // Welle 4: Position-felder direkt aus der user-row durchgereicht.
        // Nullable strings — sidebar-position-block hat alle 5 fallback-cases
        // dokumentiert (siehe Sidebar-component-comment).
        baseIcao: user.baseIcao,
        currentLocationIcao: user.currentLocationIcao,
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
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <AppShell user={shellUser}>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
