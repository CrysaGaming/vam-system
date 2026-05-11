'use client';

import { useEffect } from 'react';
import { appendRecentItem, type RecentItemType } from '@/lib/recently-viewed';

/**
 * Track 4 #71 (Section N) — Recent-Item-Tracker
 *
 * Mounted auf einer detail-page (booking/PIREP/route). Beim ersten render
 * schreibt es die page als "recently viewed" in den localStorage. Renders
 * nichts visuell — pure-side-effect-component.
 *
 * # Mount-policy
 *
 * Wir tracken NUR beim mount (initial render), nicht bei prop-changes.
 * Wenn der user innerhalb derselben booking zwischen tabs hin- und
 * herwechselt (z.B. via search-params), führt das NICHT zu mehrfachen
 * appends — der useEffect feuert nur einmal pro mount.
 *
 * Das ist intentional: die liste soll wirkliche page-views tracken, nicht
 * client-side-state-changes. Wenn der user die page verlässt und zurück-
 * kommt → neuer mount → neuer append (LRU-dedup im storage sorgt für die
 * korrekte reihenfolge).
 *
 * # Props
 *
 * `id`, `type`, `label`, `href` werden vom server-component übergeben.
 * Optional `subLabel` für zusätzlichen kontext (z.B. "13.05.2026 14:30").
 *
 * # Wann nicht mounten
 *
 * - Auf list-pages (NUR auf detail-pages).
 * - Wenn das item geringe wiederbesuchs-wahrscheinlichkeit hat (z.B.
 *   eine generic settings-page).
 * - Wenn der user nicht eingeloggt ist — der app-shell rendert dann
 *   eh nichts, daher passiert kein mount.
 */
interface RecentItemTrackerProps {
  id: string;
  type: RecentItemType;
  label: string;
  href: string;
  subLabel?: string;
}

export function RecentItemTracker({
  id,
  type,
  label,
  href,
  subLabel,
}: RecentItemTrackerProps) {
  useEffect(() => {
    appendRecentItem({ id, type, label, href, subLabel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — siehe doc-string

  return null;
}
