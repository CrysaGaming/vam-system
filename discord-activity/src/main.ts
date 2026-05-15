/**
 * Welle N / N5 — Discord Activity main entry.
 *
 * # What this does
 *
 * Runs inside Discord's activity iframe (started from a voice channel's
 * "Activities" launcher). On first launch, asks the user to paste their
 * VAM embed-token. After that, polls /api/embed/state/[token] every 8s
 * and renders ALT/GS/HDG/route. The displayed flight is whatever VAM
 * pilot owns the token — typically the user themselves.
 *
 * # Discord SDK
 *
 * `@discord/embedded-app-sdk` provides the iframe ↔ Discord runtime
 * bridge. For this minimal mini-app we use:
 *   - `discord.ready()` so Discord knows we've initialized and removes
 *     the loading-spinner overlay.
 *   - Nothing else. We don't need OAuth, voice state, channel info,
 *     or RPC events for v1 — the embed-token is the credential, and
 *     all data comes from the VAM server.
 *
 * # Token storage
 *
 * `localStorage.setItem('vam-embed-token', '...')`. Discord activities
 * get their own origin per Application-ID, so this is sandboxed from
 * other websites' localStorage. The pasted token is only the user's
 * own VAM embed-token — it never leaves their browser except in the
 * GET request to the VAM server.
 *
 * # Why not Discord OAuth → server-side lookup
 *
 * That would require:
 *   1. Adding a Discord OAuth flow in the Discord Developer Portal
 *   2. A server-side endpoint that maps Discord-user-IDs to VAM users
 *   3. Sync between User.discordId and the activity's runtime
 *
 * All doable, but v1's "paste your token" UX is simpler and keeps the
 * activity decoupled from the existing User.discordId column (which is
 * for bot-mentions, not activity-auth). V2 can add OAuth-glue.
 */

import { DiscordSDK } from '@discord/embedded-app-sdk';

// Replace this with the activity's Application ID from the Discord
// Developer Portal. The current placeholder will fail discord.ready()
// in production — this is intentional, it forces the consumer to
// register their own activity rather than ship a hard-coded one.
const DISCORD_CLIENT_ID = 'REPLACE_WITH_YOUR_DISCORD_APP_ID';

const VAM_BASE_URL = 'https://vam.kevindrack.de';
const STORAGE_KEY = 'vam-embed-token';
const POLL_INTERVAL_MS = 8_000;
const STALE_THRESHOLD_S = 30;

type EmbedResponse = {
  t: string;
  session: {
    callsign: string;
    alt: number;
    gs: number;
    hdg: number;
    dep: string | null;
    arr: string | null;
    onGnd: boolean;
    hbAge: number | null;
  } | null;
};

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let currentToken: string | null = null;

// ─────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  // Tell Discord we're alive. In dev (running outside Discord), this
  // will throw — we catch and continue so `npm run dev` works locally.
  try {
    const discord = new DiscordSDK(DISCORD_CLIENT_ID);
    await discord.ready();
  } catch (err) {
    // Likely "not running inside a Discord activity" — fine for dev.
    console.warn('[VAM Activity] Discord SDK init skipped:', err);
  }

  currentToken = localStorage.getItem(STORAGE_KEY);

  if (!currentToken) {
    showSetup();
  } else {
    startPolling(currentToken);
  }
}

// ─────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────

function showSetup(): void {
  hideAll();
  const view = document.getElementById('setup-view')!;
  view.hidden = false;

  const input = document.getElementById('token-input') as HTMLInputElement;
  const saveBtn = document.getElementById('save-token')!;
  saveBtn.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value.startsWith('vame_')) {
      alert('Token must start with "vame_". Get one at /settings/embeds.');
      return;
    }
    localStorage.setItem(STORAGE_KEY, value);
    currentToken = value;
    startPolling(value);
  });
}

function showEmpty(): void {
  hideAll();
  document.getElementById('empty-view')!.hidden = false;
}

function showFlight(): void {
  hideAll();
  document.getElementById('flight-view')!.hidden = false;
}

function hideAll(): void {
  for (const id of ['setup-view', 'flight-view', 'empty-view']) {
    document.getElementById(id)!.hidden = true;
  }
}

// ─────────────────────────────────────────────────────────
// Polling
// ─────────────────────────────────────────────────────────

function startPolling(token: string): void {
  // Immediate first fetch, then on interval
  void poll(token);
}

async function poll(token: string): Promise<void> {
  try {
    const res = await fetch(`${VAM_BASE_URL}/api/embed/state/${token}`, {
      cache: 'no-store',
    });
    if (res.status === 401) {
      // Token revoked / invalid — back to setup
      localStorage.removeItem(STORAGE_KEY);
      currentToken = null;
      showSetup();
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as EmbedResponse;
      render(data);
    }
  } catch (err) {
    console.warn('[VAM Activity] poll failed:', err);
    // Keep last-rendered view; next tick will retry
  } finally {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void poll(token), POLL_INTERVAL_MS);
  }
}

// ─────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────

function render(data: EmbedResponse): void {
  if (!data.session) {
    showEmpty();
    return;
  }

  showFlight();
  const s = data.session;

  const stale =
    s.hbAge === null ||
    s.hbAge === undefined ||
    s.hbAge > STALE_THRESHOLD_S;

  setText('callsign', s.callsign);
  setText('gs-value', String(s.gs));
  setText('hdg-value', String(s.hdg).padStart(3, '0'));

  const altLabel = s.alt >= 18000 ? `FL${Math.round(s.alt / 100)}` : String(s.alt);
  const altUnit = s.alt >= 18000 ? '' : 'ft';
  setText('alt-value', altLabel);
  setText('alt-unit', altUnit);

  const route =
    s.dep && s.arr ? `${s.dep} → ${s.arr}` : s.dep ?? s.arr ?? '—';
  setText('route', route);

  const dot = document.getElementById('hb-dot')!;
  dot.classList.toggle('stale', stale);

  const chip = document.getElementById('stale-chip')!;
  chip.hidden = !stale;

  document.body.classList.toggle('dim', stale);
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─────────────────────────────────────────────────────────

void boot();
