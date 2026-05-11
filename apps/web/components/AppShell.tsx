'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { ThemeToggle } from './Theme';
import { useUIStore } from '@/lib/stores/ui-store';
import { navigateWithTransition } from '@/lib/view-transitions';
import { KeyboardShortcutsManager } from './keyboard-shortcuts-manager';
import { CommandPalette } from './command-palette';
import { RecentlyViewedBlock } from './recently-viewed-block';
import { PwaInstallPrompt } from './PwaInstallPrompt';
import { MobileBottomNav } from './MobileBottomNav';
import { PullToRefresh } from './PullToRefresh';
import { OfflineBanner } from './OfflineBanner';

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
  // Welle 13E-5: Career-features sind opt-in (analog hasEconomy).
  // hasCareer ist true wenn user.careerEnabled UND airline.careerEnabled.
  // Steuert die sichtbarkeit des "Lizenzen"-sidebar-links. Wenn false:
  // link wird nicht gerendert; /licenses-page selbst hat einen separaten
  // gating-redirect.
  hasCareer: boolean;
  // Welle 13E-14c: Separater flag nur für die airline-seite des career-
  // opt-ins (analog airlineEconomyEnabled). Steuert die sichtbarkeit des
  // "Praktische Prüfungen"-links im Admin-section. Bedingung: airline.
  // careerEnabled UND canManageAirline. Bewusst getrennt von hasCareer
  // weil ein admin der seine PERSÖNLICHE career-toggle off hat trotzdem
  // die airline-side reviews machen können muss — das sind getrennte
  // concerns (privater pilot-progress vs. instructor-tool für die airline).
  airlineCareerEnabled: boolean;
  // Welle 4: Position-tracking. baseIcao = pilot's hub innerhalb der airline,
  // currentLocationIcao = wo er grade ist. Beide nullable (neuer pilot ohne
  // hub-zuweisung, oder vor erstem flug). Sidebar zeigt einen kompakten
  // status-block "📍 EDDF" (current location) mit subtitle "Base: EDDM"
  // wenn current ≠ base. Wenn current = base, zeigt nur "📍 EDDF (Base)".
  // Wenn beide null, zeigt der block "📍 Position unbekannt".
  baseIcao: string | null;
  currentLocationIcao: string | null;
  // Welle 14C: Live-stream-count für den header-counter ("🔴 N live").
  // Anzahl der pilots aus DERSELBEN airline die grade twitch-live sind.
  // 0 wenn keine pilots live oder user keiner airline angehört. Header
  // rendert den counter nur wenn > 0 — bei 0 versteckt sich der button
  // komplett damit der header nicht mit dauerhaft-leeren indikatoren
  // überfüllt ist.
  liveStreamCount: number;
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
      {/* Track 4 #79 (Section O): Offline-Banner. Sticky top-0 mit z-50 damit
          es ÜBER dem header (z-30) und drawer-backdrop (z-40) liegt. Renders
          null wenn online, amber-banner wenn offline, kurzen grünen toast
          beim reconnect. Erstes element im shell damit es visuell über
          allem anderen sitzt. */}
      <OfflineBanner />

      {/* Track 4 #53: Global keyboard-shortcut manager. Mounted hier
          (innerhalb shell, nach auth-gate) damit shortcuts NUR für
          authentifizierte user mit shell aktiv sind — auf der landing/
          login-page brauchen wir kein `g d` nav. Renders null bis der
          help-dialog (`?`) geöffnet wird. */}
      <KeyboardShortcutsManager />

      {/* Track 4 #70 (Section N): Globaler Command-Palette (Cmd+K / Ctrl+K).
          Identisches mount-pattern wie der KeyboardShortcutsManager —
          renders null bis das modal geöffnet wird, also kein DOM-overhead
          im idle-zustand. Eigener key-listener (Cmd/Ctrl+K) damit es nicht
          mit dem `g X` sequence-handler im ShortcutsManager kollidiert. */}
      <CommandPalette />

      {/* Track 4 #75 (Section O): PWA Install-Prompt. Floating banner unten-
          rechts (oder full-width-edge auf mobile) der appears 8s nach mount
          wenn der browser beforeinstallprompt fired UND der user die app
          noch nicht installed/dismissed hat. Self-contained — kein
          prop-drilling, eigener localStorage-state. */}
      <PwaInstallPrompt />

      {/* Track 4 #78 (Section O): Pull-to-Refresh. Touch-gesture handler
          der pull-down vom top der scroll-area (#main-content) in einen
          router.refresh() umsetzt. Self-contained — attached an
          #main-content via DOM-id, kein prop-drilling. Touch-only
          (matchMedia pointer:coarse), kein-op auf desktop. Renders nur
          während pull oder refresh den indicator. */}
      <PullToRefresh />

      {/* Skip-to-content link für keyboard-user (Track 3 #11.2.4 Phase 5
          a11y-polish). Default visuell versteckt (transform: translateY(-100%)
          via .skip-to-content class in globals.css), wird sichtbar wenn ein
          keyboard-user TAB drückt. Click → springt zum #main-content und
          überspringt header + sidebar-nav. WCAG 2.1 SC 2.4.1 (Bypass Blocks).

          Erstes element im DOM damit's der erste TAB-stop ist — sonst
          nutzlos. */}
      <a href="#main-content" className="skip-to-content">
        Zum Hauptinhalt springen
      </a>

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
            nav + header bleiben fix.

            id="main-content" + tabIndex={-1} ist der ziel-anchor des
            skip-to-content-links (siehe oben). tabIndex={-1} macht das
            element programmatisch fokussierbar (für skip-link.click → focus
            jumps here) ohne es in den natürlichen TAB-order aufzunehmen.
            Track 3 #11.2.4 Phase 5 a11y-polish.

            Track 4 #76 (Section O): pb-20 lg:pb-0 — auf mobile braucht der
            scroll-bereich 80px bottom-padding damit content nicht unter der
            MobileBottomNav verschwindet. Auf lg+ ist die bottom-nav weg
            (lg:hidden in der component selbst), also kein padding nötig. */}
        <div id="main-content" tabIndex={-1} className="flex-1 min-w-0 overflow-y-auto focus:outline-none pb-20 lg:pb-0">{children}</div>
      </div>

      {/* Track 4 #76 (Section O): Mobile Bottom-Nav. Fixed an bottom-edge,
          nur sichtbar auf <lg (intern via lg:hidden). Außerhalb des
          flex-row-containers weil es viewport-positioned ist (fixed bottom-0).
          Sitzt im AppShell-outer damit's auf allen pages konsistent erscheint. */}
      <MobileBottomNav />
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
      className="shell-header sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-4 sm:px-10 sm:py-6 lg:px-12 lg:py-8 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800"
      aria-label="Header"
    >
      {/* Mobile-only hamburger left of brand. Track 3 #11.2.4 Phase 3:
          öffnet die sidebar als slide-in drawer. Auf lg+ unsichtbar
          (lg:hidden) weil dort die sidebar permanent steht. Sitzt VOR
          dem brand-link, weil das die etablierte konvention für mobile-
          headers ist (hamburger-links, brand-mitte oder rechts). */}
      <MobileNavToggle />
      <BrandLink user={user} />
      <div className="flex items-center gap-1 sm:gap-2">
        <LiveStreamCounter count={user.liveStreamCount} />
        <ThemeToggle />
        <UserDropdown user={user} />
      </div>
    </header>
  );
}

/**
 * Hamburger-button für mobile-nav. Track 3 #11.2.4 Phase 3.
 *
 * Liest mobileNavOpen aus useUIStore (state lebt im store damit Sidebar
 * + Header unabhängig voneinander den state lesen können — kein
 * prop-drilling durch AppShell). setMobileNavOpen(true) öffnet den
 * drawer; die sidebar-component selbst rendert den content + backdrop.
 *
 * lg:hidden: ab lg-breakpoint (1024px) ist die sidebar permanent
 * sichtbar, kein hamburger nötig. aria-expanded reflektiert den
 * drawer-state für screen-reader.
 *
 * aria-controls="primary-navigation" zeigt auf die <nav>-id in der
 * Sidebar — das gibt screen-reader das verständnis dass dieser button
 * die nav steuert.
 */
function MobileNavToggle() {
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  return (
    <button
      type="button"
      onClick={() => setMobileNavOpen(!mobileNavOpen)}
      className="lg:hidden flex items-center justify-center w-10 h-10 -ml-2 mr-1 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
      aria-label={mobileNavOpen ? 'Navigation schließen' : 'Navigation öffnen'}
      aria-expanded={mobileNavOpen}
      aria-controls="primary-navigation"
    >
      {/* Icon-toggle: hamburger wenn closed, X wenn open. Beide SVGs
          sind die selbe größe (w-6 h-6) damit der button nicht
          jumpiert wenn der state wechselt. */}
      {mobileNavOpen ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      )}
    </button>
  );
}

/**
 * Welle 14C: Header-counter "🔴 N live". Sichtbar nur wenn count > 0
 * (versteckt sich komplett bei 0 damit der header nicht permanent
 * mit toten indikatoren überfüllt ist). Klick → /live page für details.
 *
 * Visuell: red-pulse-dot + count + "live"-label. Auf mobile (sm-) zeigt
 * nur den dot + count, das "live"-label kommt erst ab sm: dazu damit
 * platz im engen header bleibt.
 *
 * Realtime-update-policy: der count kommt vom RSC layout.tsx und ist
 * ein stale-snapshot zum render-zeitpunkt. Bei live-event-änderungen
 * wird er erst beim nächsten page-load aktualisiert. Das ist akzeptabel
 * weil livestreams nicht so häufig wechseln dass die UI stale wirken
 * würde — bei einer realtime-anforderung würde ein websocket-push
 * dazukommen (out-of-scope für 14C).
 */
function LiveStreamCounter({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link
      href="/live"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-600/10 hover:bg-red-600/20 dark:bg-red-500/15 dark:hover:bg-red-500/25 text-red-700 dark:text-red-400 text-sm font-medium transition border border-red-500/20 hover:border-red-500/40"
      aria-label={`${count} ${count === 1 ? 'Pilot streamt' : 'Piloten streamen'} grade live`}
      title={`${count} ${count === 1 ? 'Pilot streamt' : 'Piloten streamen'} grade live`}
    >
      <span
        className="inline-block w-2 h-2 rounded-full bg-red-600 dark:bg-red-500 animate-pulse"
        aria-hidden="true"
      />
      <span className="font-semibold">{count}</span>
      <span className="hidden sm:inline">live</span>
    </Link>
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
          className="w-14 h-14 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shrink-0"
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
              <p className="text-xs text-primary mt-0.5">
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
 * aria-label="Hauptnavigation". 
 *
 * # Desktop-verhalten (lg+, ≥1024px)
 *
 * Sitzt links neben dem main-content im inneren flex-row container und
 * bleibt visuell fixed beim scrollen — nicht durch sticky-positioning
 * sondern durch das outer-wrapper-pattern: das AppShell-outer ist h-screen
 * (fix 100vh) mit dem main-bereich als einzigem scrolling element
 * (overflow-y-auto). Sidebar ist innerhalb vom flex-row aber außerhalb
 * des scrollers, also bewegt sich nicht.
 *
 * Vorher (commit 49cae36..897dfda) wurde sticky top-28 versucht, aber
 * das hatte zwei probleme: (1) in flex-children manchmal nicht zuverlässig,
 * (2) wenn sticky aktiviert wurde überlappte die sidebar visuell mit
 * dem header (z-stacking-issue beim sticky). Das h-screen + overflow
 * pattern ist robuster.
 *
 * # Mobile-verhalten (<lg, <1024px) — Track 3 #11.2.4 Phase 3
 *
 * Statt `hidden lg:flex` (was die nav auf mobile KOMPLETT entfernt — vorher
 * hatten mobile-user keine navigation überhaupt!) rendern wir die sidebar
 * jetzt als slide-in drawer von links:
 *
 *   - mobileNavOpen=false: sidebar ist visuell off-screen (-translate-x-full)
 *     UND aria-hidden=true UND nicht-fokussierbar. Der drawer ist als DOM
 *     da aber unsichtbar/unbenutzbar.
 *   - mobileNavOpen=true: drawer slide-in (transform translate-x-0), backdrop
 *     erscheint über dem main-content, click auf backdrop oder ESC schließt.
 *   - Auf lg+: keine drawer-mechanik mehr, sidebar ist permanent visible
 *     (lg:translate-x-0 lg:static lg:h-auto lg:bg-...) ohne backdrop.
 *
 * Auto-close pattern: bei jeder pathname-änderung (= navigation passiert)
 * wird der drawer geschlossen. So ist das verhalten: tap-link → drawer
 * schließt + neue page rendert. Standard mobile-nav-UX.
 *
 * Body-scroll-lock: wenn drawer auf mobile offen ist, wird body-scroll
 * disabled damit der user nicht versehentlich die main-content scrollt
 * während er auf die nav guckt. Auf lg+ irrelevant (keine drawer-mechanik).
 *
 * # Vorher war's `<aside>`
 *
 * Semantisch ungenau weil aside für "side content related to but separate
 * from the main flow" gedacht ist (z.B. werbung, related links). Hier
 * ist's PRIMÄRE navigation, also `<nav>`.
 *
 * # Brand-block + user-block
 *
 * USED to live here (pre-2026-05-02). Both have moved to the header —
 * sidebar is now nav-only.
 */
function Sidebar({ user, pathname }: SidebarProps) {
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  // Auto-close drawer bei navigation. usePathname-changes treten beim
  // Link-click auf — nach dem nav-state-change cleart das hier den drawer.
  // Auf lg+ macht das nichts kaputt weil mobileNavOpen dort sowieso
  // unbenutzt ist (sidebar ist immer sichtbar).
  useEffect(() => {
    if (mobileNavOpen) {
      setMobileNavOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ESC schließt den drawer. Listener nur attached wenn drawer offen ist
  // damit kein global-keydown-listener für jede page-render läuft.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileNavOpen, setMobileNavOpen]);

  // Body-scroll-lock auf mobile wenn drawer offen. Auf lg+ kein-op
  // weil drawer-mechanik dort gar nicht greift, aber wir können das
  // nicht vom store-state ableiten (wir wissen nicht ob viewport ≥lg
  // ist ohne JS), darum schalten wir's pauschal zu wenn mobileNavOpen
  // true ist. Falls der user den hamburger drückt und dann das viewport
  // resized → next render hat lg-class und alles ok.
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [mobileNavOpen]);

  return (
    <>
      {/* Backdrop: nur sichtbar wenn drawer offen UND auf mobile (lg:hidden).
          aria-hidden weil rein dekorativ — der user-interaktiv-anspruch
          (close-on-click) ist über onClick, nicht über aria-rolle.
          Animation: opacity-fade-in damit der drawer nicht abrupt erscheint.
          z-40: über dem header (z-30) damit der drawer den header überlagert
          während er offen ist (cleaner mobile-UX). */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
          aria-hidden="true"
        />
      )}

      <nav
        id="primary-navigation"
        className={`
          shell-sidebar
          fixed lg:static inset-y-0 left-0 z-50 lg:z-auto
          flex flex-col w-64 lg:w-60 shrink-0 h-full overflow-hidden
          bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800
          transition-transform duration-200 ease-out
          ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        aria-label="Hauptnavigation"
      >
        {/* Innerer container für nav-sections. flex-1 füllt die volle
            nav-höhe. Bewusst KEIN overflow-y-auto — die nav darf nicht
            scrollen. Outer <nav> hat zusätzlich overflow-hidden als
            defensive guard, damit garantiert kein scroll auch wenn
            content theoretisch overflowen würde (sonst clippt's einfach).
            Falls die nav-liste mal länger wird als verfügbare höhe (z.B.
            mit vielen admin-sections), muss das design umgestellt werden
            (sections kollabieren oder kleinere icons statt scrolling).

            Mobile-only: ein close-button-row oben weil im drawer-mode
            kein hamburger im header sichtbar ist (header ist hinter dem
            backdrop). lg:hidden damit der button auf desktop weg ist. */}
        <div className="lg:hidden flex items-center justify-end px-3 py-3 border-b border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            aria-label="Navigation schließen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 px-3 py-4 space-y-6 overflow-y-auto lg:overflow-visible">
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
          {/* Welle 13E-5: Lizenzen-link analog zum Wallet-link gegated.
              hasCareer=true erfordert user.careerEnabled UND airline.career-
              Enabled. Sitzt unter Wallet weil career-progression eine
              persönliche pilot-management-aufgabe ist (selbe kategorie).
              Pilots ohne aktive licenses sehen die page als "Du hast noch
              keine Lizenzen"-empty-state mit hinweis auf flight-school
              enrollments (Welle 13E-12). */}
          {user.hasCareer && (
            <NavLink href="/licenses" pathname={pathname} icon="📜" label="Lizenzen" />
          )}
          {/* Welle 13E-12: Pilot-side flight-school browse. Selbe gating
              wie Lizenzen — nur sichtbar wenn beide career-toggles ON.
              Der pilot sieht hier alle aktiven schulen, kann sich
              einschreiben und hours kaufen. Die page selbst hat den
              gleichen redirect-fallback bei direkt-aufrufen. */}
          {user.hasCareer && (
            <NavLink href="/flight-schools" pathname={pathname} icon="🎓" label="Flugschulen" />
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
            {/* Track 3 #11.2.5 Foundation: Dashboard-landing für airline-
                admins. Bewusst SEPARAT von /airline (= Settings-Form +
                MemberTable, bestehend) damit non-destruktiv. Steht oben
                weil's konzeptionell der einstiegs-überblick ist. */}
            <NavLink href="/airline/dashboard" pathname={pathname} icon="📊" label="Dashboard" />
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
            {/* Welle 13E-14c: Praktische-Prüfungs-review für instructors.
                Sichtbar wenn isApprover (instructor + admin haben das) UND
                airline hat career aktiviert. Sitzt direkt unter "PIREPs zur
                Prüfung" weil's konzeptionell selbe kategorie ist (instructor-
                review-aufgabe), nur eine ebene tiefer (PIREP wird hier als
                exam-PIREP markiert vom pilot, instructor reviewed nochmal
                im career-context). */}
            {user.isApprover && user.airlineCareerEnabled && (
              <NavLink href="/airline/practical-exams" pathname={pathname} icon="🎓" label="Praktische Prüfungen" />
            )}
            {user.isAdmin && (
              <>
                {/* Track 3 #11.2.5 Foundation: /admin landing-page (vorher
                    war /admin ein 404). Steht oben im admin-only-block. */}
                <NavLink href="/admin" pathname={pathname} icon="🛠️" label="Server-Admin" exact />
                <NavLink href="/admin/stats" pathname={pathname} icon="📊" label="Statistiken" />
                <NavLink href="/admin/pilots" pathname={pathname} icon="👥" label="Alle Piloten" />
                <NavLink href="/admin/requests" pathname={pathname} icon="📥" label="Requests" />
                <NavLink href="/admin/roles" pathname={pathname} icon="🔐" label="Rollen" />
                {/* Welle 13E-11: FlightSchools sind cross-airline NPC-orgs, also
                    system-admin-only (nicht airline-admin). Sichtbar für isAdmin
                    unabhängig vom career-mode-toggle, weil das CRUD-tool für
                    den system-admin auch dann erreichbar bleiben muss wenn auf
                    seiner persönlichen airline career deaktiviert ist. */}
                <NavLink href="/admin/flight-schools" pathname={pathname} icon="🎓" label="Flugschulen" />
              </>
            )}
          </NavSection>
        )}

        <NavSection title="Account">
          <NavLink href="/settings" pathname={pathname} icon="⚙️" label="Einstellungen" />
        </NavSection>

        {/* Track 4 #71 (Section N): Recently-Viewed sidebar-block. Zeigt die
            5 letzten besuchten detail-pages (bookings/PIREPs/routes) als
            quick-reaccess-links. Renders client-side aus localStorage —
            zeigt nichts während des ersten render-cycles (mounted-flag-
            pattern) damit kein hydration-mismatch. Sitzt UNTER allen
            nav-sections + ÜBER dem position-block, klar als reaccess-tool
            vom permanenten nav abgegrenzt. */}
        <RecentlyViewedBlock />
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
    </>
  );
}

/**
 * Collapsible nav-section.
 *
 * # Track 3 #11.2.3 vNext Block C: store-migration
 *
 * Vorher hatte jede NavSection ihren eigenen useState + useEffect-load
 * + manuelles localStorage.setItem/.removeItem mit try/catch um SSR-
 * edge-cases. Storage-key war `vam:sidebar-collapsed:<title>`.
 *
 * Jetzt: useUIStore.sidebarCollapsed[title] (Map: section → collapsed).
 * Persist-middleware kapselt das localStorage-handling (key:
 * 'vam:ui-store'). Setter ist toggleSidebar(title) — atomic,
 * type-safe, kein manuelles set/remove.
 *
 * **Storage-format-bruch:** alte keys `vam:sidebar-collapsed:*` werden
 * NICHT migriert. Beim ersten reload nach diesem deployment haben alle
 * user wieder default-expanded sections. Das ist ok weil:
 *   - Die collapsed-states sind ein UX-convenience, kein kritischer
 *     state-verlust.
 *   - Eine migrations-funktion (alte keys lesen + in den store mergen
 *     + alte keys löschen) wäre 30+ zeilen für eine einmalige
 *     transition.
 *   - User collapsen sections wieder beim nächsten use, dann ist's wie
 *     vorher.
 *
 * # SSR / hydration
 *
 * Initial server-render hat keinen access auf localStorage → store-
 * defaults greifen (alle sections expanded). Auf dem client hydratet
 * zustand-persist async — wir brauchen einen mounted-flag damit der
 * erste client-render IDENTISCH zum server-render ist (sonst hydration-
 * mismatch). Das pattern ist exakt wie vorher, nur ohne den localStorage-
 * try/catch boilerplate.
 *
 * Folge: derselbe mini-flash wie vorher — wenn der user "Flying"
 * collapsed hatte, zeigt der erste paint expanded, dann fadet's
 * collapsed nachdem die store-rehydration durch ist. Doc-string
 * vorher hat das schon erklärt; bleibt unverändert. Akzeptabel
 * weil die alternative (suppressHydrationWarning oder cookie-based
 * persist) deutlich mehr complexity kostet.
 *
 * # Was unverändert bleibt
 *
 * - JSX-output (button + chevron + conditional children render)
 * - Keyboard-a11y (button + aria-expanded/aria-controls)
 * - Default-state (expanded — kein eintrag im store === expanded)
 * - Visuelles UX (chevron-rotation, kein height-transition)
 *
 * # Track 3 #11.2.4 verweis
 *
 * Die ganze sidebar wird in #11.2.4 neu strukturiert (220px-sidebar
 * + horizontal-header → vertical-sidebar links). Die collapsed-state-
 * map bleibt aber kompatibel — das neue layout konsumiert den selben
 * store-key, nur das wrapper-component drumrum ändert sich.
 */
function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  // SSR-hydration-flag: erst nach mount lesen wir den persist-store-
  // value. Während des initialen server-renders + ersten client-paints
  // ist `mounted=false` → wir nutzen den default (expanded). Sobald
  // mounted=true (nach erstem useEffect-tick), liest der selector
  // den echten persist-state — das löst den eventual-consistent
  // collapse aus.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Selektor + setter aus dem store. Selector muss den fallback `?? false`
  // haben weil `sidebarCollapsed[title]` für unbekannte sections undefined
  // ist (Record<string, boolean> ist non-exhaustive).
  const collapsedFromStore = useUIStore((s) => s.sidebarCollapsed[title] ?? false);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const collapsed = mounted ? collapsedFromStore : false;

  function toggle() {
    toggleSidebar(title);
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={`navsection-${title}`}
        className="w-full flex items-center justify-between px-3 mb-1 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 font-medium hover:text-gray-700 dark:hover:text-gray-300 transition"
      >
        <span>{title}</span>
        <svg
          className={`w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!collapsed && (
        <div id={`navsection-${title}`} className="space-y-0.5">
          {children}
        </div>
      )}
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
  const router = useRouter();

  // Track 3 #11.2.7 — View-transition-wrapped navigation für alle sidebar-
  // links. Statt next/link's default behavior (router.push direkt) wrappen
  // wir den click in document.startViewTransition() (siehe lib/view-
  // transitions.ts für details).
  //
  // Modifier-key-handling: wir lassen cmd/ctrl/shift/middle-click durch
  // ohne preventDefault → der user kann links wie üblich in neuen tabs
  // öffnen. Native-link-verhalten ist die wichtigste a11y-eigenschaft
  // die wir nicht brechen wollen.
  //
  // e.button !== 0 = nicht der primäre maus-button (z.B. middle-click =
  // 1 → "open in new tab"). isLeft-click + no-modifier = "normal navigate"
  // → preventDefault + view-transition.
  const onClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    e.preventDefault();
    navigateWithTransition(router, href);
  };

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition ${
        isActive
          ? 'bg-primary/10 text-primary border-l-2 border-primary -ml-0.5 pl-[10px]'
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
