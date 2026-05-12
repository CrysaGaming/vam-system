'use client';

import { useEffect, useState } from 'react';

/**
 * Track 5 #21 (Section E) — iOS Install-Hint
 *
 * Pendant zu Track 4 #75's PwaInstallPrompt für iOS Safari. Auf iOS feuert
 * `beforeinstallprompt` NIE — Apple unterstützt das W3C-event nicht. iOS-
 * user mussten deshalb bisher selbst rausfinden dass sie "Teilen → Zum
 * Home-Bildschirm" tappen müssen, was niemand entdeckt der nicht weiß
 * dass es geht.
 *
 * # Lifecycle
 *
 * 1. Mount: check ob iOS Safari + nicht-installed + cooldown ok.
 * 2. SHOW_DELAY_MS nach mount (8s, same wie PwaInstallPrompt) → banner zeigen.
 * 3. User tap "Verstanden" oder "✕" → localStorage flag + banner weg.
 * 4. Re-show NIE in der gleichen session; nach DISMISS_COOLDOWN_DAYS wieder
 *    fragen (30 tage, same wie chromium-prompt).
 *
 * # Browser-detection
 *
 *   - iPhone/iPad/iPod im UA → klassisches iOS device
 *   - "Macintosh" + touch-support → iPadOS 13+ (UA spoofs als Mac since 13)
 *   - Safari (kein CriOS=Chrome-iOS, kein FxiOS=Firefox-iOS, kein EdgiOS)
 *
 * Chrome/Firefox/Edge on iOS: alle nutzen WebKit (Apple-mandated), aber
 * ihre eigenen browser-UI haben KEINEN "add to home screen"-knopf. Diese
 * user kriegen den banner explizit NICHT — wäre misleading hint zu zeigen
 * den sie nicht ausführen können.
 *
 * # Standalone-display
 *
 * Wenn die app bereits als installed-PWA läuft (navigator.standalone===true
 * auf iOS legacy, oder display-mode:standalone media-query), wird der
 * hint nicht gezeigt. Sonst doppelte arbeit.
 *
 * # SSR-hydration
 *
 * Komplett client-only (visible=false initial, useEffect liest nav+window
 * post-mount). Server und initial-client-render rendern null → keine
 * hydration-mismatch warnings.
 *
 * # Storage-coordination
 *
 * Eigener storage-key getrennt von PwaInstallPrompt — die zwei flows haben
 * verschiedene browser-targets und sollen unabhängig dismissbar sein.
 * Wenn ein user vom chromium-android zu safari-ipad wechselt sieht er
 * den iOS-hint trotzdem, was richtig ist.
 */

const STORAGE_KEY = 'vam:ios-install-hint-state';
const SHOW_DELAY_MS = 8000; // 8s — match PwaInstallPrompt cadence.
const DISMISS_COOLDOWN_DAYS = 30;

interface StoredState {
  status: 'dismissed';
  at: number;
}

function readStoredState(): StoredState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (parsed.status === 'dismissed' && typeof parsed.at === 'number') {
      return { status: 'dismissed', at: parsed.at };
    }
  } catch {
    // Defensive: corrupted localStorage entry doesn't crash us.
  }
  return null;
}

function writeStoredState(state: StoredState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage könnte voll/disabled sein — kein dealbreaker.
  }
}

function shouldShowHint(stored: StoredState | null): boolean {
  if (!stored) return true;
  const cooldownMs = DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - stored.at > cooldownMs;
}

/**
 * iOS Safari detection. Returns true wenn UA + browser-engine die "Add to
 * Home Screen"-instruction unterstützen würden.
 *
 * Rejected cases:
 *   - Non-iOS device (Android, desktop)
 *   - iOS Chrome (UA enthält CriOS) — kein add-to-home-screen-knopf
 *   - iOS Firefox (UA enthält FxiOS)
 *   - iOS Edge (UA enthält EdgiOS)
 */
function isIosSafari(): boolean {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent;

  // Klassische iOS-geräte
  const isIosDevice = /iPhone|iPad|iPod/i.test(ua);
  // iPadOS 13+: UA spoofs als "Macintosh" aber hat touch-support
  // (kein klassischer mac hat touch — robuster signal als platform).
  const isIpadOnMac =
    ua.includes('Macintosh') && 'ontouchend' in document;
  if (!isIosDevice && !isIpadOnMac) return false;

  // Safari proper: keine non-Safari WebKit-shells (Chrome/Firefox/Edge iOS).
  // Diese browser können kein Add-to-Home-Screen — der hint wäre misleading.
  if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return false;

  // Mindestens "Safari/" muss vorkommen (in-app-webviews wie Twitter haben
  // das nicht und können auch nicht add-to-home-screen).
  return ua.includes('Safari/');
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari: navigator.standalone (legacy, but only iOS path).
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  // Modern fallback: media-query (works on Android-PWA too, harmless here).
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

export function IosInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay()) return; // Bereits als PWA gestartet.
    if (!isIosSafari()) return; // Andere browser/devices → kein hint.
    if (!shouldShowHint(readStoredState())) return; // Im cooldown.

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    writeStoredState({ status: 'dismissed', at: Date.now() });
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="App zum Home-Bildschirm hinzufügen"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xl">
          ✈
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Als App auf dem Home-Bildschirm
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
            Tippe auf das{' '}
            {/* iOS share-icon — SVG inline statt emoji weil das emoji-rendering
                cross-OS inkonsistent ist (Apple share-symbol vs box-mit-pfeil
                auf Android-emoji-fonts). Pure-stroke icon ist eindeutig. */}
            <span
              className="inline-flex items-center justify-center w-5 h-5 align-middle mx-0.5 text-indigo-600 dark:text-indigo-400"
              aria-label="Teilen-Symbol"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-full h-full"
                aria-hidden="true"
              >
                {/* Box-bottom mit pfeil-aus-oben — Apple iOS share-icon shape */}
                <path d="M12 3v12" />
                <path d="m8 7 4-4 4 4" />
                <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
              </svg>
            </span>{' '}
            <span className="font-semibold">Teilen-Symbol</span> unten in der
            Safari-Leiste und wähle{' '}
            <span className="font-semibold">„Zum Home-Bildschirm"</span>.
          </p>
          <p className="text-[10px] text-gray-500 mt-2">
            Vorteil: eigenes app-icon, vollbild ohne adressleiste, schnellerer
            zugriff.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={handleDismiss}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition"
            >
              Verstanden
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
