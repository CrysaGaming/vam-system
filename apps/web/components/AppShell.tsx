'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ThemeToggle } from './Theme';

export type SidebarUser = {
  name: string | null;
  image: string | null;
  airlineName: string | null;
  airlineIcao: string | null;
  isAdmin: boolean;
  hasAirline: boolean;
};

interface Props {
  user: SidebarUser | null;
  children: React.ReactNode;
}

// Pages that should render WITHOUT the app shell (no sidebar):
//   - / (landing/login)
//   - /invite/[token] (public accept-flow, both anon + authed)
//   - /overlay/[token] (OBS browser source — must be chrome-free)
//   - /api/* (API routes — they don't render UI but defend in depth)
function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname.startsWith('/invite/')) return true;
  if (pathname.startsWith('/overlay/')) return true;
  if (pathname.startsWith('/api/')) return true;
  return false;
}

/**
 * App-wide layout shell. Renders a permanent sidebar nav on lg+ viewports
 * and falls through to chrome-less rendering on mobile (the existing
 * page-level "← Dashboard" back-links already cover navigation there;
 * a mobile bottom-nav can be added later as a separate concern, see
 * layout-redesign #5).
 *
 * Unauth users + public pages bypass the shell entirely so the landing
 * page, invite-accept flow, and OBS overlay remain pristine.
 *
 * Why client component: needs usePathname to highlight the active link
 * + handle conditional rendering. The auth/user data is fetched server-
 * side in app/layout.tsx and passed down as a serializable prop.
 */
export function AppShell({ user, children }: Props) {
  const pathname = usePathname();

  // No shell for public pages or unauthenticated users — render children
  // pristine. Both checks are needed: an authed user might land on /
  // (which redirects to /dashboard, but during the redirect-frame the
  // shell would briefly flash without this guard), and an unauthed user
  // on /dashboard hits the page's own redirect to /.
  if (!user || isPublicPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} pathname={pathname} />
      {/* Pages render their own <main> tag; this is just a flex-child
          wrapper so we can size + scroll independently. min-w-0 prevents
          flex-children from forcing horizontal overflow when content
          (long URLs, code blocks) is wider than the viewport. */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

interface SidebarProps {
  user: SidebarUser;
  pathname: string;
}

function Sidebar({ user, pathname }: SidebarProps) {
  return (
    <aside
      className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800"
      aria-label="Hauptnavigation"
    >
      {/* Brand-block — sticky to top of sidebar. Airline name shown if the
          user is in one; otherwise just "VAM System" so the brand doesn't
          collapse to nothing. */}
      <div className="px-5 py-5 border-b border-gray-200 dark:border-gray-800">
        <Link href="/dashboard" className="block hover:opacity-80 transition">
          <p className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
            {user.airlineIcao ?? 'VAM'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 truncate">
            {user.airlineName ?? 'VAM System'}
          </p>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <NavSection title="Flying">
          <NavLink href="/dashboard" pathname={pathname} icon="🏠" label="Dashboard" exact />
          <NavLink href="/bookings" pathname={pathname} icon="✈️" label="Bookings" />
          <NavLink href="/pireps" pathname={pathname} icon="📋" label="PIREPs" />
          <NavLink href="/live" pathname={pathname} icon="🌐" label="Live" />
        </NavSection>

        {user.hasAirline && (
          <NavSection title="Airline">
            <NavLink href="/pilots" pathname={pathname} icon="👥" label="Piloten" />
            <NavLink href="/routes" pathname={pathname} icon="🛣️" label="Routen" />
            <NavLink href="/airports" pathname={pathname} icon="🛫" label="Airports" />
          </NavSection>
        )}

        {user.isAdmin && user.hasAirline && (
          <NavSection title="Admin">
            <NavLink href="/airline" pathname={pathname} icon="🏢" label="Airline-Verwaltung" />
            <NavLink href="/admin/requests" pathname={pathname} icon="📥" label="Requests" />
            <NavLink href="/admin/roles" pathname={pathname} icon="🔐" label="Rollen" />
          </NavSection>
        )}

        <NavSection title="Account">
          <NavLink href="/settings" pathname={pathname} icon="⚙️" label="Einstellungen" />
        </NavSection>
      </nav>

      {/* User-block at bottom — avatar + name + theme toggle + logout.
          signOut is a server action via /api/auth/signout (NextAuth route).
          The theme toggle sits between the user info and signout for
          quick access without crowding the nav. */}
      <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 px-2 py-2">
          {user.image ? (
            <img
              src={user.image}
              alt={user.name ?? 'Avatar'}
              className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate text-gray-900 dark:text-white">
              {user.name ?? 'Pilot'}
            </p>
            {user.isAdmin && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400">Admin</p>
            )}
          </div>
        </div>
        <ThemeToggle />
        <Link
          href="/api/auth/signout"
          className="block px-3 py-2 mt-1 text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-900 rounded transition text-center"
        >
          Abmelden
        </Link>
      </div>
    </aside>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-3 mb-1 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 font-medium">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

interface NavLinkProps {
  href: string;
  pathname: string;
  icon: string;
  label: string;
  // exact=true → active only on exact pathname match (use for /dashboard
  // so it doesn't stay active on /dashboard/anything). Default false uses
  // startsWith so /bookings stays active on /bookings/[id].
  exact?: boolean;
}

function NavLink({ href, pathname, icon, label, exact = false }: NavLinkProps) {
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition ${
        isActive
          ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 -ml-0.5 pl-[10px]'
          : 'text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-900 border-l-2 border-transparent -ml-0.5 pl-[10px]'
      }`}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="text-base" aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}
