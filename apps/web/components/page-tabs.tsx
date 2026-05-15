'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * Welle Q (UX-Reorg): shared Link-based tab navigation for "hub" page
 * groups — Fleet, Operations, Training, Verwaltung.
 *
 * # Design — why Link-tabs, not Settings-style panel-switch?
 *
 * SettingsTabs (apps/web/app/settings/settings-tabs.tsx) is a single-
 * route component that swaps panels via URL-hash + CSS visibility. That
 * pattern only works when one server component can fetch ALL panel
 * data in one Promise.all and pass it down as ReactNodes.
 *
 * The hub groups in this PR (`/airline/fleet`, `/airline/aircraft`,
 * `/airline/maintenance`, `/airline/hubs`, etc.) each have their own
 * route, their own data-loaders, and their own auth gates. Trying to
 * fold them into a single route would require:
 *   - Merging six page-component data loaders into one
 *   - Re-implementing each subpage's gating
 *   - Breaking direct deep-links from external sources (Discord bot
 *     embeds, audit-log entries, mentor-feedback URLs)
 *
 * Link-tabs achieve the same VISUAL grouping (user sees consistent
 * tab bar at top of every page in the group, clicks to switch) with
 * zero content refactoring. Each underlying page keeps its route, its
 * loader, its bookmarkability. The only addition is one component
 * import + render at the top.
 *
 * # Visual consistency with SettingsTabs
 *
 * Identical active-state styling (`border-indigo-500 text-indigo-700
 * dark:text-white`) so the user's eye reads "tabs" the same way
 * everywhere. Border-bottom-2 + py-3 + px-4 matches. The only
 * structural difference is that here the elements are `<Link>` not
 * `<button>` — for screen-readers the difference is "link to other
 * page" vs "switch panel", which is the honest semantic mapping.
 *
 * # Active-state detection
 *
 * Each tab declares its `href`. A tab is active when the current
 * pathname starts with its href. For nested routes — e.g. tab href
 * `/airline/fleet` would match `/airline/fleet/123/edit` too — the
 * default is fine; deepest-prefix-wins ordering is handled by the
 * order of TABS within a group config (more specific routes first).
 *
 * # Mobile / overflow
 *
 * `overflow-x-auto` lets the tab bar scroll horizontally on narrow
 * viewports. `whitespace-nowrap` per tab prevents wrapping. Matches
 * the SettingsTabs approach for visual consistency.
 */

export interface TabDef {
  /** Absolute pathname, e.g. '/airline/fleet'. */
  href: string;
  /** Display label, e.g. 'Übersicht'. */
  label: string;
  /** Single emoji prefix, optional. */
  icon?: string;
  /**
   * exact=true → only matches when pathname === href. Use this for
   * a tab whose href is a prefix of other tabs in the same group
   * (e.g. '/airline' vs '/airline/dashboard'). Without it, the
   * shorter href would always match.
   */
  exact?: boolean;
}

export interface PageTabsProps {
  /** Ordered list of tabs. Define more-specific routes first so the
   *  startsWith fallback resolves correctly. */
  tabs: TabDef[];
  /** Optional aria-label for the tab nav element. Defaults to "Page
   *  sections". */
  ariaLabel?: string;
  /**
   * Optional emoji + short headline shown ABOVE the tab bar to give
   * the hub a name. Without it, the tab bar floats free at the top
   * of the page. With it, users see "🛩️ Fleet" then tabs — clearer
   * grouping for new users.
   */
  hubTitle?: string;
  hubIcon?: string;
}

export function PageTabs({ tabs, ariaLabel, hubTitle, hubIcon }: PageTabsProps) {
  const pathname = usePathname();

  function isActive(tab: TabDef): boolean {
    if (tab.exact) return pathname === tab.href;
    return pathname === tab.href || pathname.startsWith(tab.href + '/');
  }

  return (
    <div className="mb-6">
      {hubTitle && (
        <div className="mb-3 flex items-baseline gap-2">
          {hubIcon && (
            <span className="text-lg" aria-hidden="true">
              {hubIcon}
            </span>
          )}
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            {hubTitle}
          </h2>
        </div>
      )}
      <nav
        className="flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label={ariaLabel ?? 'Page sections'}
      >
        {tabs.map((tab) => {
          const active = isActive(tab);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition',
                active
                  ? 'border-indigo-500 text-indigo-700 dark:text-white'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {tab.icon && (
                <span aria-hidden="true">{tab.icon}</span>
              )}
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Hub configs — single source of truth per hub group.
//
// Keep these in this file (not split per hub) so when adding/removing
// pages in a hub, there's one place to edit. Each hub is a const
// array exported separately so consumer pages do:
//
//   import { PageTabs, FLEET_TABS } from '@/components/page-tabs';
//   <PageTabs tabs={FLEET_TABS} hubTitle="Fleet" hubIcon="🛩️" />
//
// Active-tab detection is positional: list more-specific paths first.
// E.g. '/airline/aircraft' should come before '/airline' in any config
// that contains both.
// ────────────────────────────────────────────────────────────

/**
 * Verwaltung-Hub: airline-settings page family. The base /airline
 * route is the airline settings form + member-table (legacy), then
 * sub-routes for ranks, hubs, onboarding.
 *
 * Note: /airline must be `exact: true` because the longer routes
 * (/airline/ranks etc) all start with /airline. Without exact, the
 * Verwaltung tab would also stay active on every other airline-admin
 * page.
 */
export const VERWALTUNG_TABS: TabDef[] = [
  { href: '/airline', label: 'Verwaltung', icon: '🏢', exact: true },
  { href: '/airline/pilots', label: 'Personal', icon: '👥' },
  { href: '/airline/ranks', label: 'Ränge', icon: '🏅' },
  { href: '/airline/hubs', label: 'Hubs', icon: '📍' },
  { href: '/airline/onboarding', label: 'Onboarding', icon: '🎓' },
];

/**
 * Fleet-Hub: aircraft + maintenance + hubs together. Hubs is also in
 * Verwaltung above — listed in both because pilots looking at fleet
 * naturally think about which hub aircraft are based at, while
 * admins managing the company think of hubs as a settings concern.
 * Duplication is intentional discoverability.
 */
export const FLEET_TABS: TabDef[] = [
  { href: '/airline/fleet', label: 'Übersicht', icon: '📊' },
  { href: '/airline/aircraft', label: 'Aircraft', icon: '🛩️' },
  { href: '/airline/maintenance', label: 'Wartung', icon: '🔧' },
];

/**
 * Operations-Hub: scheduling + crewing + day-of-ops + intel.
 * Six tabs — at the upper limit before the bar starts feeling
 * cluttered, but each one is a distinct operational view and they
 * naturally cluster (left-half = planning, right-half = day-of).
 */
export const OPERATIONS_TABS: TabDef[] = [
  { href: '/airline/schedule', label: 'Schedule', icon: '🕒' },
  { href: '/airline/roster', label: 'Roster', icon: '📋' },
  { href: '/airline/pairings', label: 'Pairings', icon: '✈️' },
  { href: '/airline/dispatch', label: 'Dispatch', icon: '🎯' },
  { href: '/airline/notams', label: 'NOTAMs', icon: '📢' },
  { href: '/airline/weather', label: 'Wetter', icon: '🌬️' },
];

/**
 * Training-Hub: instructor-side career-mgmt + exam-pipelines +
 * mentorship-matching. All gated on isApprover + airlineCareerEnabled
 * at the sidebar level — the individual page components keep their
 * own internal gates as defense in depth.
 */
export const TRAINING_TABS: TabDef[] = [
  { href: '/airline/practical-exams', label: 'Praktische Prüfungen', icon: '🎓' },
  { href: '/airline/exams/type-ratings', label: 'Type-Ratings', icon: '⏰' },
  { href: '/airline/mentorship', label: 'Mentorship', icon: '🤝' },
];

/**
 * Routes-Hub (lighter, just two): admin's route-CRUD vs the public
 * browse view. Both link there from sidebar but a pilot who finds
 * themselves on one occasionally wants the other.
 */
export const ROUTES_TABS: TabDef[] = [
  { href: '/routes', label: 'Browse', icon: '🛣️' },
  { href: '/airline/routes', label: 'Verwaltung', icon: '🛠️' },
];
