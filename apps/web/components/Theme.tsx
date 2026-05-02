'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Theme provider. The actual <html> class manipulation has already happened
 * by the time this component mounts — see the inline script in app/layout.tsx
 * which runs synchronously before React hydrates to avoid a flash of unstyled
 * (or wrong-themed) content (FOUC).
 *
 * On mount, this component reads the class that the script set and syncs its
 * React state. The toggle then drives both the <html> class AND localStorage,
 * so the next page-load picks up the new pref via the inline script.
 *
 * SSR caveat: theme defaults to 'dark' during server rendering because the
 * server can't read localStorage or system preference. After hydration,
 * useEffect resyncs from the actual <html> class. This means a user with
 * light-mode preference will briefly render 'dark' state in React before
 * the effect runs, but the *visual* CSS class is already correct (set by
 * the pre-hydration script), so no visible flash. Components that
 * conditionally render based on theme (e.g. light/dark icons in
 * ThemeToggle) handle this with a `mounted` guard.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default 'dark' for SSR — script will have set the actual class by now.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      const html = document.documentElement;
      html.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('theme', next);
      } catch {
        // localStorage can throw in private browsing on Safari etc. — the
        // toggle still works for this session, just doesn't persist.
      }
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
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
 * Toggle button. Icon-only, square, designed to sit in the header next to
 * the user-dropdown. Renders sun-icon in dark mode (click → light), moon-
 * icon in light mode (click → dark). Uses inline SVG instead of an icon
 * library to avoid bundle bloat for two icons.
 *
 * The `mounted` guard prevents hydration mismatch: during SSR + initial
 * client render, theme is 'dark' (default state). Only after the mount
 * effect resyncs from the actual <html> class do we render the
 * conditional icon. Until then, render a placeholder of the same size.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <button
      onClick={toggle}
      className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={mounted ? `${theme === 'dark' ? 'Light' : 'Dark'} mode` : 'Theme'}
    >
      {!mounted ? (
        // Placeholder during SSR/pre-mount to keep layout stable
        <span className="block w-5 h-5" aria-hidden="true" />
      ) : theme === 'dark' ? (
        // Sun icon — clicking switches to light
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // Moon icon — clicking switches to dark
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

/**
 * Pre-hydration script as a string. Inject this via dangerouslySetInnerHTML
 * in the <head> so it runs before React hydrates. Reads localStorage and
 * falls back to system preference, then sets the .dark class on <html>.
 *
 * Why a string and not a component: server components can't run JS in the
 * browser, and we need this to execute *before* React hydrates to avoid
 * FOUC. Embedding as a literal script is the standard trick.
 *
 * Wrapped in IIFE + try/catch so localStorage failures (Safari private
 * mode, sandboxed iframes) don't break the page.
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem('theme');var t=s||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();`;
