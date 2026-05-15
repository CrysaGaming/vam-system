'use client';

/**
 * Welle O / O2 — In-profile Twitch live-stream embed.
 *
 * Sits inside the Welle-14C live-stream-card on /pilots/[id]. Default
 * collapsed state shows a "Hier ansehen"-button next to the existing
 * "Watch on Twitch"-external-link; when clicked, swaps in the
 * interactive `player.twitch.tv` iframe so the viewer doesn't leave
 * the profile page to watch.
 *
 * # Why a client-component
 *
 * The iframe needs `parent=<hostname>` query params — without them
 * Twitch blocks the embed with a console error. We compute the parent
 * from `window.location.hostname` at expand-time so the same component
 * works in dev (localhost), staging, prod, and behind cloudflared
 * tunnels without configuration.
 *
 * # Multiple parents
 *
 * Twitch accepts repeated `parent=` params. We pass three by default:
 *
 *   - the actual current hostname (whatever the user is on right now)
 *   - "vam.kevindrack.de" (the canonical prod host)
 *   - "localhost" (so dev-mode embeds work)
 *
 * Adding extras is harmless — Twitch only checks that the request
 * origin matches *one* of the listed parents. If a user opens this on
 * a staging hostname we haven't listed, the runtime-detected one
 * covers them.
 *
 * # Why not unconditionally render the iframe
 *
 * - iframe loads ~1 MB of Twitch player JS just to display
 * - autoplay would surprise users (most browsers block it but a few
 *   honour it for first-party context)
 * - Profiles get visited even when the streamer is offline of-no-
 *   interest — opt-in via click respects user intent
 */

import { useEffect, useState } from 'react';

const ASPECT_RATIO_CSS = { aspectRatio: '16 / 9' };

export function TwitchEmbedToggle({ username }: { username: string }) {
  const [expanded, setExpanded] = useState(false);
  const [parents, setParents] = useState<string[]>([]);

  // Resolve parent list on mount. Doing it in an effect (vs. inline)
  // guarantees we're on the client — `window` doesn't exist during
  // the server render, so an inline read would crash hydration.
  useEffect(() => {
    const host = window.location.hostname;
    const set = new Set<string>([host, 'vam.kevindrack.de', 'localhost']);
    setParents(Array.from(set));
  }, []);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
        aria-label="Twitch-Stream hier im Profil ansehen"
      >
        <span aria-hidden="true">▶</span>
        Hier ansehen
      </button>
    );
  }

  // parents-list resolves on the next tick after mount — until then
  // we render an empty placeholder rather than an iframe with no
  // parents (which Twitch would refuse to load anyway). One-frame
  // delay is invisible to users.
  if (parents.length === 0) {
    return (
      <div
        style={ASPECT_RATIO_CSS}
        className="mt-3 w-full rounded border border-red-500/30 bg-black/50"
        aria-label="Stream wird geladen"
      />
    );
  }

  // Build the iframe src. URLSearchParams correctly URL-encodes the
  // channel + handles the repeated `parent` keys we append manually
  // (URLSearchParams.append vs .set is the key call here — set would
  // overwrite previous parent values).
  const params = new URLSearchParams();
  params.set('channel', username);
  params.set('muted', 'false');
  params.set('autoplay', 'true');
  for (const p of parents) params.append('parent', p);
  const src = `https://player.twitch.tv/?${params.toString()}`;

  return (
    <div className="mt-3 w-full">
      <div
        style={ASPECT_RATIO_CSS}
        className="w-full overflow-hidden rounded border border-red-500/30"
      >
        <iframe
          src={src}
          title={`Twitch-Stream von ${username}`}
          allow="autoplay; fullscreen"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
        <p>
          Spiele direkt über{' '}
          <a
            href={`https://twitch.tv/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-700 hover:underline dark:text-purple-300"
          >
            twitch.tv/{username}
          </a>
          {' '}
          ab. Chat im neuen tab öffnen.
        </p>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Schließen
        </button>
      </div>
    </div>
  );
}
