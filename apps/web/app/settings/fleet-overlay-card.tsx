'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { cn } from '@/lib/utils';
import type { SimBriefOverlay } from '@/lib/simbrief/overlay';

import {
  upsertFleetSimBriefOverlay,
  deleteFleetSimBriefOverlay,
} from './actions';
import {
  SECTIONS,
  overlayToFormValues,
  formValuesToOverlay,
} from './_overlay-fields';

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
  const [pendingDelete, setPendingDelete] = useState<FleetSummary | null>(null);

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
      setError(
        `Eintrag für ${cleanType} existiert bereits — wähle "Bearbeiten" stattdessen.`,
      );
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

  // Selectstyling-class — siehe Note in aircraft-overlay-card.tsx (selber
  // pattern: shadcn-Select kommt in eigenem sweep wenn _overlay-fields
  // sentinel-values bekommt).
  const selectClass = cn(
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm',
    'shadow-xs transition-[color,box-shadow] outline-none',
    'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'dark:bg-input/30',
  );

  return (
    <Card className="gap-4 p-6">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold">SimBrief Override (Fleet)</h3>
        <span className="mt-1 text-xs text-muted-foreground">
          {fleets.length} {fleets.length === 1 ? 'Eintrag' : 'Einträge'}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Ebene 2 der Override-Hierarchie. Pro ICAO-Type (z. B. A320, B738)
        ein Eintrag. Überschreibt Airline-Defaults, wird selbst durch
        Aircraft (Ebene 3) und Route (Ebene 4) überschrieben.
      </p>

      {fleets.length === 0 && !editor && (
        <div className="rounded border border-dashed border-border px-3 py-4 text-center text-sm italic text-muted-foreground">
          Keine Fleet-Overrides definiert.
        </div>
      )}

      {fleets.length > 0 && (
        <ul className="divide-y divide-border">
          {fleets.map((fleet) => (
            <li
              key={fleet.id}
              className="flex items-center justify-between py-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-base font-medium">
                  {fleet.type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fleet.populatedCount}{' '}
                  {fleet.populatedCount === 1 ? 'Override' : 'Overrides'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => openEdit(fleet)}
                  disabled={isPending}
                >
                  Bearbeiten
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDelete(fleet)}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                >
                  Löschen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!editor && (
        <Button
          type="button"
          onClick={openNew}
          disabled={isPending}
          className="w-fit"
        >
          + Neuer Fleet-Eintrag
        </Button>
      )}

      {editor && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-border pt-4"
        >
          <h4 className="mb-4 text-base font-semibold">
            {editor.kind === 'new'
              ? 'Neuer Fleet-Eintrag'
              : `Fleet bearbeiten: ${typeInput}`}
          </h4>

          {error && (
            <Alert
              variant="destructive"
              className="mb-4 border-red-500/30 bg-red-500/10"
            >
              <AlertDescription className="text-red-700 dark:text-red-300">
                {error}
                {issues.length > 0 && (
                  <ul className="ml-4 mt-2 list-disc text-xs">
                    {issues.map((i, idx) => (
                      <li key={idx}>
                        <code>{i.path}</code>: {i.msg}
                      </li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          {editor.kind === 'new' && (
            <div className="mb-6">
              <Label
                htmlFor="fleet-type-input"
                className="mb-1 block text-sm font-medium"
              >
                ICAO Type Designator
              </Label>
              <Input
                id="fleet-type-input"
                type="text"
                value={typeInput}
                onChange={(e) => setTypeInput(e.target.value.toUpperCase())}
                placeholder="A320"
                maxLength={4}
                className="w-32 font-mono uppercase"
                disabled={isPending}
                autoFocus
              />
              <p className="mt-1 text-xs text-muted-foreground">
                2–4 Zeichen, z. B. A320, B738, A359, CRJ7.
              </p>
            </div>
          )}

          <div className="space-y-8">
            {SECTIONS.map((section) => (
              <fieldset
                key={section.title}
                className="border-t border-border pt-4"
              >
                <legend className="-ml-2 mb-1 px-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </legend>
                <p className="mb-4 text-xs text-muted-foreground">
                  {section.description}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {section.fields.map((f) => {
                    const fieldId = `fleet-overlay-${f.key as string}`;
                    return (
                      <div key={f.key as string}>
                        <Label
                          htmlFor={fieldId}
                          className="mb-1 block text-sm font-medium"
                        >
                          {f.label}
                        </Label>
                        {f.type === 'select' ? (
                          <select
                            id={fieldId}
                            value={values[f.key as string] ?? ''}
                            onChange={(e) =>
                              setField(f.key as string, e.target.value)
                            }
                            className={selectClass}
                            disabled={isPending}
                          >
                            {f.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            id={fieldId}
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
                            disabled={isPending}
                          />
                        )}
                        {f.hint && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {f.hint}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeEditor}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {populatedCount}{' '}
                {populatedCount === 1 ? 'Override' : 'Overrides'}
              </span>
              <Button
                type="submit"
                disabled={isPending}
              >
                {isPending ? 'Speichert…' : 'Speichern'}
              </Button>
            </div>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Fleet-Eintrag löschen?"
        description={
          pendingDelete
            ? `"${pendingDelete.type}" mit ${pendingDelete.populatedCount} Override${pendingDelete.populatedCount === 1 ? '' : 's'} wird entfernt. Aircraft-Overrides für diesen Type bleiben unberührt.`
            : ''
        }
        confirmLabel="Löschen"
        destructive
        onConfirm={() => {
          if (pendingDelete) handleDelete(pendingDelete);
        }}
      />
    </Card>
  );
}
