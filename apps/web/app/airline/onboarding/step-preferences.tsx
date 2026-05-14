'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toastError } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

import { completePreferencesStep, skipOnboarding } from './actions';

interface Props {
  initialEconomy: boolean;
  initialCareer: boolean;
  airlineEconomyEnabled: boolean;
  airlineCareerEnabled: boolean;
}

/**
 * Welle F / F4 Step 3: Preferences.
 *
 * Pilot wählt opt-ins für Economy + Career. Beide haben dual-flag-
 * model (siehe EconomyCard/CareerCard im settings):
 *   - User-toggle wird gesetzt, aber wirkt nur wenn airline-toggle
 *     auch true ist.
 *
 * UI-pattern: für jeden flag zeigt eine card den toggle + hint-text
 * der erklärt was passiert wenn enabled, plus warning wenn airline-
 * flag noch off ist.
 *
 * # No-op edge case
 *
 * Wenn BEIDE airline-flags off sind, ist dieser step trivial — pilot
 * sieht ein hint "deine airline nutzt aktuell weder Economy noch
 * Career, du kannst direkt weiter" und kann mit defaults weiter.
 */
export function StepPreferences({
  initialEconomy,
  initialCareer,
  airlineEconomyEnabled,
  airlineCareerEnabled,
}: Props) {
  const router = useRouter();
  const [economy, setEconomy] = useState(initialEconomy);
  const [career, setCareer] = useState(initialCareer);
  const [pending, startTransition] = useTransition();

  const bothAirlineFlagsOff = !airlineEconomyEnabled && !airlineCareerEnabled;

  function handleNext() {
    startTransition(async () => {
      try {
        const result = await completePreferencesStep({
          economyEnabled: economy,
          careerEnabled: career,
        });
        if (!result.success) {
          toastError(new Error(`Preferences-Update fehlgeschlagen: ${result.error}`));
          return;
        }
        router.push('/airline/onboarding?step=4');
      } catch (e) {
        toastError(e);
      }
    });
  }

  function handleBack() {
    router.push('/airline/onboarding?step=2');
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
        <h2 className="text-lg font-semibold">Optional: Features aktivieren</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Zwei opt-in features die deine Erfahrung formen. Du kannst sie
          jederzeit später in den Einstellungen umschalten.
        </p>
      </div>

      {bothAirlineFlagsOff && (
        <div className="rounded border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
          Deine Airline hat aktuell weder Economy noch Career aktiviert.
          Deine Toggles werden gespeichert, greifen aber erst sobald
          ein Airline-Admin die jeweilige Funktion freischaltet.
        </div>
      )}

      {/* Economy toggle */}
      <div className="rounded border border-border bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label htmlFor="onboarding-economy" className="text-sm font-semibold">
              Economy (VAM$-Wallet)
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Salary für deine Flüge, Revenue/Expense-Tracking, Wallet-
              Page. Mit jedem approved-PIREP werden Transactions auf
              dein Wallet gebucht.
            </p>
            {!airlineEconomyEnabled && economy && (
              <p className="mt-2 text-xs italic text-amber-700 dark:text-amber-300">
                Airline-Economy ist aktuell off — dein Toggle bleibt
                gespeichert und greift sobald die Airline aktiviert.
              </p>
            )}
          </div>
          <Switch
            id="onboarding-economy"
            checked={economy}
            onCheckedChange={setEconomy}
            disabled={pending}
            aria-label="Economy aktivieren"
          />
        </div>
      </div>

      {/* Career toggle */}
      <div className="rounded border border-border bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label htmlFor="onboarding-career" className="text-sm font-semibold">
              Career (Lizenzen + Type-Ratings)
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Lizenz-Progression (PPL → CPL → ATPL), Type-Ratings pro
              Aircraft-Family, Rank-Promotions basierend auf Flugstunden.
              Booking-gates verhindern Flüge ohne passende Lizenz.
            </p>
            {!airlineCareerEnabled && career && (
              <p className="mt-2 text-xs italic text-amber-700 dark:text-amber-300">
                Airline-Career ist aktuell off — dein Toggle bleibt
                gespeichert und greift sobald die Airline aktiviert.
              </p>
            )}
          </div>
          <Switch
            id="onboarding-career"
            checked={career}
            onCheckedChange={setCareer}
            disabled={pending}
            aria-label="Career aktivieren"
          />
        </div>
      </div>

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
