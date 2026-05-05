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
  // isApprover: User darf PIREPs prüfen (admin ODER instructor). Separat von
  // isAdmin weil instructor zwar approval-rechte hat aber nicht die
  // vollständigen admin-rechte (Rollen-verwaltung, Statistiken-zugriff,
  // Airline-settings etc.). Im Sidebar steuert das, ob der User den
  // "PIREPs zur Prüfung"-link im Admin-sektor sieht — der rest des
  // Admin-sektors bleibt isAdmin-only.
  isApprover: boolean;
  // canManageAirline: User darf die Airline-Verwaltung sehen + bearbeiten
  // (admin OR airline-admin OR instructor). Spiegelt AIRLINE_MANAGER_ROLES
  // in airline/actions.ts; muss synchron mit dem backend-gate bleiben sonst
  // sieht der User den Sidebar-link aber kommt auf /dashboard zurück. Im
  // Sidebar steuert das den "Airline-Admin"-sektor zwischen Airline und
  // Admin (mit aktuell nur Airline-Verwaltung als link).
  canManageAirline: boolean;
  hasAirline: boolean;
  // Welle 13D: Economy-features sind opt-in. hasEconomy ist true wenn
  // user.economyEnabled UND airline.economyEnabled — gleiche logik wie
  // im dashboard/WalletCard. Steuert die sichtbarkeit des "Wallet"-
  // sidebar-links. Wenn false: link wird nicht gerendert, /wallet-page
  // selbst hat einen separaten gating-redirect für direkte URL-aufrufe.
  hasEconomy: boolean;
  // Welle 13D-4: Separater flag nur für die airline-seite des opt-ins.
  // Steuert die sichtbarkeit des "Finanzen"-links im Airline-Admin-
  // sektor. Logik: airline.economyEnabled UND canManageAirline. Bewusst
  // getrennt von hasEconomy weil ein admin der seine PERSÖNLICHE
  // economy-toggle off hat trotzdem die airline-finanzen sehen können
  // muss — das sind getrennte concerns (privater wallet vs. airline-
  // finance-overview). Ein admin ohne airline (theoretisch möglich für
  // global-admin) hat das automatisch false.
  airlineEconomyEnabled: boolean;
  // Welle 4: Position-tracking. baseIcao = pilot's hub innerhalb der airline,
  // currentLocationIcao = wo er grade ist. Beide nullable (neuer pilot ohne
  // hub-zuweisung, oder vor erstem flug). Sidebar zeigt einen kompakten
  // status-block "📍 EDDF" (current location) mit subtitle "Base: EDDM"
  // wenn current ≠ base. Wenn current = base, zeigt nur "📍 EDDF (Base)".
  // Wenn beide null, zeigt der block "📍 Position unbekannt".
  baseIcao: string | null;
  currentLocationIcao: string | null;
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
    <div className="flex flex-col h-screen">
      {/* HTML5-semantik: shell rendert <header> + <nav> direkt; das
          <main> liegt INNERHALB der page (jede page-component hat
          ihr eigenes <main>) — das ist semantisch sauberer als ein
          shell-main mit nested page-main, weil HTML5 nur ein <main>
          pro view erlaubt.

          Das <div> hier ist nur ein scroll-wrapper (overflow-y-auto)
          um das page-eigene <main>; es ist kein semantisches element
          und braucht keinen role-attribut weil das innere <main> die
          aria-rolle bereits trägt.

          Layout:
            ┌──────────────────────────────────────┐
            │ <header> (auto-height, fix oben)     │
            ├──────┬───────────────────────────────┤
            │ <nav>│ <div overflow-y-auto>         │
            │ (fix)│   <main> ← von page geliefert │
            │      │     ...content...             │
            │      │   </main>                     │
            │      │ </div>                        │
            └──────┴───────────────────────────────┘

          h-screen statt min-h-screen + main mit overflow-y-auto: das
          viewport scrollt NICHT — nur der main-bereich. Damit bleibt
          die nav visuell fixed (ohne sticky-positioning, das in
          flex-containern manchmal nicht greift) und der header wird
          NIE durch nav-content überlagert. */}
      <Header user={user} />
      <div className="flex flex-1 min-h-0">
        {/* min-h-0 ist hier kritisch: ohne das default min-height: auto
            in flex-children, kann main's overflow-y-auto nicht greifen
            weil das parent-flex sich an content-höhe orientiert. min-h-0
            erlaubt dem flex-child unter content-höhe zu schrumpfen, was
            scrolling im main aktiviert. */}
        <Sidebar user={user} pathname={pathname} />
        {/* Scroll-wrapper um das page-eigene <main>. min-w-0 prevents
            flex-children from forcing horizontal overflow when content
            (long URLs, code blocks) is wider than the viewport.
            overflow-y-auto sorgt dafür dass nur DIESE column scrollt —
            nav + header bleiben fix. */}
        <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────

/**
 * Top header bar. Sticky-attribut + z-30 als defensive guard — bei
 * dem aktuellen layout (h-screen outer, main scrollt intern) ist das
 * tatsächlich ein no-op weil das viewport gar nicht scrollt. Bleibt
 * trotzdem als safety-net falls jemand das outer-pattern später ändert.
 *
 * Höhe ist NICHT mehr fix (vorher h-28 = 112px) — stattdessen wird die
 * höhe durch padding + content (logo max-h-16 = 64px) bestimmt:
 *   - mobile: py-4 + 64 + py-4 = 16 + 64 + 16 = 96px
 *   - sm+:    py-6 + 64 + py-6 = 24 + 64 + 24 = 112px
 *   - lg+:    py-8 + 64 + py-8 = 32 + 64 + 32 = 128px
 * Das macht das padding ECHT sichtbar (vergrößert den header) statt
 * nur die content-area in fixer höhe zu reduzieren — mit fixed h-28
 * + items-center wäre py irrelevant weil das logo eh schon zentriert
 * mit 24px gap oben/unten zu sehen war.
 *
 * Padding (sym auf x + y achsen, x ist breiter weil headers traditionell
 * breiter als hoch):
 *   - px: px-6 sm:px-10 lg:px-12 (24/40/48px)
 *   - py: py-4 sm:py-6 lg:py-8 (16/24/32px)
 *
 * Layout: flex-row with airline-brand on the left, growing flex-spacer in
 * the middle, theme-toggle + user-dropdown on the right.
 */
function Header({ user }: { user: ShellUser }) {
  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-4 sm:px-10 sm:py-6 lg:px-12 lg:py-8 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800"
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

  // Logo wird in <picture> gewrapped um Next.js' / React 19's auto-preload-
  // generation zu unterdrücken. Plain <img> tags ohne loading="lazy" bekommen
  // automatisch ein <link rel="preload" as="image"> in den head gesetzt, was
  // bei externen URLs (CDN) zu der console-warning "preloaded but not used
  // within a few seconds" führt — der browser kann den preload nicht
  // zuverlässig mit dem <img> matchen. <picture>-wrapper ist der vom Next.js
  // team selbst empfohlene workaround
  // (https://github.com/vercel/next.js/discussions/54799).
  //
  // Comments stehen BEWUSST außerhalb des JSX-ternary — comments innerhalb
  // von `{hasLogo ? ( /* */ <picture>...` führen bei Turbopack/SWC zu einem
  // hydration-mismatch: server rendered <picture>, client-bundle stripped
  // das <picture> raus und behält nur das <img>. Outside-the-ternary stellt
  // sicher dass beide compiler-passes identisch transformieren.
  //
  // Logo soll trotzdem eager laden weil es above-the-fold im header sitzt —
  // daher kein loading="lazy".

  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-3 sm:gap-4 min-w-0 hover:opacity-80 transition shrink-0"
    >
      {hasLogo ? (
        <picture>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={user.airlineLogoUrl ?? ''}
            alt={`${displayName} logo`}
            className="max-h-16 max-w-[12rem] object-contain shrink-0"
          />
        </picture>
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
        {/* user.image wird in <picture> gewrapped — siehe BrandLink für
            den vollen kontext zur preload-warning + workaround. Comments
            stehen wieder außerhalb des ternary um den hydration-mismatch
            durch Turbopack-comment-stripping zu vermeiden. */}
        {user.image ? (
          <picture>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={user.image}
              alt={user.name ?? 'Avatar'}
              className="w-10 h-10 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
            />
          </picture>
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
// Sidebar Navigation
// ─────────────────────────────────────────────────────────────────────────

interface SidebarProps {
  user: ShellUser;
  pathname: string;
}

/**
 * Sidebar navigation. Rendert als `<nav>` element (HTML5-semantik) mit
 * aria-label="Hauptnavigation". Sitzt links neben dem main-content im
 * inneren flex-row container und bleibt visuell fixed beim scrollen —
 * nicht durch sticky-positioning sondern durch das outer-wrapper-pattern:
 * das AppShell-outer ist h-screen (fix 100vh) mit dem main-bereich als
 * einzigem scrolling element (overflow-y-auto). Sidebar ist innerhalb
 * vom flex-row aber außerhalb des scrollers, also bewegt sich nicht.
 *
 * Vorher (commit 49cae36..897dfda) wurde sticky top-28 versucht, aber
 * das hatte zwei probleme: (1) in flex-children manchmal nicht zuverlässig,
 * (2) wenn sticky aktiviert wurde überlappte die sidebar visuell mit
 * dem header (z-stacking-issue beim sticky). Das h-screen + overflow
 * pattern ist robuster.
 *
 * Vorher war's `<aside>` — semantisch ungenau weil aside für "side
 * content related to but separate from the main flow" gedacht ist
 * (z.B. werbung, related links). Hier ist's PRIMÄRE navigation, also
 * `<nav>`.
 *
 * Brand-block + user-block USED to live here (pre-2026-05-02). Both have
 * moved to the header — sidebar is now nav-only.
 */
function Sidebar({ user, pathname }: SidebarProps) {
  return (
    <nav
      className="hidden lg:flex lg:flex-col w-60 shrink-0 h-full overflow-hidden bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800"
      aria-label="Hauptnavigation"
    >
      {/* Innerer container für nav-sections. flex-1 füllt die volle
          nav-höhe. Bewusst KEIN overflow-y-auto — die nav darf nicht
          scrollen. Outer <nav> hat zusätzlich overflow-hidden als
          defensive guard, damit garantiert kein scroll auch wenn
          content theoretisch overflowen würde (sonst clippt's einfach).
          Falls die nav-liste mal länger wird als verfügbare höhe (z.B.
          mit vielen admin-sections), muss das design umgestellt werden
          (sections kollabieren oder kleinere icons statt scrolling). */}
      <div className="flex-1 px-3 py-4 space-y-6">
        <NavSection title="Flying">
          <NavLink href="/dashboard" pathname={pathname} icon="🏠" label="Dashboard" exact />
          <NavLink href="/bookings" pathname={pathname} icon="✈️" label="Bookings" />
          <NavLink href="/pireps" pathname={pathname} icon="📋" label="PIREPs" />
          {/* Welle 13D-3: Wallet-link wird nur gezeigt wenn beide economy-
              flags ON sind (gating in layout.tsx via hasEconomy). Sitzt in
              Flying-section weil's eine persönliche pilot-tool ist (selbe
              kategorie wie PIREPs/Bookings), nicht eine airline-admin-
              funktion. */}
          {user.hasEconomy && (
            <NavLink href="/wallet" pathname={pathname} icon="💰" label="Wallet" />
          )}
          <NavLink href="/jumpseat" pathname={pathname} icon="🪂" label="Jumpseat" />
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

        {/* Airline-Admin-sektor (2026-05-02 neu eingeführt). Sichtbar für
            admin, airline-admin und instructor (canManageAirline). Enthält
            airline-spezifische verwaltungs-aufgaben — aktuell nur die
            Airline-Verwaltung (members + settings). Backend-gating in
            airline/actions.ts AIRLINE_MANAGER_ROLES + airline/page.tsx
            allowedRoles muss synchron mit canManageAirline bleiben.

            Trennung von Admin: Admin ist system-weit (Statistiken, globale
            Rollen, Requests), Airline-Admin ist airline-internal. Damit
            kann airline-admin die airline verwalten ohne system-rechte.

            hasAirline check: ein admin ohne airline-zuordnung hat hier
            nichts zu tun (selbe logik wie alter Admin-sektor). */}
        {user.canManageAirline && user.hasAirline && (
          <NavSection title="Airline-Admin">
            <NavLink href="/airline" pathname={pathname} icon="🏢" label="Airline-Verwaltung" exact />
            {/* Welle 13D-4: Airline-Finanzen. Nur sichtbar wenn die airline
                economy-toggle ON ist UND der user canManageAirline ist
                (beide checks zusammengefasst in airlineEconomyEnabled).
                Sitzt direkt unter Airline-Verwaltung weil's konzeptionell
                der financial-overview der airline ist und admins als zweite
                primäre admin-aufgabe nach members-management zugreifen. */}
            {user.airlineEconomyEnabled && (
              <NavLink href="/airline/finance" pathname={pathname} icon="💼" label="Finanzen" />
            )}
            <NavLink href="/airline/hubs" pathname={pathname} icon="📍" label="Hubs" />
            <NavLink href="/airline/aircraft" pathname={pathname} icon="🛩️" label="Aircraft" />
            <NavLink href="/airline/fleet" pathname={pathname} icon="📊" label="Fleet-Übersicht" />
            <NavLink href="/airline/ranks" pathname={pathname} icon="🏅" label="Ränge" />
            <NavLink href="/airline/pilots" pathname={pathname} icon="👥" label="Personal" />
            <NavLink href="/airline/routes" pathname={pathname} icon="🛣️" label="Routen-Verwaltung" />
            <NavLink href="/airline/schedule" pathname={pathname} icon="🕒" label="Schedule" />
          </NavSection>
        )}

        {/* Admin-sektor — system-weite verwaltung. Wird gezeigt wenn der
            User isApprover (instructor) ODER isAdmin ist. Innerhalb des
            sektors sind die einzelnen links nochmal granular gegated:
              - PIREPs zur Prüfung: isApprover (instructor + admin)
              - Statistiken / Piloten / Requests / Rollen: isAdmin
            Damit sieht ein instructor nur den approval-link, ein admin
            sieht den vollen sektor. Wer weder noch ist, sieht den
            sektor gar nicht.

            Airline-Verwaltung war hier 2026-05-02 → wurde in den neuen
            Airline-Admin-sektor verschoben damit airline-admin/instructor
            es ohne admin-rolle erreichen können. */}
        {(user.isApprover || user.isAdmin) && user.hasAirline && (
          <NavSection title="Admin">
            {user.isApprover && (
              <NavLink href="/pireps/pending" pathname={pathname} icon="📋" label="PIREPs zur Prüfung" />
            )}
            {user.isAdmin && (
              <>
                <NavLink href="/admin/stats" pathname={pathname} icon="📊" label="Statistiken" />
                <NavLink href="/admin/pilots" pathname={pathname} icon="👥" label="Alle Piloten" />
                <NavLink href="/admin/requests" pathname={pathname} icon="📥" label="Requests" />
                <NavLink href="/admin/roles" pathname={pathname} icon="🔐" label="Rollen" />
              </>
            )}
          </NavSection>
        )}

        <NavSection title="Account">
          <NavLink href="/settings" pathname={pathname} icon="⚙️" label="Einstellungen" />
        </NavSection>
      </div>

      {/* Position-block am unteren rand der sidebar (Welle 4). Bewusst
          AUSSERHALB des nav-sections-containers weil's keine nav-aktion
          ist sondern ein read-only status-display. mt-auto schiebt's
          nach unten — funktioniert weil parent (nav.flex-col) die volle
          höhe füllt und der nav-sections-container darüber kein flex-grow
          hat. Border-top trennt visuell von der nav-liste.

          Display-logik (siehe ShellUser-kommentar):
            beide null               → "📍 Position unbekannt"
            current = base           → "📍 EDDF (Base)"
            current ≠ base, base set → "📍 EDDF" + "Base: EDDM"
            current set, base null   → "📍 EDDF"
            current null, base set   → "Base: EDDF" (faded, kein 📍-emoji
                                       weil keine aktive position)

          Nur sichtbar wenn der user eine airline hat — pilots ohne airline
          (z.B. neuer signup vor invite) haben weder hub noch sinnvolle
          position. */}
      {user.hasAirline && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-xs">
          {user.currentLocationIcao && user.baseIcao && user.currentLocationIcao === user.baseIcao && (
            <p className="text-gray-700 dark:text-gray-300">
              <span aria-hidden="true">📍</span>{' '}
              <span className="font-mono font-semibold text-sm">{user.currentLocationIcao}</span>
              <span className="text-gray-500 dark:text-gray-500"> (Base)</span>
            </p>
          )}
          {user.currentLocationIcao && user.baseIcao && user.currentLocationIcao !== user.baseIcao && (
            <>
              <p className="text-gray-700 dark:text-gray-300">
                <span aria-hidden="true">📍</span>{' '}
                <span className="font-mono font-semibold text-sm">{user.currentLocationIcao}</span>
              </p>
              <p className="text-gray-500 dark:text-gray-500 mt-0.5 ml-5">
                Base: <span className="font-mono">{user.baseIcao}</span>
              </p>
            </>
          )}
          {user.currentLocationIcao && !user.baseIcao && (
            <p className="text-gray-700 dark:text-gray-300">
              <span aria-hidden="true">📍</span>{' '}
              <span className="font-mono font-semibold text-sm">{user.currentLocationIcao}</span>
            </p>
          )}
          {!user.currentLocationIcao && user.baseIcao && (
            <p className="text-gray-500 dark:text-gray-500">
              Base: <span className="font-mono">{user.baseIcao}</span>
            </p>
          )}
          {!user.currentLocationIcao && !user.baseIcao && (
            <p className="text-gray-500 dark:text-gray-500 italic">
              <span aria-hidden="true">📍</span> Position unbekannt
            </p>
          )}
        </div>
      )}
    </nav>
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
