'use client';

/**
 * Welle O / O1 — Twitch disconnect-confirm button.
 *
 * Why a JS-driven confirm rather than reuse the plain <form> pattern
 * from /settings/ConnectionCard:
 *
 * - The streaming-hub page is a dedicated surface; a casual click on
 *   "Trennen" should *not* immediately revoke the OAuth-token + clear
 *   the link. A `confirm()` step matches the seriousness of "this
 *   stops all live-counter activity + STREAM_REWARDs until you re-
 *   connect".
 *
 * - The plain <form action="POST"> works without JS but submits
 *   silently; user gets no "are you sure" check. The connection-card
 *   on the overview is meant for accidental "I shouldn't have linked
 *   that account" moments where speed beats caution; this hub-page
 *   has the inverse trade-off.
 *
 * After confirm, we still POST to /api/auth/twitch/disconnect — same
 * server-side path, same revoke-at-Twitch behaviour. Difference is
 * purely UX-side.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function DisconnectButton({ username }: { username: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function disconnect() {
    if (
      !confirm(
        `Twitch-konto "${username}" wirklich trennen?\n\n` +
          `- Live-counter zeigt dich nicht mehr als live\n` +
          `- STREAM_REWARDs stoppen sofort\n` +
          `- Access-token wird bei Twitch revoked\n\n` +
          `Du kannst dich danach jederzeit wieder verbinden.`,
      )
    ) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/twitch/disconnect', {
        method: 'POST',
        credentials: 'same-origin',
      });

      // Disconnect-route macht intern entweder redirect() (=302) oder
      // returnt OK. Beide sind erfolg — wir checken nur auf
      // server-error (5xx) und ignorieren den rest.
      if (res.ok || res.status === 302) {
        router.refresh();
      } else {
        setError(`Disconnect fehlgeschlagen: HTTP ${res.status}`);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={disconnect}
        disabled={isPending}
        className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
      >
        {isPending ? '…' : 'Trennen'}
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
