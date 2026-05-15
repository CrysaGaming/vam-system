'use client';

import { usePathname } from 'next/navigation';

import {
  PageTabs,
  VERWALTUNG_TABS,
  FLEET_TABS,
  OPERATIONS_TABS,
  TRAINING_TABS,
  type TabDef,
} from '@/components/page-tabs';

/**
 * Welle Q (UX-Reorg) — Airline-hub tabs auto-resolver.
 *
 * Renders the right PageTabs based on the current /airline/* pathname.
 * Returns null on routes that aren't part of any hub (e.g. /airline/
 * dashboard, /airline/finance, /airline/admin/audit-log) so those
 * pages render without tab clutter.
 *
 * # Design
 *
 * This component lives in /airline/_hub-tabs.tsx and is rendered by
 * /airline/layout.tsx ABOVE every child page. Because it's a client
 * component (usePathname) sitting inside a server-component layout,
 * it doesn't force-client-render the page tree — Next.js composes
 * server-layout > client-this > server-child-page cleanly.
 *
 * # Hub resolution order
 *
 * Order matters because some hubs share prefix-paths:
 *   - VERWALTUNG ends at '/airline/onboarding'
 *   - FLEET starts at '/airline/aircraft' etc.
 * Both are siblings under /airline, so we walk each hub's tab list
 * and check if any tab's href matches the current pathname. First
 * hub with a match wins. Order is "most-specific-first" to avoid
 * accidental prefix overlaps.
 *
 * # Routes deliberately NOT in any hub
 *
 *   /airline/dashboard      — landing page, deserves the full width
 *   /airline/finance        — its own deep page (charts, ledgers)
 *   /airline/economy        — VAMSE admin, separate concern
 *   /airline/admin/audit-log — already nested under /admin
 *   /airline/routes         — has its own /routes-vs-/airline/routes
 *                             cross-link in the sidebar instead
 *
 * If a future page should join a hub, add its href to the relevant
 * *_TABS array in components/page-tabs.tsx — no changes here.
 */

const HUBS: Array<{
  tabs: TabDef[];
  title: string;
  icon: string;
  ariaLabel: string;
}> = [
  // Training first because its hrefs are deeper (/airline/practical-exams
  // is more specific than e.g. /airline). Same for Operations and Fleet
  // ahead of the catch-all-ish Verwaltung.
  { tabs: TRAINING_TABS, title: 'Training', icon: '🎓', ariaLabel: 'Training hub' },
  { tabs: OPERATIONS_TABS, title: 'Operations', icon: '🎯', ariaLabel: 'Operations hub' },
  { tabs: FLEET_TABS, title: 'Fleet', icon: '🛩️', ariaLabel: 'Fleet hub' },
  // Verwaltung includes '/airline' (exact) — listing it last because
  // its non-exact tabs (/airline/ranks etc) are still distinct enough
  // not to overlap with the others above.
  { tabs: VERWALTUNG_TABS, title: 'Airline-Verwaltung', icon: '🏢', ariaLabel: 'Verwaltung hub' },
];

export function AirlineHubTabs() {
  const pathname = usePathname();

  // Find the first hub whose tab-list contains a match.
  const hub = HUBS.find((h) =>
    h.tabs.some((t) =>
      t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + '/'),
    ),
  );

  if (!hub) return null;

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <PageTabs
          tabs={hub.tabs}
          hubTitle={hub.title}
          hubIcon={hub.icon}
          ariaLabel={hub.ariaLabel}
        />
      </div>
    </div>
  );
}
