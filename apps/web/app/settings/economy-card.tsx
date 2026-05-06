'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { setUserEconomyEnabled } from './actions';

interface Props {
  initialEnabled: boolean;
  /**
   * Status der airline-flag (Airline.economyEnabled). Wird vom server-
   * component beim render geladen und runter-gepasst. Wenn user keine
   * airline hat → null.
   */
  airlineEconomyEnabled: boolean | null;
  /**
   * Whether der user überhaupt eine airline hat. Wenn null, ist
   * der toggle harmlos aber wirkungslos — wir zeigen einen hint dass
   * eine airline-zugehörigkeit voraussetzung ist.
   */
  hasAirline: boolean;
}

/**
 * Welle 13D-1: User-level economy opt-in. Toggle für User.economyEnabled.
 *
 * Drei UI-states (kombiniert):
 *
 *   1. user-toggle off → grauer button, keine wallet-card im dashboard,
 *      keine economy-events bei PIREP-approval. Default für alle existing
 *      users.
 *   2. user-toggle on, aber airline.economyEnabled=false → toggle ist
 *      sichtbar an, aber prominenter hint dass die airline-flag noch off
 *      ist. UI zeigt user dass der toggle aktuell wirkungslos ist.
 *   3. beide flags an → wallet-features sind aktiv. Dashboard zeigt
 *      WalletCard, /wallet ist erreichbar, processFlightEconomy bucht
 *      transactions.
 *
 * Bewusst NICHT in eine eigene tab eingeordnet: economy ist persönlich
 * und gehört in den profil-bereich. Wenn später UI-präferenzen für
 * economy dazukommen (z.B. \"verstecke wallet im dashboard\", \"zeige
 * preise in EUR statt VAM$\"), wird das hier erweitert.
 */
export function EconomyCard({
  initialEnabled,
  airlineEconomyEnabled,
  hasAirline,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  function handleToggle(newValue: boolean) {
    // Optimistic update — UI flippt sofort, server-action revertiert
    // bei error.
    setEnabled(newValue);

    startTransition(async () => {
      try {
        await setUserEconomyEnabled(newValue);
      } catch (e) {
        setEnabled(!newValue); // revert
        // Track 3 #11.2.3 vNext: error → toast statt inline-Alert.
        // Server-fehler sind transient (network/perm-issue), gehören
        // nicht permanent in die UI. Hint-message darunter (success/
        // warning/info) bleibt persistent weil das den state des
        // toggles erklärt, nicht ein fehlerhaftes commit.
        toast.error(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  // Hint-zustand: was zeigen wir dem user?
  const hintMessage = (() => {
    if (!enabled) {
      return null;
    }
    if (!hasAirline) {
      return {
        kind: 'warning' as const,
        text:
          'Du bist (noch) keiner Airline zugeordnet — der Toggle ist gesetzt, aber Wallet-Features greifen erst sobald du einer Airline beitrittst, die Economy aktiviert hat.',
      };
    }
    if (airlineEconomyEnabled === false) {
      return {
        kind: 'info' as const,
        text:
          'Deine Airline hat Economy noch nicht aktiviert — Wallet-Features sind erst aktiv wenn deine Airline-Admin den Toggle in der Airline-Verwaltung umlegt. Dein persönlicher Toggle bleibt vorgemerkt.',
      };
    }
    return {
      kind: 'success' as const,
      text:
        'Wallet-Features sind aktiv. PIREPs werden ab jetzt automatisch in dein Wallet gebucht (Salary) sobald sie approved sind.',
    };
  })();

  return (
    <Card className="gap-4 p-6">
      <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
        Economy (Beta)
      </h2>

      <p className="text-sm text-muted-foreground">
        VAM$-Wallet, Salary-Auszahlungen, Revenue-/Expense-Tracking pro Flug.
        Aktivieren ist <strong>opt-in</strong> — solange der Toggle aus ist,
        siehst du keine Geld-UI und es werden keine Transactions gebucht.
        Existing PIREPs werden NICHT retroaktiv verarbeitet, nur künftige
        Approvals.
      </p>

      <div className="flex items-start justify-between gap-4 border-t border-border py-3">
        <div className="flex-1">
          <Label
            htmlFor="economy-enabled"
            className="text-sm font-medium text-foreground"
          >
            Economy für mich aktivieren
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Persönlicher Opt-In. Sowohl dieser Toggle als auch der
            Airline-weite Toggle müssen aktiviert sein, damit Wallet-Features
            wirksam werden.
          </p>
        </div>

        <Switch
          id="economy-enabled"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={pending}
          aria-label="Economy aktivieren"
        />
      </div>

      {hintMessage && (
        <Alert
          className={cn(
            hintMessage.kind === 'success' &&
              'border-green-500/30 bg-green-500/10',
            hintMessage.kind === 'warning' &&
              'border-amber-500/30 bg-amber-500/10',
            hintMessage.kind === 'info' &&
              'border-blue-500/30 bg-blue-500/10',
          )}
        >
          <AlertDescription
            className={cn(
              hintMessage.kind === 'success' &&
                'text-green-700 dark:text-green-300',
              hintMessage.kind === 'warning' &&
                'text-amber-700 dark:text-amber-300',
              hintMessage.kind === 'info' && 'text-blue-700 dark:text-blue-300',
            )}
          >
            {hintMessage.text}
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}
