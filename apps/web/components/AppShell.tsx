'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { ThemeToggle } from './Theme';

export type ShellUser = {
  name: string | null;
  image: string | null;
  airlineName: string | null;
  airlineIcao: string | null;
  // Optional logo-bild für die airline. Wenn null, fällt der header-brand
  // auf einen ICAO-monogramm-block zurück. Bisher nicht gefetcht im
  // app/layout.tsx — diese property kommt mit dem header-redesign dazu.
  airlineLogoUrl: string | null;
  // Optional rank-name (z.B. "Captain", "First Officer"). Zeigt im header-
  // user-button als sub-line unter dem namen (vAMSYS-style). Wenn null,
  // fällt die UI auf "Pilot" als generic placeholder zurück.
  rankName: string | null;
  isAdmin: boolean;
  hasAirline: boolean;
};

interface Props {
  user: ShellUser | null;
  children: React.ReactNode;
}

// Pages that should render WITHOUT the app shell (no header, no sidebar):
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
 * App-wide layout shell. Renders a sticky header at the top with airline-
 * brand on the left and theme-toggle + user-dropdown on the right, plus a
 * permanent sidebar nav on lg+ viewports.
 *
 * History: pre-2026-05-02 the sidebar carried both nav and identity (brand
 * top, user-zone bottom). Identity moved to the header so it stays visible
 * across all viewports + frees up vertical sidebar space for nav.
 *
 * Unauth users + public pages bypass the shell entirely so the landing
 * page, invite-accept flow, and OBS overlay remain pristine.
 *
 * Why client component: needs usePathname to highlight the active link
 * + drives the user-dropdown open/close state. The auth/user data is
 * fetched server-side in app/layout.tsx and passed down as a serializable
 * prop.
 */
export function AppShell({ user, children }: Props) {
  const pathname = usePathname();

  // No shell for public pages or unauthenticated users — render children
  // pristine. Both checks needed: an authed user might land on / (which
  // redirects to /dashboard, but during the redirect-frame the shell would
  // briefly flash without this guard), and an unauthed user on /dashboard
  // hits the page's own redirect to /.
  if (!user || isPublicPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header user={user} />
      <div className="flex flex-1">
        <Sidebar user={user} pathname={pathname} />
        {/* Pages render their own <main> tag; this is just a flex-child
            wrapper so we can size + scroll independently. min-w-0 prevents
            flex-children from forcing horizontal overflow when content
            (long URLs, code blocks) is wider than the viewport. */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────

/**
 * Top header bar. Sticky to the top of the viewport via `sticky top-0` so
 * it stays visible while the page scrolls. Height is fixed at h-28 (7rem
 * = 112px) — chosen larger than typical SaaS headers to give airline
 * logos room to breathe (most airline logos are wider than tall, ~2-4:1
 * ratio, and look stamp-sized at the standard h-14). The sidebar's
 * `top-28` value below depends on this — if you change one, change the
 * other.
 *
 * Horizontal padding ramps from 10px (mobile) → 12px (sm+) → 15px (lg+).
 * Tighter than the typical px-4/px-6 SaaS-default to give the brand-block
 * + user-info more horizontal room without the header feeling stuffed.
 *
 * Layout: flex-row with airline-brand on the left, growing flex-spacer in
 * the middle, theme-toggle + user-dropdown on the right.
 */
function Header({ user }: { user: ShellUser }) {
  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-4 h-28 px-[10px] sm:px-[12px] lg:px-[15px] bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800"
      aria-label="Header"
    >
      <BrandLink user={user} />
      <div className="flex items-center gap-1 sm:gap-2">
        <ThemeToggle />
        <UserDropdown user={user} />
      </div>
    </header>
  );
}

/**
 * Left side of the header: airline-logo + name. Click → /dashboard.
 *
 * Logo display priority:
 *   1. airlineLogoUrl (if set on the Airline record). Rendered with
 *      object-contain inside a max-h-16 (64px) box without forced width —
 *      most airline logos are landscape rectangles (~2-4:1 aspect ratio),
 *      so we let the image set its own width up to a sensible max. Fixed
 *      heights with squared-off containers crush wordmark-style logos
 *      into illegibility.
 *   2. ICAO monogram in a colored block (fallback for airlines without
 *      logo). Stays square (h-14 w-14) because monogram-text reads best
 *      in a square plate — looks like a logo placeholder rather than a
 *      stretched stand-in.
 *   3. Generic "VAM" monogram (when user has no airline at all).
 *
 * On mobile (sm-) we hide the secondary text line (name) to fit in the
 * tight header — only the logo + ICAO badge remain. On lg+ both name +
 * ICAO show side-by-side.
 */
function BrandLink({ user }: { user: ShellUser }) {
  const hasLogo = !!user.airlineLogoUrl;
  const monogram = user.airlineIcao ?? 'VAM';
  const displayName = user.airlineName ?? 'VAM System';

  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-3 sm:gap-4 min-w-0 hover:opacity-80 transition shrink-0"
    >
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.airlineLogoUrl ?? ''}
          alt={`${displayName} logo`}
          className="max-h-16 max-w-[12rem] object-contain shrink-0"
        />
      ) : (
        <div
          className="w-14 h-14 rounded-lg bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          {monogram}
        </div>
      )}
      <div className="min-w-0 hidden sm:block">
        <p className="text-base font-semibold text-gray-900 dark:text-white truncate leading-tight">
          {displayName}
        </p>
        {user.airlineIcao && (
          <p className="text-sm text-gray-500 dark:text-gray-500 leading-tight truncate mt-0.5">
            {user.airlineIcao}
          </p>
        )}
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// User Dropdown
// ─────────────────────────────────────────────────────────────────────────

/**
 * Right side of the header: avatar + name button that opens a menu on
 * click. Menu items:
 *   - Account-Settings → /settings
 *   - Select Airline (Coming soon) → disabled, no action
 *   - Logout → /api/auth/signout
 *
 * Multi-airline-membership is not yet in the data-model (User has a single
 * airlineId FK). The "Select Airline" entry is a UI-only placeholder so the
 * feature surface exists when the schema migration ships. Until then, the
 * entry shows a "(Coming soon)" hint and is disabled.
 *
 * Click-outside + Escape close the menu. Avatar-button has aria-haspopup +
 * aria-expanded so screen-readers announce the dropdown correctly. Menu
 * items are role="menuitem" inside role="menu".
 */
function UserDropdown({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside handler — close menu when user clicks anywhere except
  // the trigger button or menu itself. Listener attached only when open
  // to avoid a global mousedown listener for every page render.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Escape closes menu + returns focus to the trigger (a11y).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 sm:gap-3 pl-1 pr-2 sm:pr-3 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt={user.name ?? 'Avatar'}
            className="w-10 h-10 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0"
            aria-hidden="true"
          />
        )}
        {/* Two-line text-zone (vAMSYS-style): pilot-name oben, rank-name
            darunter als sub-line. ALWAYS visible (kein responsive-hide
            mehr) — vorher war's `hidden sm:block` was username auf
            mobile verschwinden lässt; Kevin's feedback hat klargestellt
            dass username durchgehend sichtbar sein muss.

            max-w-[8rem] mit truncate verhindert overflow auf mobile-
            screens wo neben dem brand-logo + theme-toggle wenig platz
            bleibt. text-left explizit weil das parent-button sonst auf
            default-text-align fällt.

            Rank-fallback: 'Pilot' als generic placeholder wenn user noch
            keinen rank zugewiesen hat — vAMSYS macht das selbe um die
            UI-zone konsistent zu halten. */}
        <div className="min-w-0 max-w-[8rem] sm:max-w-[10rem] text-left">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate leading-tight">
            {user.name ?? 'Pilot'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-tight mt-0.5">
            {user.rankName ?? 'Pilot'}
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="User menu"
          className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden z-40"
        >
          {/* Identity-block at top of menu — repeats user info so the
              menu stands alone visually even when triggered from a
              user-button that's already showing the same info. On
              mobile the trigger doesn't show name (only avatar), so
              this block is the only place the user sees their name. */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {user.name ?? 'Pilot'}
            </p>
            {user.isAdmin && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">
                Admin
              </p>
            )}
          </div>

          <div className="py-1">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition"
            >
              Account-Settings
            </Link>

            {/* "Select Airline" placeholder — multi-airline-membership is
                not yet in the schema (User has single airlineId FK). The
                entry is rendered disabled with a "(Coming soon)" hint to
                signal that the feature is on the roadmap. When schema +
                action ship, this becomes an active menu-item with a
                submenu or modal listing the user's memberships. */}
            <button
              type="button"
              role="menuitem"
              disabled
              aria-disabled="true"
              className="flex items-center justify-between w-full px-4 py-2 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed text-left"
              title="Multi-Airline-Membership ist noch nicht im datenmodell — kommt mit Phase 2"
            >
              <span>Select Airline</span>
              <span className="text-xs italic">Coming soon</span>
            </button>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-800 py-1">
            <Link
              href="/api/auth/signout"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition"
            >
              Abmelden
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────

interface SidebarProps {
  user: ShellUser;
  pathname: string;
}

/**
 * Sidebar nav. Sticky to the top of the viewport-below-header so it stays
 * visible while page-content scrolls underneath. The `top-28` matches the
 * header's `h-28` — keep them in sync.
 *
 * Brand-block + user-block USED to live here (pre-2026-05-02). Both have
 * moved to the header — sidebar is now nav-only.
 */
function Sidebar({ user, pathname }: SidebarProps) {
  return (
    <aside
      className="hidden lg:flex lg:flex-col w-60 shrink-0 sticky top-28 self-start h-[calc(100vh-7rem)] bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800"
      aria-label="Hauptnavigation"
    >
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
            <NavLink href="/aircraft-types" pathname={pathname} icon="✈️" label="Aircraft-Types" />
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
