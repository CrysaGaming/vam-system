import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { AppShell, type SidebarUser } from '@/components/AppShell';

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
 * user/airline/role data needed to render the sidebar nav, then hands
 * it to <AppShell/>. The shell is responsible for deciding whether to
 * actually render the sidebar (only on lg+ viewports + non-public pages).
 *
 * Why fetch user data here instead of per-page: every authenticated
 * page already does its own user lookup, so this is a small additive
 * query (~1ms) for the sidebar metadata that needs to render
 * consistently across pages. The query runs only when there's a
 * session — anonymous users hit zero DB queries from this layout.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  let sidebarUser: SidebarUser | null = null;

  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        image: true,
        airline: { select: { name: true, icao: true } },
        role: { select: { name: true } },
      },
    });

    if (user) {
      sidebarUser = {
        name: user.name,
        image: user.image,
        airlineName: user.airline?.name ?? null,
        airlineIcao: user.airline?.icao ?? null,
        // Treat role.name === 'admin' as the admin gate. Mirrors the
        // existing convention in airline/actions.ts requireAirlineAdmin
        // and admin/roles/actions.ts requireAdmin. When permission-based
        // gating ships, this single read can switch to permissions.includes.
        isAdmin: user.role?.name === 'admin',
        hasAirline: !!user.airline,
      };
    }
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <AppShell user={sidebarUser}>{children}</AppShell>
      </body>
    </html>
  );
}
