'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track 4 #78 (Section O) — Pull-to-Refresh
 *
 * Native-mobile-gesture: ziehen vom oberen rand der scroll-area nach unten
 * triggert ein router.refresh() (= server-component re-fetch). Standard auf
 * iOS/Android-apps, fehlte aber in der web-version — mobile-user hatten
 * nur F5 (mit browser-chrome) oder pull-to-refresh des BROWSERS (das die
 * ganze page reloaded, nicht nur die data).
 *
 * # Mechanik
 *
 * 1. touchstart: notieren wir startY UND scrollTop des main-scroll-wrappers
 *    (#main-content aus AppShell). Wenn scrollTop > 0, ist der user IN der
 *    content drin, kein pull-to-refresh — wir setzen disabled-flag.
 * 2. touchmove: deltaY = currentY - startY. Wenn deltaY > 0 (nach unten
 *    ziehen) UND nicht disabled UND scrollTop noch 0 (defensive recheck):
 *    update visible distance + zeige indicator. Wir cappen die distance
 *    bei MAX_PULL_PX damit der user nicht meterweise ziehen kann.
 * 3. touchend: wenn distance >= THRESHOLD_PX → trigger refresh + zeige
 *    spinner. Sonst → animate back zu 0 + hide indicator.
 *
 * # Warum keine library
 *
 * react-pull-to-refresh + alternatives sind ~5kb bundle für eine geste die
 * sich in ~150 LoC schreibt. Library hätte zusätzlich opinions zu indicator-
 * design die wir hier mit existing tailwind-styles cleaner integrieren.
 *
 * # Touch-only
 *
 * Wir attachen NUR touch-handlers, kein mouse. Desktop hat F5 für refresh —
 * mouse-drag-to-refresh wäre verwirrend (klicken-und-ziehen hat auf desktop
 * 100 andere bedeutungen wie text-select, drag-and-drop).
 *
 * # Refresh-mechanik
 *
 * router.refresh() ist Next.js' weg um die aktuelle route neu zu rendern
 * OHNE full reload — re-fetched alle RSC-data, behält client-state. Genau
 * was pull-to-refresh klassisch macht. Wir wrappen es in startTransition
 * damit der pending-state für unseren spinner verfügbar ist.
 *
 * # Edge: nicht-scrollable pages
 *
 * Wenn die page so wenig content hat dass nichts scrollbar ist, ist
 * scrollTop dauerhaft 0 — der user kann unabsichtlich beim normalen
 * touch-down einen kleinen pull-down auslösen. Wir verhindern das mit
 * einem PULL_START_THRESHOLD: erst nach mindestens 10px erkennen wir's
 * als pull-gesture. Vor den 10px ist's noch ein normaler scroll/tap.
 */

const THRESHOLD_PX = 80; // Distance bei der refresh getriggert wird.
const MAX_PULL_PX = 120; // Maximaler visueller pull-distance (cap).
const PULL_START_THRESHOLD = 10; // Min-deltaY bevor wir's als pull anerkennen.

export function PullToRefresh() {
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Refs für touch-state. Nicht in useState weil's nicht-rendering-data ist
  // und touchmove im hot-path mehrfach pro sekunde fired — kein point ihn
  // durch ein react-render zu schicken.
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);
  const disabledRef = useRef(false);

  // Ref-mirrors für state. Closure in useEffect-attached handlers würde
  // sonst stale-state sehen (handler attached once mit isRefreshing=false,
  // bleibt für immer false aus closure-sicht). Wir mirroren auf refs damit
  // touchmove den aktuellsten state liest ohne re-attach.
  const pullDistanceRef = useRef(pullDistance);
  const isRefreshingRef = useRef(isRefreshing);
  pullDistanceRef.current = pullDistance;
  isRefreshingRef.current = isRefreshing;

  useEffect(() => {
    // Touch-detection: wir attachen den listener nur wenn das gerät
    // touch-events supportet. Desktop-browsers fehlen die events,
    // listener-attach würde zwar nicht crashen aber wir vermeiden den
    // overhead. matchMedia('(pointer: coarse)') = touch-primary.
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    const scrollEl = document.getElementById('main-content');
    if (!scrollEl) return;

    function handleTouchStart(e: TouchEvent) {
      if (!scrollEl) return;
      // Nicht starten wenn ein refresh läuft — sonst kann der user mid-
      // refresh einen zweiten triggern.
      if (isRefreshingRef.current) {
        disabledRef.current = true;
        return;
      }
      // Nur am top der scroll-area triggert pull-to-refresh. Wenn user
      // schon nach unten gescrollt hat, ist ein down-swipe ein normales
      // scroll-up-gesture, nicht refresh.
      if (scrollEl.scrollTop > 0) {
        disabledRef.current = true;
        return;
      }
      disabledRef.current = false;
      startYRef.current = e.touches[0].clientY;
      isPullingRef.current = false;
    }

    function handleTouchMove(e: TouchEvent) {
      if (disabledRef.current || isRefreshingRef.current) return;
      if (!scrollEl) return;

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - startYRef.current;

      // Negative deltaY = swipe up = normales scroll, kein pull.
      if (deltaY <= 0) {
        if (isPullingRef.current) {
          isPullingRef.current = false;
          setPullDistance(0);
        }
        return;
      }

      // Recheck scrollTop — wenn der user inzwischen scroll-state geändert
      // hat (e.g. inertia-scroll), ist der pull invalid.
      if (scrollEl.scrollTop > 0) {
        disabledRef.current = true;
        if (isPullingRef.current) {
          isPullingRef.current = false;
          setPullDistance(0);
        }
        return;
      }

      // Erst nach PULL_START_THRESHOLD erkennen wir's als pull-gesture.
      // Davor ist's nicht-eindeutig (kann ein versehentlicher microswipe sein).
      if (deltaY < PULL_START_THRESHOLD) return;

      isPullingRef.current = true;

      // Resistance-curve: erste 60px folgen 1:1, danach immer langsamer
      // (asymptotisch zu MAX_PULL_PX). Gibt's haptisches feedback "ich
      // kann ziehen, aber nicht endlos". Klassisches iOS-pattern.
      const adjusted = deltaY < 60 ? deltaY : 60 + (deltaY - 60) * 0.4;
      const capped = Math.min(MAX_PULL_PX, adjusted);
      setPullDistance(capped);

      // preventDefault auf touch-move stoppt das native overscroll-bounce
      // auf iOS. Wir wollen das hier, weil wir unser eigenes "elastic"
      // verhalten zeigen. Browser werfen warnings wenn passive: true ist
      // (default für touch-events seit Chrome 56), daher attachen wir
      // den listener mit { passive: false } unten.
      e.preventDefault();
    }

    function handleTouchEnd() {
      if (!isPullingRef.current) {
        setPullDistance(0);
        return;
      }
      isPullingRef.current = false;

      // Threshold erreicht → trigger refresh.
      if (pullDistanceRef.current >= THRESHOLD_PX) {
        setIsRefreshing(true);
        setPullDistance(THRESHOLD_PX); // Halten in spinner-position während refresh.
        router.refresh();
        // router.refresh() ist sync zum aufruf aber RSC re-fetch passiert
        // async. Wir setzen einen timer als "spinner-min-display-zeit"
        // damit der user den feedback-tick sieht. Reale refresh-zeit ist
        // typisch 100-500ms — sub-300ms-feedback würde flackern.
        window.setTimeout(() => {
          setIsRefreshing(false);
          setPullDistance(0);
        }, 600);
      } else {
        // Nicht weit genug gezogen — animate back zu 0 via state-change.
        // CSS transition macht die animation visuell.
        setPullDistance(0);
      }
    }

    // Wir brauchen { passive: false } für touchmove damit preventDefault()
    // greift. Andere events sind passive=true (default, performanter).
    scrollEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    scrollEl.addEventListener('touchend', handleTouchEnd, { passive: true });
    scrollEl.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      scrollEl.removeEventListener('touchstart', handleTouchStart);
      scrollEl.removeEventListener('touchmove', handleTouchMove);
      scrollEl.removeEventListener('touchend', handleTouchEnd);
      scrollEl.removeEventListener('touchcancel', handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Indicator only rendern wenn pull aktiv ODER refresh läuft. Performance-
  // optimization: kein DOM-overhead in idle-state.
  if (pullDistance === 0 && !isRefreshing) return null;

  // Opacity + scale basieren auf pull-distance:
  //   - 0..THRESHOLD: scale 0.5 → 1.0, opacity 0.4 → 1.0
  //   - THRESHOLD+: stay at 1.0/1.0
  // Gibt dem user visual progress feedback ("noch mehr ziehen!").
  const progress = Math.min(1, pullDistance / THRESHOLD_PX);
  const scale = 0.5 + progress * 0.5;
  const opacity = 0.4 + progress * 0.6;

  // Position: translateY anhand pull-distance damit der spinner mit dem
  // finger mitgeht. Bei refresh: festgepinnt auf THRESHOLD_PX (nicht
  // weiter sinkend).
  const translateY = pullDistance;

  return (
    <div
      aria-hidden="true"
      style={{
        transform: `translate(-50%, ${translateY}px)`,
        opacity,
      }}
      // Smooth-transition NUR wenn nicht actively pulling — bei pull soll
      // der spinner pixel-perfekt am finger kleben. Bei release+animate-back
      // soll's geschmeidig zurückfedern.
      className={`fixed left-1/2 -translate-x-1/2 top-0 z-40 pointer-events-none ${
        isPullingRef.current ? '' : 'transition-all duration-300 ease-out'
      }`}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full p-2 shadow-lg"
        style={{ transform: `scale(${scale})` }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-6 h-6 text-indigo-600 dark:text-indigo-400 ${
            isRefreshing ? 'animate-spin' : ''
          }`}
        >
          {isRefreshing ? (
            // Spinner: partial circle die animate-spinned.
            <>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </>
          ) : (
            // Arrow-down icon das sich mit progress rotated. Bei threshold
            // (progress=1) zeigt's nach unten = "release to refresh".
            <>
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
