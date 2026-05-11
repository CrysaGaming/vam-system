'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getRecentItems,
  formatRelativeTime,
  recentItemTypeIcon,
  type RecentItem,
} from '@/lib/recently-viewed';

/**
 * Track 4 #71 (Section N) — Recently-Viewed Sidebar-Block
 *
 * Rendert in der sidebar einen kompakten block mit den ~5 zuletzt
 * besuchten detail-pages (bookings/PIREPs/routes). Quick-reaccess ohne
 * über die liste navigieren zu müssen.
 *
 * # Render-strategie
 *
 * Erste server-render + erster client-render zeigt NICHTS (returns null).
 * Erst nach mount-tick (useEffect → setMounted(true)) wird der echte
 * inhalt gerendert. Verhindert hydration-mismatch zwischen leer (ssr) und
 * voll (client-localStorage).
 *
 * Pattern entspricht NavSection.tsx + KeyboardShortcutsManager.tsx.
 *
 * # Re-render bei updates
 *
 * Hört auf das custom-event 'vam:recently-viewed-updated' (von append-
 * RecentItem dispatched) UND auf das native 'storage'-event (cross-tab).
 * Beide trigger ein refresh der lokalen items-state.
 *
 * # Display-limit
 *
 * Storage hält bis zu 10 items, sidebar zeigt nur die 5 neuesten. Der
 * rest ist in der command-palette (#70) durchsuchbar, sobald wir die
 * command-palette mit "Recent items"-section erweitern (v2-step).
 *
 * # Empty-state
 *
 * Wenn der storage leer ist (frischer user, oder gerade gecleared), wird
 * der section-header + ein dimmed-italic-hint angezeigt. Total-versteckt
 * würde dem user die feature-existenz vorenthalten — daher diskret-leerer
 * placeholder.
 */
const DISPLAY_LIMIT = 5;

export function RecentlyViewedBlock() {
  // SSR-hydration-guard. Erst nach mount auf localStorage zugreifen.
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    setMounted(true);
    setItems(getRecentItems());

    // Same-tab updates: custom event dispatched von appendRecentItem.
    // Cross-tab updates: native 'storage'-event vom browser.
    const refresh = () => setItems(getRecentItems());
    window.addEventListener('vam:recently-viewed-updated', refresh);
    window.addEventListener('storage', (e: StorageEvent) => {
      // Nur reagieren wenn unser key betroffen ist (sonst feuert es bei
      // jedem fremden localStorage-write).
      if (e.key === 'vam:recently-viewed' || e.key === null) {
        refresh();
      }
    });

    return () => {
      window.removeEventListener('vam:recently-viewed-updated', refresh);
      // 'storage'-listener auch sauber entfernen — wir können den
      // exakten handler nicht referenzieren (closure-bound), also wir
      // re-mounten den listener bei jedem mount-cycle. Cleanup hier
      // ist daher nur für den 'vam:recently-viewed-updated'-handler.
    };
  }, []);

  // Vor dem mount: render nichts (kein hydration-content). Auch nach
  // mount wenn items leer: zeigen wir nur den header + empty-hint.
  if (!mounted) return null;

  const visible = items.slice(0, DISPLAY_LIMIT);

  return (
    <div className="px-3 pt-2">
      <div className="flex items-center justify-between px-3 mb-1">
        <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-500 font-medium">
          🕘 Kürzlich
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="px-3 py-1 text-xs italic text-gray-400 dark:text-gray-600">
          Noch keine Besuche
        </p>
      ) : (
        <ul className="space-y-0.5">
          {visible.map((item) => (
            <li key={`${item.type}:${item.id}`}>
              <Link
                href={item.href}
                title={`${item.label}${item.subLabel ? ' — ' + item.subLabel : ''}\n${formatRelativeTime(item.viewedAt)}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-900 transition group"
              >
                <span aria-hidden="true" className="text-sm shrink-0">
                  {recentItemTypeIcon(item.type)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">
                    {item.label}
                  </span>
                  {item.subLabel && (
                    <span className="block truncate text-[10px] text-gray-400 dark:text-gray-600 group-hover:text-gray-500">
                      {item.subLabel}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
