'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track 4 #70 (Section N) — Command-Palette (Cmd+K) ⌘
 *
 * Globaler quick-navigator overlay. Cmd+K (Mac) / Ctrl+K (Windows+Linux)
 * öffnet ein zentrales modal mit search-input + fuzzy-matched
 * navigation-targets. Pilot kann ohne maus zur dashboard / live-map /
 * bookings / etc. springen.
 *
 * # Design-entscheidungen
 *
 * 1. **Pre-defined targets** (kein server-search): v1 ist eine
 *    hardcoded liste der ~20 wichtigsten routes. Kein API-call beim
 *    suchen — alles in-memory, instant response. Server-side search
 *    über bookings/PIREPs/pilots ist eine logische erweiterung für v2
 *    (würde "Recent items" + "Quick actions" dazubringen).
 *
 * 2. **Substring statt fuzzy-match**: v1 macht plain case-insensitive
 *    substring auf label + keywords. Fuzzy-matching (fuse.js o.ä.)
 *    wäre nice-to-have aber additional ~10kb gzipped + komplexität
 *    nicht wert für 20 entries.
 *
 * 3. **Keywords-feld**: jeder entry hat optional `keywords` array für
 *    aliases. Z.B. "Dashboard" matched auch auf "home" oder "start".
 *
 * 4. **Section-grouping**: entries sind in 4 sektionen unterteilt
 *    (Navigation / Aktionen / Persönlich / Admin) für scanability.
 *    Beim filter werden sektion-headers ausgeblendet wenn alle items
 *    der sektion ausgefiltert sind.
 *
 * 5. **Selection-state**: aktuell highlighted item per index, mit
 *    arrow-up/down/home/end zum navigieren, enter zum aktivieren.
 *    Auto-reset auf 0 beim filter-change damit der highlight nicht
 *    auf einem gerade ausgefilterten item bleibt.
 *
 * 6. **Mount-pattern**: identisch zu KeyboardShortcutsManager — global
 *    in AppShell, NUR für authentifizierte user. Renders null wenn
 *    geschlossen damit der dialog-DOM nicht in jedem render-cycle
 *    re-erstellt wird.
 *
 * # Cmd+K vs Ctrl+K
 *
 * macOS-convention ist Cmd+K, Windows/Linux ist Ctrl+K. Wir akzeptieren
 * beide (e.metaKey || e.ctrlKey) damit cross-platform user nicht raten
 * müssen. Browser-defaults: Cmd+K auf macOS triggers nichts in den
 * meisten browsern, Ctrl+K auf Chrome focused die address-bar — wir
 * preventDefault() vor dem öffnen unseres palette.
 */

interface CommandItem {
  id: string;
  /** Anzeige-text in der liste */
  label: string;
  /** Optional zusätzlicher kontext (z.B. URL hint, action-explanation) */
  description?: string;
  /** Emoji oder unicode-glyph als visual anchor */
  icon: string;
  /** Navigation-target. Wenn gesetzt: router.push(href) beim aktivieren. */
  href: string;
  /** Such-aliases. Werden zusammen mit label gegen die query gematched. */
  keywords?: string[];
  /** Section-zuordnung für gruppierung */
  section: 'navigation' | 'actions' | 'personal' | 'admin';
}

/**
 * Pre-defined navigation targets. Sortiert nach wahrscheinlicher
 * frequenz innerhalb jeder sektion (dashboard zuerst, settings zuletzt).
 *
 * Wenn eine neue route hinzukommt die "regelmäßig genutzt" wird, hier
 * ein item hinzufügen. Liste sollte unter ~25 entries bleiben — sonst
 * lohnt sich server-side dynamic search statt.
 */
const COMMAND_ITEMS: CommandItem[] = [
  // Navigation — die häufigsten ziele
  {
    id: 'nav-dashboard',
    label: 'Dashboard',
    icon: '🏠',
    href: '/dashboard',
    section: 'navigation',
    keywords: ['home', 'start', 'übersicht'],
  },
  {
    id: 'nav-live',
    label: 'Live-Map',
    icon: '🗺️',
    href: '/live',
    section: 'navigation',
    keywords: ['karte', 'map', 'tracking', 'flugzeuge'],
  },
  {
    id: 'nav-bookings',
    label: 'Meine Bookings',
    icon: '📋',
    href: '/bookings',
    section: 'navigation',
    keywords: ['buchungen', 'flüge', 'meine'],
  },
  {
    id: 'nav-pireps',
    label: 'PIREPs',
    icon: '✈️',
    href: '/pireps',
    section: 'navigation',
    keywords: ['reports', 'flug-berichte', 'logbuch'],
  },
  {
    id: 'nav-routes',
    label: 'Routes',
    icon: '🛫',
    href: '/routes',
    section: 'navigation',
    keywords: ['strecken', 'flugplan', 'routen'],
  },
  {
    id: 'nav-pilots',
    label: 'Piloten-Roster',
    icon: '👥',
    href: '/pilots',
    section: 'navigation',
    keywords: ['roster', 'mitglieder', 'crew', 'kollegen'],
  },
  {
    id: 'nav-airports',
    label: 'Airports',
    icon: '🏢',
    href: '/airports',
    section: 'navigation',
    keywords: ['flughäfen', 'airports'],
  },
  {
    id: 'nav-events',
    label: 'Events',
    icon: '🎉',
    href: '/events',
    section: 'navigation',
    keywords: ['veranstaltungen', 'touren', 'tours'],
  },
  {
    id: 'nav-sceneries',
    label: 'Sceneries',
    icon: '🌄',
    href: '/sceneries',
    section: 'navigation',
    keywords: ['szenerien', 'add-ons', 'addons'],
  },
  {
    id: 'nav-flight-schools',
    label: 'Flight-Schools',
    icon: '🎓',
    href: '/flight-schools',
    section: 'navigation',
    keywords: ['schulen', 'ausbildung', 'training'],
  },

  // Aktionen — was kann ich JETZT machen?
  {
    id: 'action-new-booking',
    label: 'Neues Booking',
    description: 'Buchung anlegen',
    icon: '➕',
    href: '/bookings/new',
    section: 'actions',
    keywords: ['booking', 'buchen', 'flug', 'new', 'create', 'neu'],
  },
  {
    id: 'action-new-pirep',
    label: 'PIREP einreichen',
    description: 'Manuellen Flugbericht erstellen',
    icon: '📝',
    href: '/pireps/new',
    section: 'actions',
    keywords: ['report', 'einreichen', 'log', 'file', 'submit'],
  },

  // Persönlich
  {
    id: 'personal-licenses',
    label: 'Meine Lizenzen',
    icon: '📜',
    href: '/licenses',
    section: 'personal',
    keywords: ['licenses', 'rating', 'type-rating', 'career'],
  },
  {
    id: 'personal-wallet',
    label: 'Wallet',
    icon: '💰',
    href: '/wallet',
    section: 'personal',
    keywords: ['geld', 'kasse', 'economy', 'vam$', 'salary'],
  },
  {
    id: 'personal-year-in-review',
    label: 'Year-in-Review',
    description: 'Persönliche Jahres-Statistiken',
    icon: '🎁',
    href: '/me/year-in-review',
    section: 'personal',
    keywords: ['stats', 'rückblick', 'jahr', 'statistik'],
  },
  {
    id: 'personal-settings',
    label: 'Settings',
    icon: '⚙️',
    href: '/settings',
    section: 'personal',
    keywords: ['einstellungen', 'profile', 'profil', 'preferences'],
  },

  // Admin
  {
    id: 'admin-airline',
    label: 'Airline-Admin',
    icon: '🛠️',
    href: '/airline',
    section: 'admin',
    keywords: ['admin', 'verwaltung', 'manage'],
  },
];

const SECTION_LABELS: Record<CommandItem['section'], string> = {
  navigation: 'Navigation',
  actions: 'Aktionen',
  personal: 'Persönlich',
  admin: 'Admin',
};

const SECTION_ORDER: CommandItem['section'][] = [
  'navigation',
  'actions',
  'personal',
  'admin',
];

/**
 * Filter helper. Plain case-insensitive substring auf label + description +
 * keywords[]. Empty query → alle items, in originaler reihenfolge.
 *
 * Stabilitäts-garantie: items behalten ihre relative reihenfolge innerhalb
 * der section. Wir sortieren NICHT nach match-quality (würde fuzzy
 * scoring brauchen) — substring-match ist binär (match/no-match).
 */
function filterItems(query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return COMMAND_ITEMS;
  return COMMAND_ITEMS.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    if (item.description?.toLowerCase().includes(q)) return true;
    if (item.keywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
    return false;
  });
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Wenn open auf true geht: input fokussieren + query/selection reset.
  // Wenn open auf false geht: query clearen damit nächstes öffnen frisch
  // ist (sonst behält der filter-state und der user wundert sich warum
  // sein altes "dash" beim re-open noch da ist).
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Doppel-RAF damit das input-element gemountet ist bevor wir
      // focus() callen. Direktes focus() im selben render-cycle erreicht
      // das input noch nicht.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      });
    }
  }, [open]);

  // Global keydown-listener: Cmd+K / Ctrl+K toggled, Escape schließt.
  // Hier OUTSIDE des dialog-DOMs damit die shortcut auch wenn der palette
  // geschlossen ist funktioniert (wäre der listener auf dem dialog-element,
  // gäb's keinen handler bis er existiert = nie).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K (macOS) / Ctrl+K (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Filterte items + section-gruppierung. Memo damit der filter nicht bei
  // jedem render erneut läuft — query+open ist die nur abhängigkeit.
  const filteredItems = useMemo(() => filterItems(query), [query]);

  // Gruppe-by-section für rendering. Behält die SECTION_ORDER reihenfolge.
  const sectionedItems = useMemo(() => {
    return SECTION_ORDER.map((section) => ({
      section,
      items: filteredItems.filter((item) => item.section === section),
    })).filter((g) => g.items.length > 0);
  }, [filteredItems]);

  // Flat list für arrow-key-navigation (selection-index zeigt in diese list).
  const flatItems = filteredItems;

  // Reset selection bei filter-change damit nicht auf einem hidden item
  // gehighlight wird.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Activate: navigate + close palette.
  const activate = useCallback(
    (item: CommandItem) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  // Arrow-key + Enter handler im dialog. ALLES key-handling im dialog-
  // element damit es nicht mit andere globalen shortcuts (siehe Keyboard-
  // ShortcutsManager) kollidiert.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flatItems.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % flatItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setSelectedIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setSelectedIndex(flatItems.length - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[selectedIndex];
        if (item) activate(item);
      }
    },
    [flatItems, selectedIndex, activate],
  );

  // Scroll selected item into view wenn keyboard-navigation es aus dem
  // viewport schiebt. behavior: 'nearest' verhindert unnötige scrolls
  // wenn das item schon sichtbar ist.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selectedEl = listRef.current.querySelector(
      `[data-command-index="${selectedIndex}"]`,
    );
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-2xl w-full max-w-xl flex flex-col max-h-[70vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="command-palette-title" className="sr-only">
          Command Palette
        </h2>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <span aria-hidden="true" className="text-gray-400 text-lg">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tippe um zu suchen…"
            className="flex-1 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none text-sm"
            aria-label="Befehl suchen"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-500">
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto py-2"
          role="listbox"
          aria-label="Verfügbare Befehle"
        >
          {sectionedItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              Keine Treffer für{' '}
              <span className="font-mono text-gray-700 dark:text-gray-300">
                &ldquo;{query}&rdquo;
              </span>
            </div>
          ) : (
            sectionedItems.map(({ section, items }) => (
              <div key={section}>
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-600">
                  {SECTION_LABELS[section]}
                </div>
                {items.map((item) => {
                  // Globaler flat-index für selection-tracking. Wir nutzen
                  // indexOf weil items im sectioned-array nicht den gleichen
                  // index wie im flat-array haben.
                  const flatIdx = flatItems.indexOf(item);
                  const isSelected = flatIdx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-command-index={flatIdx}
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      onClick={() => activate(item)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition ${
                        isSelected
                          ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span aria-hidden="true" className="text-base">
                        {item.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium">
                          {item.label}
                        </span>
                        {item.description && (
                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400 truncate hidden sm:inline">
                        {item.href}
                      </span>
                      {isSelected && (
                        <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-indigo-100 dark:bg-indigo-900 border border-indigo-200 dark:border-indigo-700 rounded text-indigo-700 dark:text-indigo-300">
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/50 text-[10px] text-gray-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
                ↑↓
              </kbd>
              Navigation
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
                ↵
              </kbd>
              Auswählen
            </span>
            <span className="flex items-center gap-1 hidden sm:flex">
              <kbd className="px-1 py-0.5 font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
                ⌘K
              </kbd>
              Schließen
            </span>
          </div>
          <span className="text-gray-400">
            {flatItems.length} {flatItems.length === 1 ? 'Treffer' : 'Treffer'}
          </span>
        </div>
      </div>
    </div>
  );
}
