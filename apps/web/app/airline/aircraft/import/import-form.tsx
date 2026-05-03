'use client';

import { useState, useTransition, useRef } from 'react';
import { bulkImportAircraft, type AircraftBulkImportResult } from '../actions';

/**
 * Erwartete CSV-spalten. Wenn der user ein header-set schickt das
 * nicht matched, zeigen wir einen sauberen fehler statt cryptic
 * "missing field" pro row.
 */
const EXPECTED_HEADERS = ['registration', 'type', 'home_icao', 'status'] as const;
const REQUIRED_HEADERS = ['registration', 'type'] as const;

/**
 * Simpler CSV-parser — kopiert 1:1 aus routes/import/import-form.tsx.
 * Beide forms nutzen die gleiche logic; eine shared util würde sich
 * lohnen wenn wir noch mehr CSV-imports bekommen, aber 2 forms ist
 * unter dem extraction-threshold.
 *
 * Handled: BOM strip, \r\n und \n line-endings, leere zeilen ignorieren,
 * quoted-fields mit commas innerhalb (RFC-4180 minimal subset), doppelte
 * quotes als escape ("" → ").
 */
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"' && field === '') {
        inQuotes = true;
      } else if (c === ',') {
        cur.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(field);
        field = '';
        if (cur.some((f) => f.length > 0)) rows.push(cur);
        cur = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.some((f) => f.length > 0)) rows.push(cur);
  }

  return rows;
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'parse-error'; message: string }
  | {
      status: 'preview';
      headers: string[];
      rows: Array<Record<string, string>>;
      filename: string;
    }
  | { status: 'imported'; result: AircraftBulkImportResult };

export function ImportForm() {
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setState({
        status: 'parse-error',
        message: `"${file.name}" ist keine CSV-datei. Bitte exportiere aus Excel als "CSV UTF-8".`,
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== 'string') {
        setState({ status: 'parse-error', message: 'CSV konnte nicht gelesen werden.' });
        return;
      }

      const allRows = parseCsv(text);
      if (allRows.length < 2) {
        setState({
          status: 'parse-error',
          message: 'CSV enthält keine daten — nur header oder komplett leer.',
        });
        return;
      }

      const headers = allRows[0].map((h) => h.trim().toLowerCase());

      const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
      if (missing.length > 0) {
        setState({
          status: 'parse-error',
          message: `Pflichtspalten fehlen: ${missing.join(', ')}. Lade das template neu herunter und nutze die exakte spalten-reihenfolge.`,
        });
        return;
      }

      const dataRows = allRows.slice(1).map((row) => {
        const obj: Record<string, string> = {};
        for (const h of EXPECTED_HEADERS) {
          const idx = headers.indexOf(h);
          obj[h] = idx >= 0 && idx < row.length ? row[idx].trim() : '';
        }
        return obj;
      });

      if (dataRows.length === 0) {
        setState({ status: 'parse-error', message: 'CSV hat header aber keine daten-zeilen.' });
        return;
      }

      setState({
        status: 'preview',
        headers: [...EXPECTED_HEADERS],
        rows: dataRows,
        filename: file.name,
      });
    };
    reader.onerror = () => {
      setState({ status: 'parse-error', message: 'Fehler beim lesen der datei.' });
    };
    reader.readAsText(file, 'utf-8');
  }

  function handleConfirm() {
    if (state.status !== 'preview') return;
    const rows = state.rows;
    startTransition(async () => {
      const result = await bulkImportAircraft(rows);
      setState({ status: 'imported', result });
    });
  }

  function handleReset() {
    setState({ status: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ─── Render ────────────────────────────────────────────────────────────

  if (state.status === 'imported') {
    const { result } = state;
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm space-y-4">
        <div
          className={`p-4 rounded-lg ${
            result.summary.created > 0
              ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800'
          }`}
        >
          <h3 className="font-semibold text-lg mb-1">
            {result.summary.created > 0 ? '✓' : '✗'} Import abgeschlossen
          </h3>
          <p className="text-sm">{result.message}</p>
          <div className="flex gap-4 mt-3 text-sm">
            <span className="text-green-700 dark:text-green-400">
              ✓ {result.summary.created} angelegt
            </span>
            <span className="text-amber-700 dark:text-amber-400">
              ⚠ {result.summary.skipped} übersprungen
            </span>
            <span className="text-red-700 dark:text-red-400">
              ✗ {result.summary.errors} fehler
            </span>
          </div>
        </div>

        {result.rows.length > 0 && (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="text-left py-2 px-3 font-semibold">Zeile</th>
                  <th className="text-left py-2 px-3 font-semibold">Status</th>
                  <th className="text-left py-2 px-3 font-semibold">Reg.</th>
                  <th className="text-left py-2 px-3 font-semibold">Meldung</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr
                    key={r.rowIndex}
                    className="border-b border-gray-100 dark:border-gray-800"
                  >
                    <td className="py-2 px-3 font-mono">{r.rowIndex}</td>
                    <td className="py-2 px-3">
                      {r.status === 'created' && (
                        <span className="text-green-600 dark:text-green-400">✓ angelegt</span>
                      )}
                      {r.status === 'skipped' && (
                        <span className="text-amber-600 dark:text-amber-400">⚠ skip</span>
                      )}
                      {r.status === 'error' && (
                        <span className="text-red-600 dark:text-red-400">✗ fehler</span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-mono">{r.registration ?? '—'}</td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                      {r.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition"
          >
            Weitere CSV importieren
          </button>
          <a
            href="/airline/aircraft"
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-lg transition"
          >
            Zur Aircraft-Verwaltung
          </a>
          <a
            href="/airline/fleet"
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-lg transition"
          >
            Zur Fleet-Übersicht
          </a>
        </div>
      </div>
    );
  }

  if (state.status === 'preview') {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-semibold text-lg">Vorschau: {state.filename}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              {state.rows.length} zeile{state.rows.length === 1 ? '' : 'n'} erkannt.
              Server validiert beim import — fehlerhafte zeilen werden
              übersprungen, nicht importiert.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-lg transition"
            >
              Andere datei
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
            >
              {isPending ? 'Importiere…' : `${state.rows.length} aircraft importieren`}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-6 px-6">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                <th className="text-left py-2 px-3 font-semibold">#</th>
                {state.headers.map((h) => (
                  <th key={h} className="text-left py-2 px-3 font-mono">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rows.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3 font-mono text-gray-500">{i + 1}</td>
                  {state.headers.map((h) => (
                    <td key={h} className="py-2 px-3 font-mono">
                      {row[h] || <span className="text-gray-400">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {state.rows.length > 100 && (
            <p className="text-xs text-gray-500 mt-2">
              Vorschau zeigt erste 100 von {state.rows.length} zeilen. Alle
              werden beim import verarbeitet.
            </p>
          )}
        </div>
      </div>
    );
  }

  // idle | parse-error
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 shadow-sm space-y-4">
      {state.status === 'parse-error' && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <p className="font-semibold text-red-700 dark:text-red-400">
            ✗ {state.message}
          </p>
        </div>
      )}

      <label className="block">
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 text-center hover:border-indigo-400 dark:hover:border-indigo-600 transition cursor-pointer">
          <div className="text-4xl mb-3">📁</div>
          <p className="font-medium mb-1">CSV-datei hier ablegen oder klicken</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Maximal 500 zeilen pro datei
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </label>
    </div>
  );
}
