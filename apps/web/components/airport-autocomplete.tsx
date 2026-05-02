'use client';

import { useState, useEffect, useRef, useId, useCallback } from 'react';
import { searchAirports } from '@/app/airline/routes/actions';

/**
 * Airport mit den feldern die der search-action zurückliefert. Type wird
 * lokal definiert weil es eine projection vom Airport-model ist (keine
 * volle row), und der typ wird nur intern in dieser component + ihrem
 * direkten consumer gebraucht.
 */
type AirportOption = {
  id: string;
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string;
  latitude: number;
  longitude: number;
};

interface Props {
  /** Form-field-name für den hidden input (z.B. "departureId"). */
  name: string;
  /** Sichtbares label für a11y + UX. */
  label: string;
  /**
   * Pre-filled airport (für edit-mode). Wenn gesetzt, wird der visible
   * input mit dem display-text initialisiert und der hidden input mit
   * der id. Bei create-mode null/undefined.
   */
  initialAirport?: AirportOption | null;
  /** Form-validation-error message für dieses field, optional. */
  error?: string;
  /** True wenn das field required ist (zeigt asterisk + sets html required). */
  required?: boolean;
  /** Optional placeholder text. Default zeigt usage-hint. */
  placeholder?: string;
}

/**
 * Reusable airport-autocomplete. Verwendet die airline/routes/actions
 * server-action für search, debounced auf 250ms damit nicht jeder
 * tastendruck eine query auslöst.
 *
 * Architektur:
 * - Hidden input mit dem ICAO-id (das form-submit verwendet diesen)
 * - Visible input mit human-readable display-text
 * - Dropdown overlay mit results, keyboard-nav (↑↓ enter esc)
 *
 * Edge-cases die das design absichert:
 * - User tippt + clickt schnell weg ohne selection: hidden input bleibt
 *   leer, server-validation würde "departureId required" werfen.
 * - User selectiert + ändert dann den text manuell: selection wird
 *   geclearet (input.value !== display-text), wieder leerer hidden input.
 * - Edit-mode mit initialAirport: form lädt mit pre-filled data, user
 *   kann ändern oder lassen.
 *
 * Nicht im scope:
 * - Multi-select (für single-airport reicht radio-style)
 * - Custom create (falls airport fehlt → AirportRequest-flow separat)
 */
export function AirportAutocomplete({
  name,
  label,
  initialAirport = null,
  error,
  required = false,
  placeholder,
}: Props) {
  const fieldId = useId();
  const listboxId = useId();

  // Selected airport state. Initial vom edit-mode oder null bei create.
  const [selected, setSelected] = useState<AirportOption | null>(initialAirport);

  // Visible input value. Synchronisiert mit selected wenn etwas selected
  // ist, sonst freier text vom user. Trennen damit user weiterhin tippen
  // kann ohne dass selection sofort verloren geht (siehe handleInputChange).
  const [inputValue, setInputValue] = useState(initialAirport ? formatDisplay(initialAirport) : '');

  // Search-results für dropdown.
  const [results, setResults] = useState<AirportOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Highlighted index für keyboard-nav. -1 = nichts highlighted.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Debounce-timer ref. clearTimeout when component unmounts oder neue
  // query startet.
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Container ref für click-outside-detection.
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Search debounced ───
  const triggerSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const found = await searchAirports(query);
      setResults(found);
      setIsOpen(found.length > 0);
      setHighlightedIndex(-1);
    } catch (err) {
      // Server-action throws on auth-failure — der user hat nichts in der
      // hand zu fixen, also silent fail. Console-log für entwicklung.
      console.error('Airport search failed:', err);
      setResults([]);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─── Input handler ───
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setInputValue(value);

    // Wenn der user den text ändert nach einer selection, clear die
    // selection. Sonst würde das hidden input den alten id behalten
    // und das form mit falscher kombination submitten.
    if (selected && value !== formatDisplay(selected)) {
      setSelected(null);
    }

    // Debounce 250ms — fast genug für responsive UX, langsam genug dass
    // tippen "EDDF" nicht 4 separate queries triggert.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerSearch(value), 250);
  }

  // ─── Selection ───
  function handleSelect(airport: AirportOption) {
    setSelected(airport);
    setInputValue(formatDisplay(airport));
    setIsOpen(false);
    setResults([]);
    setHighlightedIndex(-1);
  }

  // ─── Keyboard navigation ───
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || results.length === 0) {
      // Wenn dropdown closed: ↓ öffnet (re-search mit current value).
      if (e.key === 'ArrowDown' && inputValue.length >= 2) {
        e.preventDefault();
        triggerSearch(inputValue);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((idx) => Math.min(idx + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((idx) => Math.max(idx - 1, -1));
        break;
      case 'Enter':
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          e.preventDefault();
          handleSelect(results[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  }

  // ─── Click-outside closes dropdown ───
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ─── Cleanup debounce on unmount ───
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      <input
        ref={inputRef}
        id={fieldId}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setIsOpen(true);
        }}
        placeholder={placeholder ?? 'ICAO, IATA oder name (z.B. EDDF, FRA, Frankfurt)'}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          highlightedIndex >= 0 ? `${listboxId}-${highlightedIndex}` : undefined
        }
        aria-required={required}
        aria-invalid={!!error}
        className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
          error
            ? 'border-red-500 dark:border-red-500'
            : 'border-gray-300 dark:border-gray-700'
        } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-500`}
      />

      {/* Hidden input für form-submit. Speichert die airport-id. */}
      <input type="hidden" name={name} value={selected?.id ?? ''} required={required} />

      {/* Loading indicator als overlay rechts im input */}
      {isLoading && (
        <div
          className="absolute right-3 top-[2.4rem] text-xs text-gray-400"
          aria-hidden="true"
        >
          ...
        </div>
      )}

      {/* Dropdown-results */}
      {isOpen && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 w-full mt-1 max-h-72 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded shadow-lg"
        >
          {results.map((ap, idx) => (
            <li
              key={ap.id}
              id={`${listboxId}-${idx}`}
              role="option"
              aria-selected={highlightedIndex === idx}
              onMouseEnter={() => setHighlightedIndex(idx)}
              onMouseDown={(e) => {
                // mouseDown statt onClick: verhindert dass blur am input
                // den dropdown closet bevor selection läuft.
                e.preventDefault();
                handleSelect(ap);
              }}
              className={`px-3 py-2 cursor-pointer text-sm ${
                highlightedIndex === idx
                  ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-900 dark:text-indigo-100'
                  : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-semibold">{ap.icao}</span>
                {ap.iata && (
                  <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                    ({ap.iata})
                  </span>
                )}
                <span className="text-gray-700 dark:text-gray-300 truncate">{ap.name}</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {ap.city ? `${ap.city}, ` : ''}
                {ap.country}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

/**
 * Format-helper für display-string. ICAO ist immer vorhanden, IATA + city
 * sind optional. Ergibt z.B. "EDDF · FRA · Frankfurt am Main" oder
 * "CYHM · Hamilton/John C. Munro".
 */
function formatDisplay(ap: AirportOption): string {
  const parts = [ap.icao];
  if (ap.iata) parts.push(ap.iata);
  parts.push(ap.name);
  return parts.join(' · ');
}
