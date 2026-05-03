'use client';

import { useState, useEffect, useRef, useId, useCallback } from 'react';
import { searchAircraftTypes } from '@/app/airline/aircraft/actions';

/**
 * AircraftType-projection mit den feldern die der search-action zurück-
 * liefert. Lokal definiert weil's eine projection vom AircraftType-model
 * ist (keine volle row), und der typ wird nur intern in dieser component
 * + ihrem direkten consumer gebraucht.
 */
type AircraftTypeOption = {
  id: string;
  icaoType: string;
  name: string;
  manufacturer: string;
  category: string;
  verified: boolean;
};

interface Props {
  /**
   * Form-field-name für den hidden input mit der typeId. Default
   * "aircraftTypeId" — passt zu addAircraft/updateAircraft server-actions.
   */
  typeIdName?: string;
  /**
   * Form-field-name für den hidden input mit dem free-text ICAO. Default
   * "type" — auch zu den server-actions kompatibel.
   */
  typeName?: string;
  /** Sichtbares label für a11y + UX. */
  label?: string;
  /**
   * Pre-filled type für edit-mode. Wenn `initialAircraftTypeId` gesetzt
   * ist, sollte auch `initialDisplay` mitgegeben werden ("B738 — Boeing
   * 737-800"). Bei pre-filled free-text only: `initialAircraftTypeId =
   * null`, `initialType = "B738"`, `initialDisplay = "B738"`.
   */
  initialAircraftTypeId?: string | null;
  initialType?: string | null;
  initialDisplay?: string;
  /** True wenn das field required ist. */
  required?: boolean;
  /** Optional placeholder text. */
  placeholder?: string;
}

/**
 * Reusable AircraftType-autocomplete in HYBRID mode.
 *
 * Unterschied zu AirportAutocomplete: AirportAutocomplete forced eine
 * selection (hidden input enthält die airport-id, leer wenn keine
 * selection → server-validation rejects).
 *
 * Hier: catalog-pick ist OPTIONAL. Wenn user "B738" tippt und keinen
 * catalog-eintrag wählt, wird der getippte text als free-text
 * akzeptiert (legacy fallback, siehe addAircraft action). Daher
 * ZWEI hidden inputs:
 *
 * - `aircraftTypeId` (default name): catalog-FK, leer wenn keine selection
 * - `type` (default name): immer der visible input-text (ICAO free-text)
 *
 * Server-action handelt beide cases:
 * - typeId gesetzt → catalog-lookup, type-string aus catalog überschrieben
 * - typeId leer + type gesetzt → free-text accepted, uppercased server-side
 *
 * Architektur:
 * - Visible input mit free-text + display-text wenn selected
 * - Dropdown overlay mit results, keyboard-nav (↑↓ enter esc)
 * - Click-outside closes dropdown
 * - Debounce 250ms (analog AirportAutocomplete)
 *
 * Edge-cases:
 * - User selectiert + ändert dann den text manuell: selection wird
 *   geclearet (input.value !== display-text), hidden typeId wird leer,
 *   hidden type bekommt den aktuellen text.
 * - User selectiert "B738 — Boeing 737-800" → hidden type wird "B738"
 *   (icaoType) gesetzt, NICHT der display-text.
 * - User tippt nur "Boeing" → suggestions zeigen verschiedene Boeing-
 *   types, falls keiner gewählt: hidden type = "Boeing" (server uppercased
 *   zu "BOEING" — wird aber im normalfall durch zod-regex /^[A-Z0-9-]+$/
 *   erlaubt sein... wait, type ist nur max(20), keine regex. OK.)
 *
 * Nicht im scope:
 * - "Custom create" — falls type fehlt, separate AircraftTypeRequest-flow
 *   (existing route /aircraft-types/request).
 */
export function AircraftTypeAutocomplete({
  typeIdName = 'aircraftTypeId',
  typeName = 'type',
  label = 'Aircraft Type (ICAO)',
  initialAircraftTypeId = null,
  initialType = null,
  initialDisplay,
  required = false,
  placeholder,
}: Props) {
  const fieldId = useId();
  const listboxId = useId();

  // Selected-state: nur gesetzt wenn user explizit aus dropdown gewählt
  // hat. Initial null, auch wenn initialAircraftTypeId existiert — wir
  // haben in props nicht den vollen AircraftTypeOption (nur id + display-
  // text), also kein object zu speichern. Der "selected"-state wird beim
  // edit-mode aus initialDisplay rekonstruiert für UI-zwecke.
  const [selected, setSelected] = useState<AircraftTypeOption | null>(null);

  // Fallback-typeId: nur im edit-mode initial gesetzt, wenn user nichts
  // ändert wird das ans form gesendet. Wenn user etwas tippt + selection
  // macht → von selected.id überschrieben. Wenn user etwas tippt OHNE
  // selection → auf '' gesetzt (catalog-link gelöst).
  const [persistedTypeId, setPersistedTypeId] = useState<string | null>(
    initialAircraftTypeId,
  );

  // Visible input value. Default: initialDisplay (z.B. "B738 — Boeing 737-800")
  // im edit-mode, oder initialType ("B738") wenn nur free-text gesetzt war.
  const [inputValue, setInputValue] = useState(
    initialDisplay ?? initialType ?? '',
  );

  const [results, setResults] = useState<AircraftTypeOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Search debounced ───
  const triggerSearch = useCallback(async (query: string) => {
    if (query.trim().length < 1) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const found = await searchAircraftTypes(query);
      setResults(found);
      setIsOpen(found.length > 0);
      setHighlightedIndex(-1);
    } catch (err) {
      console.error('AircraftType search failed:', err);
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

    // Wenn user den text ändert nach einer selection, clear sie.
    if (selected && value !== formatDisplay(selected)) {
      setSelected(null);
    }

    // Auch persisted typeId clearen sobald user etwas tippt das nicht
    // mehr dem original-display entspricht. Das verhindert dass der
    // hidden typeId im edit-mode "hängen bleibt" wenn user den type
    // ändert.
    if (persistedTypeId && value !== initialDisplay && value !== initialType) {
      setPersistedTypeId(null);
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerSearch(value), 250);
  }

  // ─── Selection ───
  function handleSelect(type: AircraftTypeOption) {
    setSelected(type);
    setPersistedTypeId(null); // wird durch selected.id überschrieben
    setInputValue(formatDisplay(type));
    setIsOpen(false);
    setResults([]);
    setHighlightedIndex(-1);
  }

  // ─── Keyboard navigation ───
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || results.length === 0) {
      if (e.key === 'ArrowDown' && inputValue.length >= 1) {
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
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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

  // Compute hidden values for form-submit.
  // - typeId: selection > persisted (edit-mode) > leer
  // - type:   selection.icaoType > raw input value (uppercased server-side)
  const hiddenTypeId = selected?.id ?? persistedTypeId ?? '';
  const hiddenType = selected?.icaoType ?? inputValue;

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
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
        placeholder={
          placeholder ?? 'B738, A20N, Boeing 737, Airbus A320…'
        }
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          highlightedIndex >= 0 ? `${listboxId}-${highlightedIndex}` : undefined
        }
        aria-required={required}
        required={required}
        maxLength={50}
        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono"
      />

      {/* Hidden inputs für form-submit. */}
      <input type="hidden" name={typeIdName} value={hiddenTypeId} />
      <input type="hidden" name={typeName} value={hiddenType} />

      {/* Loading indicator */}
      {isLoading && (
        <div
          className="absolute right-3 top-[2.1rem] text-xs text-gray-400"
          aria-hidden="true"
        >
          ...
        </div>
      )}

      {/* Match-indicator (subtle hint dass aktuelle eingabe im catalog ist) */}
      {selected && !isOpen && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
          ✓ Catalog-Eintrag verlinkt: {selected.manufacturer} {selected.name}
          {selected.verified && ' (verifiziert)'}
        </p>
      )}
      {!selected && persistedTypeId && !isOpen && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
          Aktuell mit Catalog-Eintrag verlinkt.
        </p>
      )}
      {!selected && !persistedTypeId && inputValue.trim().length > 0 && !isOpen && (
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
          Free-Text — kein Catalog-Eintrag ausgewählt.
        </p>
      )}

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 w-full mt-1 max-h-72 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded shadow-lg"
        >
          {results.map((t, idx) => (
            <li
              key={t.id}
              id={`${listboxId}-${idx}`}
              role="option"
              aria-selected={highlightedIndex === idx}
              onMouseEnter={() => setHighlightedIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(t);
              }}
              className={`px-3 py-2 cursor-pointer text-sm ${
                highlightedIndex === idx
                  ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-900 dark:text-indigo-100'
                  : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-semibold">{t.icaoType}</span>
                <span className="text-gray-700 dark:text-gray-300 truncate">
                  {t.manufacturer} {t.name}
                </span>
                {t.verified && (
                  <span
                    className="ml-auto text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold"
                    aria-label="verifiziert"
                  >
                    ✓
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {CATEGORY_LABELS[t.category] ?? t.category}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  narrow_body: 'Narrow-Body',
  wide_body: 'Wide-Body',
  regional: 'Regional',
  cargo: 'Cargo',
  ga: 'General Aviation',
};

/**
 * Format-helper für display-string. Format: "B738 — Boeing 737-800".
 * Em-dash (—) statt bindestrich für visual separation.
 */
function formatDisplay(t: AircraftTypeOption): string {
  return `${t.icaoType} — ${t.manufacturer} ${t.name}`;
}
