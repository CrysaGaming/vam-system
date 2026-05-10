'use client';

import { useEffect } from 'react';

/**
 * Track 4 #50 (Section J) — Global Error Boundary.
 *
 * Catch-all für errors die SOGAR im root-layout selbst crashen (auth-
 * fetch crash, theme-provider exception, prisma-client init failure).
 * `error.tsx` würde diese nicht erreichen weil das innerhalb des layouts
 * rendert — global-error.tsx ist parallel zum layout und ersetzt es
 * komplett wenn was kaputt geht.
 *
 * # Constraints (next.js docs)
 *
 *   - MUSS `<html>` + `<body>` selbst rendern (kein layout-shell verfügbar)
 *   - MUSS client-component sein (useEffect, onClick)
 *   - Sollte keine fancy fonts/css importieren — could itself crash
 *
 * Daher: inline-styles + minimal markup. Wenn das hier crasht, ist
 * der user buchstäblich auf dem white-screen-of-death.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[Global-Error]', error);
  }, [error]);

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          backgroundColor: '#0a0a0a',
          color: '#e5e5e5',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '480px', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🔥</div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0' }}>
            Kritischer Fehler
          </h1>
          <p style={{ fontSize: '14px', color: '#a3a3a3', margin: '0 0 24px 0' }}>
            Die Anwendung konnte nicht geladen werden. Bitte lade die Seite neu.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: '12px',
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                color: '#525252',
                margin: '0 0 24px 0',
              }}
            >
              Fehler-ID: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Neu laden
          </button>
        </div>
      </body>
    </html>
  );
}
