'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Theme-mode: was der user EXPLIZIT gewählt hat. 'system' = "folge dem
 * OS/browser-prefers-color-scheme". Der gerendert klassen-state (dark
 * oder nicht-dark) wird daraus separat ableitet — siehe `resolvedTheme`.
 */
type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Effektiv aktive farbe. 'system' wird hier zu light oder dark resolved
 * basierend auf dem aktuellen prefers-color-scheme.
 */
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** Was der user explizit gewählt hat — light, dark oder system. */
  mode: ThemeMode;
  /**
   * Was tatsächlich gerendert wird (system → light oder dark resolved).
   * Wenn mode='system' und das OS dark-mode hat, ist resolved='dark'.
   * Sehr handy für UI die wissen muss "ist es grade visuell dunkel?"
   * (icons, charts, etc.) ohne sich um den system-vs-explicit-state
   * kümmern zu müssen.
   */
  resolvedTheme: ResolvedTheme;
  /** Setzt mode + persistiert + applied class. */
  setMode: (mode: ThemeMode) => void;
  /**
   * Zykliert durch light → dark → system → light. Convenience für den
   * standard-toggle-button. Wer mehr control braucht, nutzt setMode direkt.
   */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'theme';

/**
 * Theme provider — Track 3 #11.2.4 Phase 1.5 (3-state-erweiterung).
 *
 * # Was war vorher
 *
 * Theme war strikt 'light' | 'dark', toggle war ein 2-state-flip.
 * Das pre-hydration-script hat localStorage gelesen ODER auf
 * prefers-color-scheme gefallen — aber sobald der user EINMAL geklickt
 * hatte, war localStorage gesetzt und prefers-color-scheme wurde nie
 * wieder konsultiert. Heißt: wenn der user "light" bei tag wollte und
 * "dark" bei nacht (auto via OS), gab's keinen weg — er musste manuell
 * cyclen.
 *
 * # Was jetzt
 *
 * Drei-state-mode 'light' | 'dark' | 'system'. system fragt das OS via
 * window.matchMedia('(prefers-color-scheme: dark)'). Wenn das OS-pref
 * sich ändert (user wechselt OS-theme während die app offen ist), folgt
 * die app automatisch — ein matchMedia-listener macht das live.
 *
 * # Default-state
 *
 * 'system'. Das ist der respect-the-user-default. Erst wenn der user
 * explizit auf den toggle klickt, wechseln wir zu light oder dark.
 *
 * # SSR / hydration
 *
 * Das pre-hydration-script (themeInitScript) läuft synchron VOR der
 * react-hydration und setzt die .dark-class basierend auf:
 *   1) localStorage 'theme' wenn 'light' → keine .dark
 *   2) localStorage 'theme' wenn 'dark' → .dark
 *   3) localStorage 'theme' wenn 'system' (oder absent) → matchMedia-prüfung
 *
 * Damit ist der erste paint visuell korrekt — kein FOUC. Der React-state
 * wird in useEffect nach mount aus localStorage + matchMedia syncronisiert.
 *
 * # SSR-default für mode-state
 *
 * 'system' weil das der app-default ist. Wenn der user vorher 'dark'
 * gewählt hatte, zeigt das toggle-icon kurz das system-icon bevor
 * useEffect rebsynced. Das ist ein UX-detail (kein visueller flicker
 * weil resolvedTheme erst NACH mount für icon-rendering benutzt wird —
 * vorher rendern wir einen placeholder).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR-default ist 'system' — siehe oben.
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');

  // Mount-effect: lese gespeicherten mode + sync resolvedTheme von der
  // tatsächlichen .dark-class (das pre-hydration-script hat sie schon
  // gesetzt, also ist sie source-of-truth fürs initial-rendering).
  useEffect(() => {
    let storedMode: ThemeMode = 'system';
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') {
        storedMode = v;
      }
    } catch {
      // localStorage unavailable (private mode etc.) — fall back zu default
    }
    setModeState(storedMode);

    const isDark = document.documentElement.classList.contains('dark');
    setResolvedTheme(isDark ? 'dark' : 'light');
  }, []);

  // Auto-follow OS-pref wenn mode === 'system'. matchMedia-listener
  // feuert wann immer der user sein OS-theme ändert.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const next: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolvedTheme(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
    };
    // Sync initial state when entering system-mode (kann sein dass der
    // user grade von 'dark' auf 'system' gewechselt hat und das OS
    // gerade auf light steht — dann müssen wir die class entfernen).
    const initial: ResolvedTheme = mq.matches ? 'dark' : 'light';
    if (initial !== resolvedTheme) {
      setResolvedTheme(initial);
      document.documentElement.classList.toggle('dark', initial === 'dark');
    }
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // siehe oben — silently degrade, mode bleibt für die session aktiv
      // aber persistiert nicht
    }

    // Wende die class-änderung sofort an. Bei 'system' fragen wir
    // matchMedia direkt — bei light/dark ist der state explizit.
    let nextResolved: ResolvedTheme;
    if (next === 'system') {
      nextResolved = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } else {
      nextResolved = next;
    }
    setResolvedTheme(nextResolved);
    document.documentElement.classList.toggle('dark', nextResolved === 'dark');
  };

  const cycle = () => {
    // light → dark → system → light. system als endpunkt nach den zwei
    // explicit-modes weil das die "ich will mich darum nicht kümmern"-
    // option ist — der user landet dort wenn er drei mal klickt und
    // sich's anders überlegt hat.
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = order.indexOf(mode);
    const next = order[(idx + 1) % order.length];
    setMode(next);
  };

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setMode, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

/**
 * Toggle-button. Klick zykliert light → dark → system → light. Icon
 * zeigt aktuellen mode (sun/moon/monitor — NICHT den resolved theme).
 *
 * # Warum mode-icon statt resolved-theme-icon
 *
 * Wenn mode='system' und das OS ist auf dark, würde ein resolved-theme-
 * icon die moon zeigen — der user denkt "ich bin auf dark mode" obwohl
 * er auf system ist. Beim klick passiert dann was unintuitives (zykelt
 * weiter zu light). Mit dem mode-icon (monitor wenn system) sieht der
 * user direkt "ah ich bin auf system, klick → light".
 *
 * # Mounted-guard
 *
 * Server kennt mode nicht (default 'system' im SSR). Bis useEffect den
 * echten storage-mode geladen hat, rendern wir einen placeholder gleicher
 * größe damit der button-layout stabil ist und kein hydration-mismatch
 * passiert.
 */
export function ThemeToggle() {
  const { mode, cycle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Label gibt dem user feedback was als nächstes passiert. cycle-order:
  // light → dark → system → light.
  const nextLabel: Record<ThemeMode, string> = {
    light: 'Switch to dark mode',
    dark: 'Switch to system mode (follows OS)',
    system: 'Switch to light mode',
  };
  const titleLabel: Record<ThemeMode, string> = {
    light: 'Light mode',
    dark: 'Dark mode',
    system: 'System mode (follows OS)',
  };

  return (
    <button
      onClick={cycle}
      className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
      aria-label={mounted ? nextLabel[mode] : 'Theme'}
      title={mounted ? titleLabel[mode] : 'Theme'}
    >
      {!mounted ? (
        // Placeholder gleicher größe — verhindert layout-jump + hydration-mismatch
        <span className="block w-5 h-5" aria-hidden="true" />
      ) : mode === 'light' ? (
        // Sun icon — aktuell light mode
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : mode === 'dark' ? (
        // Moon icon — aktuell dark mode
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // Monitor icon — aktuell system mode (folgt OS)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )}
    </button>
  );
}

/**
 * Pre-hydration script als string. Läuft synchron VOR React-hydration
 * im <head> via dangerouslySetInnerHTML. Setzt die .dark-class auf
 * <html> basierend auf localStorage + system pref.
 *
 * # 3-state-aware (Track 3 #11.2.4 Phase 1.5)
 *
 * Vorher: nur 'light' oder 'dark' im storage. Wenn absent, fallback zu
 * matchMedia. Jetzt: 'light' / 'dark' / 'system' / absent. 'system'
 * UND absent fallen beide zu matchMedia — das gibt rückwärtskompatibilität
 * für user die noch keinen storage-eintrag haben (frisch geöffnete app
 * oder grade gewechselte) und macht 'system' zum default-verhalten.
 *
 * # Format
 *
 * IIFE + try/catch um localStorage-fehler (Safari private mode etc.)
 * abzufangen. Bei error fall zu 'dark' (sichtbarkeit-pessimist:
 * default-dark verhindert flash auf nutzern die dark erwartet hatten).
 *
 * # Warum string statt component
 *
 * server-components können kein JS im browser ausführen, und wir brauchen
 * das VOR React-hydration damit kein FOUC auftritt. String + script-tag
 * im <head> ist die etablierte technik.
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem('theme');var t;if(s==='light'){t='light';}else if(s==='dark'){t='dark';}else{t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();`;
