'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track 4 #53 (Section J) — Keyboard-Shortcut Help-Dialog + Global
 * Navigation-Shortcuts.
 *
 * Mounted einmal global (in AppShell) und macht zwei dinge:
 *
 *   1. **Help-dialog**: `?` öffnet einen overlay mit shortcut-liste,
 *      `Escape` schließt. Vorher gab's keine discovery — wer wusste
 *      nicht von shortcuts, fand sie auch nicht.
 *
 *   2. **Navigation-shortcuts**: `g` gefolgt von einem leader-key
 *      navigiert zu häufigen routes — `g d` (Dashboard), `g l` (Live-
 *      Map), `g b` (Bookings), `g p` (Pilots), `g s` (Settings).
 *      Inspiriert von Gmail / GitHub / Linear.
 *
 * # Sequence-state
 *
 * Wir tracken im local-state ob die letzte taste ein `g` war (mit
 * timeout-reset nach 1.5s). Das macht `g d` zu einer 2-key-sequence
 * statt einer modifier-combo — wesentlich besser auf laptops weil keine
 * collisions mit browser-shortcuts (Ctrl+L = address-bar etc.).
 *
 * # Wenn nicht reagieren
 *
 * - User tippt grad in einem input/textarea/contenteditable → skip.
 *   Sonst kann er das wort "good" nicht ins suchfeld tippen ohne dass
 *   das `g` die nav-sequence triggert.
 * - Modifier-key gedrückt (Ctrl/Alt/Meta+Shift) → skip. Nur plain-key-
 *   presses.
 *
 * # Mount-strategie
 *
 * Mounted im AppShell (nicht direkt im root-layout) weil AppShell schon
 * client-component ist und auth/branding-context da ist. Wenn der user
 * nicht eingeloggt ist mounted AppShell den shell nicht — dann sind die
 * shortcuts auch nicht aktiv, was OK ist (auf der Login-page brauchen
 * wir keine `g d`-shortcuts).
 */

interface Shortcut {
  keys: string[]; // einzelne keys als string-array für rendering
  label: string;
  href?: string; // wenn gesetzt: navigation-shortcut
}

const NAV_SHORTCUTS: Shortcut[] = [
  { keys: ['g', 'd'], label: 'Zum Dashboard', href: '/dashboard' },
  { keys: ['g', 'l'], label: 'Zur Live-Map', href: '/live' },
  { keys: ['g', 'b'], label: 'Zu meinen Bookings', href: '/bookings' },
  { keys: ['g', 'p'], label: 'Zum Piloten-Roster', href: '/pilots' },
  { keys: ['g', 'w'], label: 'Zum Wallet', href: '/wallet' },
  { keys: ['g', 's'], label: 'Zu den Settings', href: '/settings' },
];

const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: ['?'], label: 'Diesen Help-Dialog öffnen' },
  { keys: ['Esc'], label: 'Dialog/Drawer schließen' },
];

/**
 * Treat the active element as "typing"? `<input>`, `<textarea>`, oder
 * `contenteditable` elements. Während der user tippt sollen unsere keys
 * NIE den focus stehlen oder navigieren.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function KeyboardShortcutsManager() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    // Sequence-state für `g X`. ref-pattern wäre cleaner aber unter useEffect
    // ist `let` im closure-scope vollkommen ausreichend, das closure überlebt
    // bis der listener removed wird.
    let lastGAt = 0;
    const G_SEQUENCE_WINDOW_MS = 1500;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // `?` öffnet help — shift-+-/ auf US-keyboards, kann aber je nach
      // layout was anderes sein, drum auf `e.key === '?'` matchen statt
      // auf physikalischen scancode.
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      if (e.key === 'Escape' && helpOpen) {
        setHelpOpen(false);
        return;
      }

      // Navigation-sequence: erste taste war `g`?
      if (e.key === 'g') {
        lastGAt = Date.now();
        return;
      }

      // Within sequence-window: prüfe ob's ein bekanntes nav-target ist.
      if (lastGAt > 0 && Date.now() - lastGAt < G_SEQUENCE_WINDOW_MS) {
        const match = NAV_SHORTCUTS.find(
          (s) => s.keys[0] === 'g' && s.keys[1] === e.key,
        );
        lastGAt = 0; // sequence consumed regardless of match
        if (match?.href) {
          e.preventDefault();
          router.push(match.href);
          setHelpOpen(false);
        }
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [router, helpOpen]);

  if (!helpOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            id="keyboard-shortcuts-title"
            className="text-lg font-semibold flex items-center gap-2"
          >
            <span aria-hidden="true">⌨️</span>
            <span>Tastatur-Shortcuts</span>
          </h2>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
            aria-label="Dialog schließen"
          >
            ×
          </button>
        </div>

        <section className="mb-6">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-3">
            Navigation (g + Taste)
          </h3>
          <ul className="space-y-2">
            {NAV_SHORTCUTS.map((s) => (
              <ShortcutRow key={s.label} shortcut={s} />
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-3">
            Global
          </h3>
          <ul className="space-y-2">
            {GLOBAL_SHORTCUTS.map((s) => (
              <ShortcutRow key={s.label} shortcut={s} />
            ))}
          </ul>
        </section>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
          Tipp: Während du in einem Textfeld tippst sind die Shortcuts deaktiviert.
        </p>
      </div>
    </div>
  );
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <li className="flex items-center justify-between gap-4 text-sm">
      <span className="text-gray-700 dark:text-gray-300">{shortcut.label}</span>
      <span className="flex gap-1 flex-shrink-0">
        {shortcut.keys.map((k, idx) => (
          <kbd
            // eslint-disable-next-line react/no-array-index-key
            key={idx}
            className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs font-mono text-gray-700 dark:text-gray-300"
          >
            {k}
          </kbd>
        ))}
      </span>
    </li>
  );
}
