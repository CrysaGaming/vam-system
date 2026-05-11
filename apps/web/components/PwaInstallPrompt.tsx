'use client';

import { useEffect, useState } from 'react';

/**
 * Track 4 #75 (Section O) — PWA Install-Prompt
 *
 * Custom in-app install-prompt der den browser-default ersetzt. Chrome/Edge
 * blenden ihren eigenen "App installieren"-banner nur 1x pro origin ein
 * und ohne klaren timing-trigger — viele user sehen ihn nie. Mit einem
 * in-app prompt unter unserer kontrolle können wir den moment wählen
 * (z.B. nach erster session, nicht beim ersten besuch) und das design
 * an die app anpassen.
 *
 * # Lifecycle
 *
 * 1. Browser fired `beforeinstallprompt` wenn PWA-criteria erfüllt sind
 *    (manifest + icons + scope + over-HTTPS + nicht bereits installed).
 *    Chromium fired das nur 1x — danach NIE wieder bis user cookies/site-
 *    data clear. Wir müssen das event stashen damit wir später prompt()
 *    aufrufen können.
 * 2. Wir warten min. INSTALL_PROMPT_DELAY_MS bevor wir den banner zeigen
 *    damit der user die app erstmal nutzen kann statt sofort mit einem
 *    "installieren"-dialog konfrontiert zu werden.
 * 3. Klick auf "Installieren" → prompt() → user choice (accepted/dismissed).
 * 4. Klick auf "Später" oder accepted/dismissed → flag im localStorage.
 *    Re-show NIE in der gleichen session, und nur nach 30 tagen wenn
 *    dismissed (siehe DISMISS_COOLDOWN_DAYS).
 *
 * # Display-mode detection
 *
 * Wenn die app bereits als installed PWA läuft (display-mode: standalone),
 * wird der prompt nicht gezeigt. Andernfalls wäre der banner doppelte
 * arbeit.
 *
 * # Browser-support
 *
 * Chrome/Edge/Brave/Samsung: beforeinstallprompt + prompt() funktioniert.
 * Firefox: kein support (wird also nie ein prompt zeigen). Safari/iOS:
 * kein beforeinstallprompt — der user muss manuell "Zum Home-Bildschirm
 * hinzufügen" wählen. Für iOS könnten wir später einen separaten hint
 * mit instructions zeigen, das ist out-of-scope für #75.
 */

const STORAGE_KEY = 'vam:pwa-install-prompt-state';
const INSTALL_PROMPT_DELAY_MS = 8000; // 8s nach mount damit der user erst die page sieht.
const DISMISS_COOLDOWN_DAYS = 30; // Nach "Später"-klick erst nach 30 tagen wieder fragen.

interface StoredState {
  /** Letzte aktion: 'dismissed' (user klickte Später), 'installed' (user akzeptierte). */
  status: 'dismissed' | 'installed';
  /** ms-timestamp der letzten aktion. */
  at: number;
}

// BeforeInstallPromptEvent ist nicht im standard-typedef. Minimaler shape
// für unsere zwecke.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function readStoredState(): StoredState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (
      (parsed.status === 'dismissed' || parsed.status === 'installed') &&
      typeof parsed.at === 'number'
    ) {
      return { status: parsed.status, at: parsed.at };
    }
  } catch {
    // ignore — kaputter localStorage-eintrag soll uns nicht crashen.
  }
  return null;
}

function writeStoredState(state: StoredState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage könnte voll/disabled sein — kein dealbreaker, der user
    // sieht den prompt halt diese session nochmal aber das ist akzeptabel.
  }
}

function shouldShowPrompt(stored: StoredState | null): boolean {
  if (!stored) return true;
  if (stored.status === 'installed') return false; // Bereits installiert.
  // Dismissed → erst nach cooldown wieder fragen.
  const cooldownMs = DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - stored.at > cooldownMs;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari: navigator.standalone (legacy). Andere: matchMedia.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Bereits als installed-app gestartet → kein prompt.
    if (isStandaloneDisplay()) return;
    // localStorage policy → check ob wir prompt zeigen dürfen.
    if (!shouldShowPrompt(readStoredState())) return;

    // beforeinstallprompt-handler: stash event + start visibility-timer.
    // Das event wird vom browser nur 1x gefired pro session-startup
    // (manchmal direkt nach pageload, manchmal nach kurzem delay).
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault(); // Chrome's default-banner unterdrücken.
      const event = e as BeforeInstallPromptEvent;
      setDeferredPrompt(event);
      // Visibility-timer: nicht sofort zeigen, der user soll erst die app
      // sehen können. Setzen wir den timer in einem inner useEffect-callback
      // wäre eleganter, aber das würde re-fire bei jedem state-change.
      // Direkt hier reicht.
      window.setTimeout(() => setVisible(true), INSTALL_PROMPT_DELAY_MS);
    };

    // appinstalled-handler: user hat irgendwo (auch via browser-menu)
    // installiert. Lokal speichern damit wir den prompt nicht mehr zeigen.
    const handleAppInstalled = () => {
      writeStoredState({ status: 'installed', at: Date.now() });
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setVisible(false); // Banner schon ausblenden während der dialog läuft.
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      writeStoredState({
        status: outcome === 'accepted' ? 'installed' : 'dismissed',
        at: Date.now(),
      });
    } catch {
      // prompt() kann throwen wenn der browser den prompt nicht mehr akzeptiert
      // (z.B. weil prompt() schon einmal aufgerufen wurde). Wir treaten das
      // wie dismissed damit der user nicht in einer endlosschleife landet.
      writeStoredState({ status: 'dismissed', at: Date.now() });
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    writeStoredState({ status: 'dismissed', at: Date.now() });
    // deferredPrompt behalten wir noch — der browser ließ uns 1x prompt()
    // aufrufen, falls der user später doch klicken will (button in den
    // settings z.B.). Aber visibility ist gone bis next session.
  };

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      role="dialog"
      aria-label="App installieren"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xl">
          ✈
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            App installieren
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            VAM System als App installieren — schneller zugriff, offline-
            fähig, eigenes icon auf dem home-screen.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={handleInstall}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition"
            >
              Installieren
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded transition"
            >
              Später
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Schließen"
          className="flex-shrink-0 -mt-1 -mr-1 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
