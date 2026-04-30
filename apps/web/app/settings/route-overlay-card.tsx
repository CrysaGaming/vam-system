'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateRouteSimBriefOverlay } from './actions';
import {
  SECTIONS,
  overlayToFormValues,
  formValuesToOverlay,
} from './_overlay-fields';
import type { SimBriefOverlay } from '@/lib/simbrief/overlay';

interface RouteSummary {
  id: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  overlay: SimBriefOverlay;
  populatedCount: number;
}

interface Props {
  initial: RouteSummary[];
}

/**
 * Route overlays sit at Ebene 4 (highest precedence) of the Override-
 * Hierarchie. Edit-only model like Aircraft — Route rows are part of
 * the airline's published schedule and are managed elsewhere; this
 * card only edits the overlay JSON column on each row.
 */
type EditorState = null | { routeId: string };

export function RouteOverlayCard({ initial }: Props) {
  const router = useRouter();
  const [routes, setRoutes] = useState(initial);
  const [editor, setEditor] = useState<EditorState>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; msg: string }[]>([]);
  const [isPending, startTransition] = useTransition();

  const editingItem =
    editor !== null ? routes.find((r) => r.id === editor.routeId) : null;

  const openEdit = (item: RouteSummary) => {
    setEditor({ routeId: item.id });
    setValues(overlayToFormValues(item.overlay));
    setError(null);
    setIssues([]);
  };

  const closeEditor = () => {
    setEditor(null);
    setValues({});
    setError(null);
    setIssues([]);
  };

  const setField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
    if (issues.length > 0) setIssues([]);
  };

  const handleClearAll = () => {
    if (
      !confirm(
        'Alle Overrides für diese Route löschen? Die Route selbst bleibt unberührt.',
      )
    )
      return;
    setValues(overlayToFormValues({}));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    setError(null);
    setIssues([]);

    const overlay = formValuesToOverlay(values);

    startTransition(async () => {
      const result = await updateRouteSimBriefOverlay(editor.routeId, overlay);
      if (result.success) {
        const populatedCount = Object.keys(overlay).length;
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === editor.routeId ? { ...r, overlay, populatedCount } : r,
          ),
        );
        closeEditor();
        router.refresh();
      } else {
        if (result.error === 'unauthorized')
          setError('Nicht angemeldet — Seite neu laden.');
        else if (result.error === 'no_airline')
          setError('Du bist keiner Airline zugeordnet.');
        else if (result.error === 'forbidden')
          setError(
            'Diese Route gehört zu einer anderen Airline — kein Zugriff.',
          );
        else if (result.error === 'not_found')
          setError('Route nicht gefunden.');
        else if (result.error === 'invalid_input') {
          setError('Mindestens ein Feld hat einen ungültigen Wert.');
          setIssues(
            (result.issues ?? []).map((i) => ({
              path: i.path.join('.'),
              msg: i.message,
            })),
          );
        } else {
          setError(result.error);
        }
      }
    });
  };

  const populatedCount = Object.values(values).filter((v) => v !== '').length;

  // Routes can be many. Surface the count of routes with at least one
  // override in the header so the user sees activity at a glance even
  // when scrolling the list.
  const routesWithOverridesCount = routes.filter(
    (r) => r.populatedCount > 0,
  ).length;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold">SimBrief Override (Route)</h3>
        <span className="text-xs text-gray-500 mt-1">
          {routesWithOverridesCount} / {routes.length} mit Overrides
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Ebene 4 der Override-Hierarchie — höchste Präzedenz. Pro Route-Eintrag
        (z. B. LH600 EDDF→LOWW). Überschreibt alle anderen Ebenen. Routen
        werden vom Schedule-Management verwaltet, hier nur die Override-
        Werte editierbar.
      </p>

      {routes.length === 0 && (
        <div className="text-sm text-gray-500 italic mb-4 px-3 py-4 border border-dashed border-gray-800 rounded text-center">
          Keine Routen in deiner Airline registriert.
        </div>
      )}

      {routes.length > 0 && (
        <ul className="divide-y divide-gray-800 max-h-96 overflow-y-auto">
          {routes.map((item) => (
            <li
              key={item.id}
              className="py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-medium text-base">
                  {item.flightNumber}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                  {item.departureIcao} → {item.arrivalIcao}
                </span>
                <span className="text-xs text-gray-500">·</span>
                <span
                  className={`text-xs ${
                    item.populatedCount > 0
                      ? 'text-indigo-400'
                      : 'text-gray-500'
                  }`}
                >
                  {item.populatedCount}{' '}
                  {item.populatedCount === 1 ? 'Override' : 'Overrides'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => openEdit(item)}
                disabled={isPending}
                className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-50"
              >
                Bearbeiten
              </button>
            </li>
          ))}
        </ul>
      )}

      {editor && editingItem && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 pt-4 border-t border-gray-800"
        >
          <h4 className="text-base font-semibold mb-4">
            Route bearbeiten:{' '}
            <span className="font-mono">{editingItem.flightNumber}</span>{' '}
            <span className="text-sm text-gray-500 font-normal font-mono">
              ({editingItem.departureIcao} → {editingItem.arrivalIcao})
            </span>
          </h4>

          {error && (
            <div className="mb-4 px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-300 text-sm">
              {error}
              {issues.length > 0 && (
                <ul className="mt-2 ml-4 list-disc text-xs">
                  {issues.map((i, idx) => (
                    <li key={idx}>
                      <code>{i.path}</code>: {i.msg}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-8">
            {SECTIONS.map((section) => (
              <fieldset
                key={section.title}
                className="border-t border-gray-800 pt-4"
              >
                <legend className="text-xs uppercase tracking-wider text-gray-500 mb-1 px-2 -ml-2">
                  {section.title}
                </legend>
                <p className="text-xs text-gray-500 mb-4">
                  {section.description}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {section.fields.map((f) => (
                    <div key={f.key as string}>
                      <label className="block text-sm font-medium mb-1">
                        {f.label}
                      </label>
                      {f.type === 'select' ? (
                        <select
                          value={values[f.key as string] ?? ''}
                          onChange={(e) =>
                            setField(f.key as string, e.target.value)
                          }
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                          disabled={isPending}
                        >
                          {f.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={f.type}
                          value={values[f.key as string] ?? ''}
                          onChange={(e) =>
                            setField(f.key as string, e.target.value)
                          }
                          placeholder={
                            'placeholder' in f ? f.placeholder : undefined
                          }
                          min={f.type === 'number' ? f.min : undefined}
                          max={f.type === 'number' ? f.max : undefined}
                          step={f.type === 'number' ? f.step : undefined}
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                          disabled={isPending}
                        />
                      )}
                      {f.hint && (
                        <p className="text-xs text-gray-500 mt-1">{f.hint}</p>
                      )}
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-800">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={closeEditor}
                disabled={isPending}
                className="px-3 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isPending || populatedCount === 0}
                className="px-3 py-2 text-sm text-gray-400 hover:text-red-400 disabled:opacity-30 disabled:hover:text-gray-400 transition"
              >
                Alle löschen
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {populatedCount}{' '}
                {populatedCount === 1 ? 'Override' : 'Overrides'}
              </span>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isPending ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
