'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  upsertFleetSimBriefOverlay,
  deleteFleetSimBriefOverlay,
} from './actions';
import {
  SECTIONS,
  overlayToFormValues,
  formValuesToOverlay,
} from './_overlay-fields';
import type { SimBriefOverlay } from '@/lib/simbrief/overlay';

interface FleetSummary {
  id: string;
  type: string;
  overlay: SimBriefOverlay;
  populatedCount: number;
}

interface Props {
  initial: FleetSummary[];
}

/**
 * Editor mode discriminator. `null` = no editor open. `{ kind: 'new' }`
 * = create-new form. `{ kind: 'edit', fleetId }` = editing existing.
 *
 * One editor at a time keeps the page from sprouting many partial
 * forms; encourages save-or-cancel before moving on.
 */
type EditorState =
  | null
  | { kind: 'new' }
  | { kind: 'edit'; fleetId: string };

export function FleetOverlayCard({ initial }: Props) {
  const router = useRouter();
  const [fleets, setFleets] = useState(initial);
  const [editor, setEditor] = useState<EditorState>(null);
  const [typeInput, setTypeInput] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; msg: string }[]>([]);
  const [isPending, startTransition] = useTransition();

  const openNew = () => {
    setEditor({ kind: 'new' });
    setTypeInput('');
    setValues(overlayToFormValues({}));
    setError(null);
    setIssues([]);
  };

  const openEdit = (fleet: FleetSummary) => {
    setEditor({ kind: 'edit', fleetId: fleet.id });
    setTypeInput(fleet.type);
    setValues(overlayToFormValues(fleet.overlay));
    setError(null);
    setIssues([]);
  };

  const closeEditor = () => {
    setEditor(null);
    setTypeInput('');
    setValues({});
    setError(null);
    setIssues([]);
  };

  const setField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
    if (issues.length > 0) setIssues([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssues([]);

    const cleanType = typeInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,4}$/.test(cleanType)) {
      setError('Type muss 2–4 Buchstaben/Ziffern sein (z. B. A320, B738).');
      return;
    }

    // For "new", reject if a fleet with this type already exists locally.
    // The server upsert would silently update the existing row otherwise,
    // which would surprise the user (they think they're creating new).
    if (editor?.kind === 'new' && fleets.some((f) => f.type === cleanType)) {
      setError(`Eintrag für ${cleanType} existiert bereits — wähle "Bearbeiten" stattdessen.`);
      return;
    }

    const overlay = formValuesToOverlay(values);

    startTransition(async () => {
      const result = await upsertFleetSimBriefOverlay(cleanType, overlay);
      if (result.success) {
        // Refresh from server so we get the canonical list (handles
        // create-new vs edit-existing without local-state bookkeeping)
        router.refresh();
        closeEditor();
        // Optimistic local update so the list reflects immediately
        // before router.refresh() completes
        setFleets((prev) => {
          const populatedCount = Object.keys(overlay).length;
          const existing = prev.findIndex((f) => f.type === cleanType);
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = {
              ...next[existing],
              overlay,
              populatedCount,
            };
            return next;
          }
          return [
            ...prev,
            { id: result.fleetId, type: cleanType, overlay, populatedCount },
          ].sort((a, b) => a.type.localeCompare(b.type));
        });
      } else {
        if (result.error === 'unauthorized')
          setError('Nicht angemeldet — Seite neu laden.');
        else if (result.error === 'no_airline')
          setError('Du bist keiner Airline zugeordnet.');
        else if (result.error === 'invalid_type')
          setError('Type ungültig. ICAO-Designator (2–4 Zeichen).');
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

  const handleDelete = (fleet: FleetSummary) => {
    if (
      !confirm(
        `Fleet-Eintrag "${fleet.type}" mit ${fleet.populatedCount} Override${fleet.populatedCount === 1 ? '' : 's'} löschen?`,
      )
    )
      return;

    startTransition(async () => {
      const result = await deleteFleetSimBriefOverlay(fleet.id);
      if (result.success) {
        setFleets((prev) => prev.filter((f) => f.id !== fleet.id));
        if (editor?.kind === 'edit' && editor.fleetId === fleet.id) {
          closeEditor();
        }
        router.refresh();
      } else {
        setError(`Löschen fehlgeschlagen: ${result.error}`);
      }
    });
  };

  // Count populated fields for the editor save-disable logic
  const populatedCount = Object.values(values).filter((v) => v !== '').length;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold">SimBrief Override (Fleet)</h3>
        <span className="text-xs text-gray-500 mt-1">
          {fleets.length}{' '}
          {fleets.length === 1 ? 'Eintrag' : 'Einträge'}
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Ebene 2 der Override-Hierarchie. Pro ICAO-Type (z. B. A320, B738)
        ein Eintrag. Überschreibt Airline-Defaults, wird selbst durch
        Aircraft (Ebene 3) und Route (Ebene 4) überschrieben.
      </p>

      {fleets.length === 0 && !editor && (
        <div className="text-sm text-gray-500 italic mb-4 px-3 py-4 border border-dashed border-gray-800 rounded text-center">
          Keine Fleet-Overrides definiert.
        </div>
      )}

      {fleets.length > 0 && (
        <ul className="divide-y divide-gray-800 mb-4">
          {fleets.map((fleet) => (
            <li
              key={fleet.id}
              className="py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-medium text-base">
                  {fleet.type}
                </span>
                <span className="text-xs text-gray-500">
                  {fleet.populatedCount}{' '}
                  {fleet.populatedCount === 1 ? 'Override' : 'Overrides'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(fleet)}
                  disabled={isPending}
                  className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-50"
                >
                  Bearbeiten
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(fleet)}
                  disabled={isPending}
                  className="px-3 py-1 text-sm text-gray-400 hover:text-red-400 disabled:opacity-30 transition"
                >
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!editor && (
        <button
          type="button"
          onClick={openNew}
          disabled={isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium disabled:opacity-50 transition"
        >
          + Neuer Fleet-Eintrag
        </button>
      )}

      {editor && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 pt-4 border-t border-gray-800"
        >
          <h4 className="text-base font-semibold mb-4">
            {editor.kind === 'new'
              ? 'Neuer Fleet-Eintrag'
              : `Fleet bearbeiten: ${typeInput}`}
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

          {editor.kind === 'new' && (
            <div className="mb-6">
              <label className="block text-sm font-medium mb-1">
                ICAO Type Designator
              </label>
              <input
                type="text"
                value={typeInput}
                onChange={(e) => setTypeInput(e.target.value.toUpperCase())}
                placeholder="A320"
                maxLength={4}
                className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm uppercase font-mono focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                disabled={isPending}
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                2–4 Zeichen, z. B. A320, B738, A359, CRJ7.
              </p>
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
            <button
              type="button"
              onClick={closeEditor}
              disabled={isPending}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 transition"
            >
              Abbrechen
            </button>
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
