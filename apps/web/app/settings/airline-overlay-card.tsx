'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { SimBriefOverlay } from '@/lib/simbrief/overlay';

import { updateAirlineSimBriefOverlay } from './actions';
import {
  SECTIONS,
  overlayToFormValues,
  formValuesToOverlay,
  toSelectValue,
  fromSelectValue,
} from './_overlay-fields';

interface Props {
  initial: SimBriefOverlay;
}

export function AirlineOverlayCard({ initial }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    overlayToFormValues(initial),
  );
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; msg: string }[]>([]);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const setField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Reset feedback on edit so stale banners don't linger
    if (success) setSuccess(false);
    if (error) setError(null);
    if (issues.length > 0) setIssues([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssues([]);
    setSuccess(false);

    const overlay = formValuesToOverlay(values);

    startTransition(async () => {
      const result = await updateAirlineSimBriefOverlay(overlay);
      if (result.success) {
        setSuccess(true);
        // Refresh server-component data so any other Sections relying
        // on the airline state see the new values
        router.refresh();
      } else {
        if (result.error === 'unauthorized')
          setError('Nicht angemeldet — Seite neu laden.');
        else if (result.error === 'no_airline')
          setError('Du bist keiner Airline zugeordnet. Frag den Admin.');
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

  const handleReset = () => {
    setValues(overlayToFormValues({}));
  };

  // Count populated fields for the header summary
  const populatedCount = Object.values(values).filter((v) => v !== '').length;

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
      >
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold">SimBrief Override (Airline)</h3>
        <span className="mt-1 text-xs text-muted-foreground">
          {populatedCount}{' '}
          {populatedCount === 1 ? 'Override' : 'Overrides'} aktiv
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Ebene 1 der 4-stufigen Override-Hierarchie. Wird bei jedem SimBrief-
        Dispatch als Floor verwendet und durch Fleet (Ebene 2), Aircraft
        (Ebene 3) oder Route (Ebene 4) überschrieben. Leere Felder = keine
        Vorgabe, SimBrief-Account-Defaults greifen.
      </p>

      {success && (
        <Alert className="border-green-500/30 bg-green-500/10">
          <AlertDescription className="text-green-700 dark:text-green-300">
            Gespeichert.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert
          variant="destructive"
          className="border-red-500/30 bg-red-500/10"
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
                const fieldId = `airline-overlay-${f.key as string}`;
                return (
                  <div key={f.key as string}>
                    <Label
                      htmlFor={fieldId}
                      className="mb-1 block text-sm font-medium"
                    >
                      {f.label}
                    </Label>
                    {f.type === 'select' ? (
                      <Select
                        value={toSelectValue(values[f.key as string] ?? '')}
                        onValueChange={(v) =>
                          setField(f.key as string, fromSelectValue(v))
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger id={fieldId} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {f.options.map((o) => (
                            <SelectItem
                              key={o.value}
                              value={toSelectValue(o.value)}
                            >
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirmingReset(true)}
          disabled={isPending || populatedCount === 0}
          className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
        >
          Alle löschen
        </Button>
        <Button
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Speichert…' : 'Speichern'}
        </Button>
      </div>
      </form>
      <ConfirmDialog
        open={confirmingReset}
        onOpenChange={setConfirmingReset}
        title="Alle Airline-Overrides löschen?"
        description="Alle Felder werden zurückgesetzt. Routen-Overrides (Ebene 4) bleiben unberührt."
        confirmLabel="Löschen"
        destructive
        onConfirm={handleReset}
      />
    </>
  );
}
