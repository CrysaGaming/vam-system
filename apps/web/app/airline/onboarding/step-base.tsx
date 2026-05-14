'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toastError } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

import { completeBaseStep, skipOnboarding } from './actions';

interface Props {
  initialBase: string | null;
  hubs: ReadonlyArray<{ icao: string; name: string | null; isPrimary: boolean }>;
}

/**
 * Welle F / F4 Step 2: Home-base selection.
 *
 * Pilot wählt einen der airline.hubs als seine primary base. Display:
 *   - Radio-list aller hubs, primary-hub mit "(Airline Primary)" badge
 *   - Aktuelle selection vorausgewählt (sonst kein default — pilot
 *     muss explizit wählen)
 *   - "Keine wahl" als option = baseIcao bleibt null (jumpseat-flow
 *     wird beim ersten flight gegriffen)
 *
 * # Edge cases
 *
 *   - 0 hubs: empty-state mit hint "airline hat noch keine hubs" +
 *     skip-button als einzige action
 *   - 1 hub: trotzdem radio-list zeigen damit pilot bewusst entscheidet
 *     (auto-select wäre intransparent)
 */
export function StepBase({ initialBase, hubs }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(initialBase);
  const [pending, startTransition] = useTransition();

  function handleNext() {
    startTransition(async () => {
      try {
        const result = await completeBaseStep(selected);
        if (!result.success) {
          toastError(new Error(`Base-Wahl fehlgeschlagen: ${result.error}`));
          return;
        }
        router.push('/airline/onboarding?step=3');
      } catch (e) {
        toastError(e);
      }
    });
  }

  function handleBack() {
    router.push('/airline/onboarding?step=1');
  }

  function handleSkipAll() {
    if (!confirm('Wizard komplett überspringen? Du kannst die Felder später in den Einstellungen ändern.')) {
      return;
    }
    startTransition(async () => {
      try {
        await skipOnboarding();
        router.push('/dashboard');
      } catch (e) {
        toastError(e);
      }
    });
  }

  return (
    <Card className="gap-5 p-6">
      <div>
        <h2 className="text-lg font-semibold">Wähle deine Home-Base</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deine primary base bestimmt wo deine flüge starten und wo wir
          dich nach einem PIREP "zuhause" platzieren. Du kannst sie
          jederzeit in den Einstellungen ändern.
        </p>
      </div>

      {hubs.length === 0 ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          Deine Airline hat aktuell keine Hubs konfiguriert. Sprich mit
          einem Airline-Admin damit Hubs angelegt werden — dann kannst
          du eine Base wählen.
        </div>
      ) : (
        <fieldset className="space-y-2" disabled={pending}>
          <legend className="sr-only">Base auswählen</legend>
          {hubs.map((h) => (
            <label
              key={h.icao}
              className={`flex cursor-pointer items-start gap-3 rounded border p-3 transition ${
                selected === h.icao
                  ? 'border-indigo-500 bg-indigo-500/5'
                  : 'border-border hover:bg-muted/30'
              }`}
            >
              <input
                type="radio"
                name="base"
                value={h.icao}
                checked={selected === h.icao}
                onChange={() => setSelected(h.icao)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-semibold">{h.icao}</span>
                  {h.isPrimary && (
                    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                      Airline Primary
                    </span>
                  )}
                </div>
                {h.name && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{h.name}</p>
                )}
              </div>
            </label>
          ))}

          {/* Opt-out: keine base. Wird selten gewählt aber sinnvoll
              für piloten die noch unentschieden sind. */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded border p-3 transition ${
              selected === null
                ? 'border-indigo-500 bg-indigo-500/5'
                : 'border-border hover:bg-muted/30'
            }`}
          >
            <input
              type="radio"
              name="base"
              value=""
              checked={selected === null}
              onChange={() => setSelected(null)}
              className="mt-1"
            />
            <div className="flex-1">
              <span className="text-sm italic text-muted-foreground">
                Vorerst keine Base wählen
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Du kannst sie später jederzeit setzen.
              </p>
            </div>
          </label>
        </fieldset>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={handleBack} disabled={pending}>
            ← Zurück
          </Button>
          <Button type="button" variant="ghost" onClick={handleSkipAll} disabled={pending}>
            Wizard überspringen
          </Button>
        </div>
        <Button type="button" onClick={handleNext} disabled={pending}>
          Weiter →
        </Button>
      </div>
    </Card>
  );
}
