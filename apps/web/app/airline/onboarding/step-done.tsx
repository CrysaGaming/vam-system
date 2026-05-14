'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toastError } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { completeOnboarding } from './actions';

interface Props {
  airlineName: string;
  airlineIcao: string;
  /** ICAO of the chosen base, or null if user opted out. */
  pickedBase: string | null;
  /** Optional summary of which features the user enabled. */
  enabledFeatures: { economy: boolean; career: boolean };
}

/**
 * Welle F / F4 Step 4 (terminal): Done + What's next.
 *
 * Recap der wichtigen entscheidungen aus den ersten 3 steps + links
 * zu typical-next-actions (book flight, browse fleet, etc.). Button
 * "Fertig" triggert completeOnboarding (setzt timestamp) und
 * redirected zum dashboard.
 *
 * Optionaler "Zurück"-button damit der user etwas korrigieren kann
 * bevor er final commitet.
 */
export function StepDone({
  airlineName,
  airlineIcao,
  pickedBase,
  enabledFeatures,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleFinish() {
    startTransition(async () => {
      try {
        const result = await completeOnboarding();
        if (!result.success) {
          toastError(new Error(`Finish fehlgeschlagen: ${result.error}`));
          return;
        }
        router.push('/dashboard');
      } catch (e) {
        toastError(e);
      }
    });
  }

  function handleBack() {
    router.push('/airline/onboarding?step=3');
  }

  return (
    <Card className="gap-5 p-6">
      <div>
        <div className="mb-2 text-4xl">🎉</div>
        <h2 className="text-lg font-semibold">Willkommen bei {airlineName}!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Du bist Teil von {airlineName} ({airlineIcao}). Hier ist eine
          Zusammenfassung deiner Einstellungen und was als nächstes ansteht.
        </p>
      </div>

      {/* Summary card */}
      <div className="rounded border border-border bg-muted/20 p-4 text-sm">
        <h3 className="mb-2 font-semibold">Deine Einstellungen</h3>
        <ul className="space-y-1">
          <li className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Home-Base:</span>
            {pickedBase ? (
              <span className="font-mono font-semibold">{pickedBase}</span>
            ) : (
              <span className="italic text-muted-foreground">noch nicht gewählt</span>
            )}
          </li>
          <li className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Economy:</span>
            <span className={enabledFeatures.economy ? 'font-semibold' : 'text-muted-foreground'}>
              {enabledFeatures.economy ? 'aktiviert' : 'deaktiviert'}
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Career:</span>
            <span className={enabledFeatures.career ? 'font-semibold' : 'text-muted-foreground'}>
              {enabledFeatures.career ? 'aktiviert' : 'deaktiviert'}
            </span>
          </li>
        </ul>
      </div>

      {/* What's next links */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Was als nächstes?</h3>
        <ul className="space-y-2 text-sm">
          <li>
            <Link
              href="/bookings/new"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ✈️ Ersten Flug buchen
            </Link>
            <p className="ml-6 text-xs text-muted-foreground">
              Schau dir die Routen deiner Airline an und buche deinen
              ersten Flug.
            </p>
          </li>
          <li>
            <Link
              href="/dashboard"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              📊 Dashboard ansehen
            </Link>
            <p className="ml-6 text-xs text-muted-foreground">
              Übersicht über deine Stats, kommende Flüge und Airline-News.
            </p>
          </li>
          <li>
            <Link
              href="/settings"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ⚙️ Einstellungen anpassen
            </Link>
            <p className="ml-6 text-xs text-muted-foreground">
              Discord/VATSIM/IVAO verlinken, OBS-Overlay konfigurieren,
              SimBrief username setzen, Secondary-Bases hinzufügen.
            </p>
          </li>
          <li>
            <Link
              href="/live"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              🌍 Live-Map ansehen
            </Link>
            <p className="ml-6 text-xs text-muted-foreground">
              Sieh wo deine Kollegen gerade fliegen und welche Routen
              aktuell geflogen werden.
            </p>
          </li>
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={handleBack} disabled={pending}>
          ← Zurück
        </Button>
        <Button type="button" onClick={handleFinish} disabled={pending}>
          {pending ? 'Wird abgeschlossen…' : 'Fertig — zum Dashboard'}
        </Button>
      </div>
    </Card>
  );
}
