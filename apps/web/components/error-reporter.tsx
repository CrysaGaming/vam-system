'use client';

import { useEffect, useRef } from 'react';

/**
 * Track 4 #103 (Section T) — Client-Error-Reporter.
 *
 * Globaler error-listener für unhandled exceptions + promise-rejections.
 * Postet to /api/errors mit dedup-via-hash damit ein crash-loop nicht
 * 100×/s den server flutet (defense-in-depth zum server-side rate-limit).
 *
 * # Mounting
 *
 * Sollte einmal im root-layout sitzen. Component rendert NICHTS — pure
 * side-effect ("install listeners"). Auf jeder page aktiv.
 *
 * # Dedup-strategie
 *
 * Per-message+url-hash, 60s window. Verhindert dass derselbe error
 * (z.b. ein react-render-loop) wiederholt gepostet wird. Hash ist
 * ein simpler djb2 — wir brauchen kein crypto, nur identification.
 *
 * # React render-errors
 *
 * Werden NICHT von window.onerror gefangen wenn Next.js' eigene
 * error-overlay/boundary aktiv ist. Für die haben wir das separate
 * <ClientErrorBoundary> in einem follow-up — V1 dieser welle fängt
 * window.onerror (script-errors, manuelle throws aus event-handlers)
 * + unhandledrejection (failed fetches, promise rejections).
 */

interface PendingErrorPayload {
  url: string;
  message: string;
  stack: string | null;
  occurredAt: string;
  context: Record<string, unknown>;
}

function djb2Hash(input: string): string {
  // Simple non-crypto hash für dedup-keys. Kollisionen sind OK weil
  // wir nur identification innerhalb eines 60s-windows brauchen.
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // toString(36) für kurze keys (length matters für Map-memory).
  return (h >>> 0).toString(36);
}

const DEDUP_WINDOW_MS = 60_000;
const CLIENT_MAX_PER_MINUTE = 20; // hard-cap auch wenn dedup nicht greift

async function postError(payload: PendingErrorPayload): Promise<void> {
  // navigator.sendBeacon wäre besser für tab-unload-szenarien (kein
  // pending-fetch-abort), aber sendBeacon kann keinen 429-response
  // lesen — wir würden also blind weiter-fluten wenn server rate-limit
  // greift. Fetch mit keepalive ist der bessere kompromiss: bei page-
  // close hält's noch, bei rate-limit kriegen wir's mit.
  try {
    await fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // keepalive: fetch survives tab-close für bis zu 64KB body
      keepalive: true,
      // credentials für session-cookie damit userId-resolution serverseitig klappt
      credentials: 'same-origin',
    });
  } catch {
    // Network-fehler beim error-reporting → silent ignore. Wenn wir hier
    // throwen oder console.error() machen, läufts in den eigenen handler
    // und triggert eine neue endless-loop.
  }
}

export function ErrorReporter() {
  const dedupRef = useRef<Map<string, number>>(new Map());
  const recentPostsRef = useRef<number[]>([]);

  useEffect(() => {
    function shouldReport(hash: string): boolean {
      const now = Date.now();

      // Client-side throttle: max 20 reports per 60s window. Sliding window
      // via array von timestamps. Defense-in-depth zum server-rate-limit.
      const recent = recentPostsRef.current;
      const cutoff = now - DEDUP_WINDOW_MS;
      while (recent.length && recent[0]! < cutoff) recent.shift();
      if (recent.length >= CLIENT_MAX_PER_MINUTE) return false;

      // Per-hash-dedup
      const dedup = dedupRef.current;
      const lastSent = dedup.get(hash);
      if (lastSent && now - lastSent < DEDUP_WINDOW_MS) return false;

      // Map-cleanup: gelegentlich stale entries entfernen
      if (dedup.size > 100) {
        for (const [key, ts] of dedup) {
          if (now - ts > DEDUP_WINDOW_MS) dedup.delete(key);
        }
      }

      dedup.set(hash, now);
      recent.push(now);
      return true;
    }

    function handleError(event: ErrorEvent) {
      const message = event.message || 'Unknown error';
      const url = window.location.href;
      const stack = event.error?.stack ?? null;
      const hash = djb2Hash(message + '|' + url);
      if (!shouldReport(hash)) return;

      void postError({
        url,
        message,
        stack,
        occurredAt: new Date().toISOString(),
        context: {
          source: 'window.onerror',
          // ErrorEvent-felder die nützlich sein können für source-map-lookup
          fileName: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
          // navigator-info im error-context (server kann user-agent aus header,
          // aber language/platform sind nur clientseitig sichtbar)
          language: navigator.language,
          platform: navigator.platform,
        },
      });
    }

    function handleRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      // reason kann alles sein — Error-instanz, string, object. Normalisieren.
      let message: string;
      let stack: string | null = null;
      if (reason instanceof Error) {
        message = reason.message || reason.name || 'Unhandled rejection';
        stack = reason.stack ?? null;
      } else if (typeof reason === 'string') {
        message = reason;
      } else {
        try {
          message = JSON.stringify(reason).slice(0, 500);
        } catch {
          message = '<unserializable rejection reason>';
        }
      }

      const url = window.location.href;
      const hash = djb2Hash(message + '|' + url);
      if (!shouldReport(hash)) return;

      void postError({
        url,
        message,
        stack,
        occurredAt: new Date().toISOString(),
        context: {
          source: 'unhandledrejection',
          language: navigator.language,
          platform: navigator.platform,
        },
      });
    }

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}
