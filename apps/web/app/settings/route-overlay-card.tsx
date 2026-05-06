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

import { updateRouteSimBriefOverlay } from './actions';
import {
  SECTIONS,
  overlayToFormValues,
  formValuesToOverlay,
} from './_overlay-fields';

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
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);

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
        <h3 className="text-lg font-semibold">SimBrief Override (Route)</h3>
        <span className="mt-1 text-xs text-muted-foreground">
          {routesWithOverridesCount} / {routes.length} mit Overrides
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Ebene 4 der Override-Hierarchie — höchste Präzedenz. Pro Route-Eintrag
        (z. B. LH600 EDDF→LOWW). Überschreibt alle anderen Ebenen. Routen
        werden vom Schedule-Management verwaltet, hier nur die Override-
        Werte editierbar.
      </p>

      {routes.length === 0 && (
        <div className="rounded border border-dashed border-border px-3 py-4 text-center text-sm italic text-muted-foreground">
          Keine Routen in deiner Airline registriert.
        </div>
      )}

      {routes.length > 0 && (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {routes.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between py-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-base font-medium">
                  {item.flightNumber}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {item.departureIcao} → {item.arrivalIcao}
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span
                  className={cn(
                    'text-xs',
                    item.populatedCount > 0
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-muted-foreground',
                  )}
                >
                  {item.populatedCount}{' '}
                  {item.populatedCount === 1 ? 'Override' : 'Overrides'}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openEdit(item)}
                disabled={isPending}
              >
                Bearbeiten
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editor && editingItem && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-border pt-4"
        >
          <h4 className="mb-4 text-base font-semibold">
            Route bearbeiten:{' '}
            <span className="font-mono">{editingItem.flightNumber}</span>{' '}
            <span className="font-mono text-sm font-normal text-muted-foreground">
              ({editingItem.departureIcao} → {editingItem.arrivalIcao})
            </span>
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
                    const fieldId = `route-overlay-${f.key as string}`;
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
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeEditor}
                disabled={isPending}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingClearAll(true)}
                disabled={isPending || populatedCount === 0}
                className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
              >
                Alle löschen
              </Button>
            </div>
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
        open={confirmingClearAll}
        onOpenChange={setConfirmingClearAll}
        title="Alle Overrides löschen?"
        description="Alle Overrides für diese Route werden zurückgesetzt. Die Route selbst bleibt unberührt."
        confirmLabel="Löschen"
        destructive
        onConfirm={handleClearAll}
      />
    </Card>
  );
}
