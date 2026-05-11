'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Track 4 #88 (Section Q) — Client-side picker für den compare-page.
 *
 * Reason für client-component: das input muss den existing types-string
 * mit dem neuen ICAO-code mergen + zur URL navigieren. Pure HTML-form
 * mit GET kann das nicht (würde existing types überschreiben statt zu
 * appenden). Statt zwei separater request-roundtrips (one to read existing,
 * one to navigate) machen wir die merge-logik client-side.
 *
 * Bleibt minimal: keine autocomplete, kein catalog-search. Admin tippt
 * ICAO-code (kennt er meistens), submit pusht zur neuen URL.
 */
interface Props {
  /** Bisherige selected types in URL-reihenfolge */
  currentTypes: string[];
  /** Max types — wenn currentTypes.length >= max, picker hidden */
  max: number;
}

export function CompareTypePicker({ currentTypes, max }: Props) {
  const [icao, setIcao] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (currentTypes.length >= max) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = icao.trim().toUpperCase();
    if (!trimmed) return;
    if (currentTypes.includes(trimmed)) {
      // Bereits in der liste — reset input ohne navigation
      setIcao('');
      return;
    }
    const next = [...currentTypes, trimmed];
    startTransition(() => {
      router.push(`/airline/aircraft/compare?types=${next.join(',')}`);
      setIcao('');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={icao}
        onChange={(e) => setIcao(e.target.value)}
        placeholder="ICAO-Code (z.B. B738)"
        className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase placeholder:normal-case placeholder:text-gray-400 focus:outline-none focus:border-indigo-500"
        maxLength={6}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="submit"
        disabled={pending || !icao.trim()}
        className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Lade…' : '+ Hinzufügen'}
      </button>
    </form>
  );
}
