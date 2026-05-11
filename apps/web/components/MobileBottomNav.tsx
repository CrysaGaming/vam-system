'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/lib/stores/ui-store';

/**
 * Track 4 #76 (Section O) — Mobile Bottom-Nav
 *
 * Fixed-bottom-bar mit den 4 häufigsten nav-zielen + "Mehr"-button der den
 * existing hamburger-drawer öffnet. Auf mobile (<lg) sichtbar; auf desktop
 * komplett versteckt (lg:hidden) weil dort die permanente sidebar das gleiche
 * macht.
 *
 * # Warum bottom-nav statt nur hamburger
 *
 * Hamburger-drawer (Track 3 #11.2.4 Phase 3) ist gut für die volle nav-liste,
 * aber für die häufigsten ziele (Dashboard, Bookings, PIREPs, Live) ist 2-tap
 * (hamburger → link) zu viel. Bottom-nav reduziert das auf 1-tap und ist
 * auf mobile-OS-niveau (iOS/Android) die etablierte konvention für
 * primary-nav-stops.
 *
 * # Item-set
 *
 * 4 fixed items + 1 "Mehr"-button:
 *   1. Dashboard — daily startpoint
 *   2. Bookings — pre-flight workflow
 *   3. PIREPs — post-flight workflow
 *   4. Live — community/spectator
 *   5. Mehr — opens hamburger drawer für admin/airline/settings/etc.
 *
 * Bewusst NICHT in den 4: airline-admin-features (nur für admins relevant),
 * settings (selten), career/economy (gated). "Mehr" deckt all das ab. Wenn
 * der user häufig in den drawer geht für ein bestimmtes ziel, kann das
 * später als personalization in die bottom-nav rotieren — out of scope v1.
 *
 * # Layout-impact: bottom-padding auf main
 *
 * Die bar ist 64px hoch (16 + content + 16). Wenn wir nichts tun, würde
 * sie content unten überlagern (z.B. den letzten table-row im PIREPs-list
 * unter sich verschlucken). Lösung: `pb-20` (= 80px) auf `<main>` auf
 * mobile, `lg:pb-0` auf desktop wo die nav nicht da ist.
 *
 * Das wird in AppShell.tsx am scroll-wrapper-div gesetzt damit ALLE pages
 * automatisch den richtigen platz haben — pages müssen nichts wissen.
 *
 * # Future: per-rolle item-customization
 *
 * Wenn wir badge-counts (z.B. "Mehr" mit count-badge für pending PIREPs
 * wenn user approver ist) brauchen, würde diese component ein `user`-prop
 * mit ShellUser bekommen. Aktuell ist das item-set static — bewusst
 * minimalistisch v1.
 */

interface BottomNavItem {
  href: string;
  icon: string;
  label: string;
  /** Exact match nur für /dashboard (sonst bleibt's active auf /dashboard/anything). */
  exact?: boolean;
}

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { href: '/dashboard', icon: '🏠', label: 'Home', exact: true },
  { href: '/bookings', icon: '✈️', label: 'Buchen' },
  { href: '/pireps', icon: '📋', label: 'PIREPs' },
  { href: '/live', icon: '🌐', label: 'Live' },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  // # Visibility-rules
  //
  // - lg:hidden — auf desktop versteckt (sidebar übernimmt).
  // - safe-area-inset-bottom padding — auf iOS-PWAs (notch-devices) klebt
  //   die nav sonst hinter der home-indicator-area. env(safe-area-inset-
  //   bottom) ist der iOS-property; android ignoriert es einfach (= 0px).
  //
  // # Active-state-erkennung
  //
  // exact=true → strict equality. Sonst pathname startsWith href, aber
  // exclude den fall wo href '/dashboard' ist und pathname mit '/dashboard'
  // anfängt (das wäre ja immer true für jeden /dashboard/xyz-pfad).
  // Default-fall: startsWith(href + '/') ODER pathname === href. Damit
  // bleibt /bookings active auf /bookings/[id] aber /dashboard nicht
  // auf /dashboards-2-was-auch-immer.

  return (
    <nav
      aria-label="Mobile-Navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex items-stretch justify-around">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-2 min-h-[56px] transition ${
                  isActive
                    ? 'text-primary'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                {/* Aktiv-indikator: dünner balken oben am button. Mehr
                    visueller punch als nur farbänderung; matches the sidebar's
                    left-border-active-style aber von oben statt von links.
                    `relative` ist auf dem <Link> oben — sonst würde absolute
                    aus dem <li> rausbrechen. */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full"
                  />
                )}
                <span className="text-xl leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="text-[10px] font-medium leading-tight">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}

        {/* "Mehr"-button öffnet den hamburger-drawer. Kein Link — onClick
            setzt mobileNavOpen=true im UI-store, was die existing drawer-
            mechanik in Sidebar.tsx triggert. Bewusst KEIN active-state
            (es ist kein nav-ziel sondern ein menu-toggle). */}
        <li className="flex-1">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="w-full flex flex-col items-center justify-center gap-0.5 px-2 py-2 min-h-[56px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition"
            aria-label="Weitere Navigation öffnen"
          >
            <span className="text-xl leading-none" aria-hidden="true">
              ☰
            </span>
            <span className="text-[10px] font-medium leading-tight">Mehr</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
