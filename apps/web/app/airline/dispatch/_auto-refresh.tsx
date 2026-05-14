'use client';

/**
 * Welle L / L4 — Dispatch-page auto-refresh wrapper.
 *
 * Client-component that periodically calls router.refresh() to keep the
 * dispatch-board fresh. Refresh every 30s while the tab is visible.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AutoRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, router]);

  return null;
}
