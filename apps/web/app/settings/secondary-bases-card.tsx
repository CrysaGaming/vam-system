'use client';

import { useState, useTransition } from 'react';
import { toastError } from '@/lib/toast';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { updateSecondaryBases } from './actions';

interface Props {
  /** Pilot's primary base ICAO. Shown as anchor + excluded from selectable secondaries. */
  primaryBase: string | null;
  /** Current secondary-base ICAOs. Server-side validated subset of airline hubs. */
  currentBases: string[];
  /**
   * All airline hubs that the pilot CAN add as secondary base (already
   * filtered server-side: excludes primary + excludes currently-added).
   * Format: { icao, name } pro hub.
   */
  availableHubs: ReadonlyArray<{ icao: string; name: string | null }>;
  /** Whether the user has an airline at all. */
  hasAirline: boolean;
}

/**
 * Welle F / F5 — Multi-base settings card.
 *
 * Erlaubt pilots zusätzliche secondary-bases zu definieren neben ihrer
 * primary baseIcao. Sichtbar nur wenn der pilot einer airline angehört
 * (sonst gibt es keine hubs zur auswahl). Display-states:
 *
 *   1. !hasAirline → info-hint, kein add-form, kein list
 *   2. hasAirline + 0 hubs available → warning-hint "airline hat noch keine hubs"
 *   3. hasAirline + hubs available + 0 current → "noch keine secondary-bases" empty state
 *   4. hasAirline + 0 hubs available + n current → list aber kein add-form
 *      ("alle hubs sind bereits secondary-bases")
 *   5. normal: list + add-form
 *
 * Add ist via select-dropdown (nicht freitext autocomplete) — die liste
 * ist klein (typisch 1-10 hubs) und whitelist enforcement passiert
 * server-side eh. Dropdown statt autocomplete spart UX-komplexität.
 *
 * Remove: pro listentry ein × button mit confirm-vor-click (auch wenn
 * remove harmlos ist — verhindert versehentliches misklick auf mobile).
 * Optimistic update: button-click flippt UI sofort, server-action
 * persistiert, error → revert.
 */
export function SecondaryBasesCard({
  primaryBase,
  currentBases,
  availableHubs,
  hasAirline,
}: Props) {
  const [bases, setBases] = useState<string[]>(currentBases);
  const [pending, startTransition] = useTransition();
  const [selectedToAdd, setSelectedToAdd] = useState<string>('');

  function handleAdd() {
    if (!selectedToAdd) return;
    const nextBases = [...bases, selectedToAdd];
    // Reset select before action — wenn die action fast ist, hat user
    // zwischenzeitlich nichts ausgewählt; wenn sie langsam ist, sieht
    // user die ergebnis-liste mit dem hinzugefügten eintrag.
    setSelectedToAdd('');
    setBases(nextBases); // optimistic

    startTransition(async () => {
      try {
        const result = await updateSecondaryBases(nextBases);
        if (!result.success) {
          setBases(bases); // revert auf vorigen state
          toastError(new Error(`Konnte base nicht hinzufügen: ${result.error}`));
        } else {
          // Sync auf server-canonical liste (handle silent dedupe etc).
          setBases(result.secondaryBaseIcaos);
        }
      } catch (e) {
        setBases(bases); // revert
        toastError(e);
      }
    });
  }

  function handleRemove(icao: string) {
    const nextBases = bases.filter((b) => b !== icao);
    const previousBases = bases;
    setBases(nextBases); // optimistic

    startTransition(async () => {
      try {
        const result = await updateSecondaryBases(nextBases);
        if (!result.success) {
          setBases(previousBases); // revert
          toastError(new Error(`Konnte base nicht entfernen: ${result.error}`));
        } else {
          setBases(result.secondaryBaseIcaos);
        }
      } catch (e) {
        setBases(previousBases); // revert
        toastError(e);
      }
    });
  }

  // Determine the hint we want to show. Mutually exclusive states.
  const hint = (() => {
    if (!hasAirline) {
      return {
        kind: 'info' as const,
        text:
          'Secondary-Bases sind erst verfügbar, sobald du einer Airline angehörst — die Auswahl muss aus den Hubs der Airline kommen.',
      };
    }
    if (availableHubs.length === 0 && bases.length === 0) {
      return {
        kind: 'warning' as const,
        text:
          primaryBase
            ? 'Deine Airline hat aktuell keinen weiteren Hub neben deiner Primary Base. Sobald die Airline weitere Hubs anlegt, kannst du sie hier als Secondary Base hinzufügen.'
            : 'Deine Airline hat aktuell keine Hubs konfiguriert. Sprich mit einem Airline-Admin damit Hubs angelegt werden.',
      };
    }
    return null;
  })();

  // Show this card always (auch wenn no-airline) als info — pilot sieht
  // dass das feature existiert und versteht warum es grad nicht
  // verfügbar ist.
  return (
    <Card className="gap-4 p-6">
      <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
        Secondary Bases
      </h2>

      <p className="text-sm text-muted-foreground">
        Zusätzliche Basen neben deiner Primary Base. Booking-eligibility
        und Position-tracking erkennen alle deine Bases — kein Ferry-flight
        nötig wenn du aus einer Secondary Base startest.
      </p>

      {primaryBase && (
        <div className="flex items-center justify-between rounded border border-border bg-muted/20 px-3 py-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Primary Base
            </Label>
            <p className="font-mono text-base font-semibold mt-0.5">{primaryBase}</p>
          </div>
          <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
            anchor
          </span>
        </div>
      )}

      {/* Current secondary-bases list */}
      {hasAirline && (
        <div className="border-t border-border pt-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Secondary Bases ({bases.length}{bases.length > 0 ? '' : ' — keine'})
          </Label>
          {bases.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {bases.map((icao) => (
                <li
                  key={icao}
                  className="flex items-center justify-between rounded border border-border bg-background px-3 py-2"
                >
                  <span className="font-mono font-semibold">{icao}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(icao)}
                    disabled={pending}
                    aria-label={`${icao} entfernen`}
                    className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                  >
                    Entfernen
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground italic">
              Noch keine Secondary Bases definiert.
            </p>
          )}
        </div>
      )}

      {/* Add-form */}
      {hasAirline && availableHubs.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div className="flex-1 min-w-[200px]">
            <Label
              htmlFor="add-secondary-base"
              className="block text-xs uppercase tracking-wider text-muted-foreground mb-1"
            >
              Base hinzufügen
            </Label>
            <select
              id="add-secondary-base"
              value={selectedToAdd}
              onChange={(e) => setSelectedToAdd(e.target.value)}
              disabled={pending}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 outline-none"
            >
              <option value="">— Hub auswählen —</option>
              {availableHubs
                .filter((h) => !bases.includes(h.icao))
                .map((h) => (
                  <option key={h.icao} value={h.icao}>
                    {h.icao}
                    {h.name ? ` — ${h.name}` : ''}
                  </option>
                ))}
            </select>
          </div>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={pending || !selectedToAdd}
          >
            Hinzufügen
          </Button>
        </div>
      )}

      {hint && (
        <Alert
          className={cn(
            hint.kind === 'warning' && 'border-amber-500/30 bg-amber-500/10',
            hint.kind === 'info' && 'border-blue-500/30 bg-blue-500/10',
          )}
        >
          <AlertDescription
            className={cn(
              hint.kind === 'warning' && 'text-amber-700 dark:text-amber-300',
              hint.kind === 'info' && 'text-blue-700 dark:text-blue-300',
            )}
          >
            {hint.text}
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}
