'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import {
  generateScheduleInstances,
  type GenerateScheduleResult,
} from './actions';

interface Props {
  /** Wenn 0: button zeigt hinweis dass keine templates vorhanden sind. */
  activeTemplateCount: number;
}

const DAYS_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 Tage' },
  { days: 14, label: '14 Tage' },
  { days: 30, label: '30 Tage' },
  { days: 60, label: '60 Tage' },
  { days: 90, label: '90 Tage' },
];

/**
 * Generate-Instances-Button (Welle 7 commit 7B-2).
 *
 * Split-button mit primary "Generieren (14 Tage)" + dropdown-arrow für
 * andere zeiträume (7/14/30/60/90). Default ist 14 — gibt admins genug
 * vorlauf damit piloten flights für die nächsten zwei wochen sehen, aber
 * nicht so viel dass die instance-tabelle bei kleinen templates monströs
 * wird.
 *
 * Result-feedback: success/error message inline unter dem button für 6
 * sekunden, dann fade-out. Bei success zeigt zusätzlich per-template-
 * breakdown (collapsed default, expandable) für audit.
 *
 * Idempotent über die action — admin kann den button mehrmals drücken
 * ohne duplikate zu erzeugen.
 */
export function GenerateInstancesButton({ activeTemplateCount }: Props) {
  const [selectedDays, setSelectedDays] = useState<number>(14);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<GenerateScheduleResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside closes dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Auto-fade success-message nach 8s — error bleibt sichtbar bis nächster
  // klick weil error-info wichtiger ist als clean UI.
  useEffect(() => {
    if (!result?.ok) return;
    const timer = setTimeout(() => setResult(null), 8000);
    return () => clearTimeout(timer);
  }, [result]);

  function handleGenerate(days: number) {
    setOpen(false);
    setSelectedDays(days);
    setShowDetails(false);
    const fd = new FormData();
    fd.set('daysAhead', String(days));
    startTransition(async () => {
      const r = await generateScheduleInstances(fd);
      setResult(r);
    });
  }

  const noTemplates = activeTemplateCount === 0;
  const selectedLabel =
    DAYS_OPTIONS.find((o) => o.days === selectedDays)?.label ?? '14 Tage';

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-0">
        <button
          type="button"
          onClick={() => handleGenerate(selectedDays)}
          disabled={isPending || noTemplates}
          title={
            noTemplates
              ? 'Keine aktiven templates vorhanden'
              : `Erstellt scheduled flights für die nächsten ${selectedLabel.toLowerCase()}`
          }
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-l text-sm font-medium transition flex items-center gap-2"
        >
          <span aria-hidden="true">⚙️</span>
          {isPending
            ? 'Generiere…'
            : `Instances generieren (${selectedLabel})`}
        </button>
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={isPending || noTemplates}
            aria-label="Zeitraum wählen"
            aria-haspopup="menu"
            aria-expanded={open}
            className="h-full px-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-r border-l border-emerald-800 text-sm transition flex items-center"
          >
            <svg
              className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-44 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden z-20"
            >
              {DAYS_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  type="button"
                  role="menuitem"
                  onClick={() => handleGenerate(opt.days)}
                  className="block w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition"
                >
                  Generieren ({opt.label})
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div
          className={`p-3 rounded-lg text-sm ${
            result.ok
              ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
          }`}
        >
          <p>
            {result.ok ? '✓' : '✗'} {result.message}
          </p>
          {result.ok && result.result.perTemplate.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="mt-2 text-xs underline hover:no-underline"
            >
              {showDetails ? 'Details ausblenden' : 'Details anzeigen'}
            </button>
          )}
          {result.ok && showDetails && (
            <ul className="mt-2 text-xs space-y-0.5">
              {result.result.perTemplate.map((t) => (
                <li key={t.templateId} className="font-mono">
                  {t.templateId.slice(0, 8)}…: {t.created} neu, {t.skipped}{' '}
                  übersprungen
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
