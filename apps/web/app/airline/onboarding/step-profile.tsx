'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toastError } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

import { completeProfileStep, skipOnboarding } from './actions';

interface Props {
  initialName: string | null;
  initialBio: string | null;
}

/**
 * Welle F / F4 Step 1: Profile-Vervollständigung.
 *
 * Erste page des onboarding-wizards. Pilot kann hier name + bio
 * setzen oder updaten. Beide felder sind optional und zeigen pre-
 * existing werte (z.B. Discord-name als default für name).
 *
 * # Validation
 *
 * Bio cap 500 zeichen → server enforced + client preview-counter.
 * Name kann nicht geleert werden — wenn input leer, behält server
 * den existing namen (sonst hätten wir kein display-name mehr).
 *
 * # Navigation
 *
 * "Weiter" → save + step=2 (base). "Überspringen" → skipOnboarding +
 * /dashboard (kompletter wizard-skip, nicht nur ein step). Bewusst
 * KEIN "zurück"-button im ersten step weil es kein vorheriger gibt.
 */
export function StepProfile({ initialName, initialBio }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? '');
  const [bio, setBio] = useState(initialBio ?? '');
  const [pending, startTransition] = useTransition();
  const bioCharsLeft = 500 - bio.length;

  function handleNext() {
    startTransition(async () => {
      try {
        const result = await completeProfileStep({
          name: name.trim() || null,
          bio: bio.trim() || null,
        });
        if (!result.success) {
          toastError(new Error(`Profil-Update fehlgeschlagen: ${result.error}`));
          return;
        }
        router.push('/airline/onboarding?step=2');
      } catch (e) {
        toastError(e);
      }
    });
  }

  function handleSkipAll() {
    if (!confirm('Wizard komplett überspringen? Du kannst die Felder später in den Einstellungen ändern.')) {
      return;
    }
    startTransition(async () => {
      try {
        const result = await skipOnboarding();
        if (!result.success) {
          toastError(new Error(`Skip fehlgeschlagen: ${result.error}`));
          return;
        }
        router.push('/dashboard');
      } catch (e) {
        toastError(e);
      }
    });
  }

  return (
    <Card className="gap-5 p-6">
      <div>
        <h2 className="text-lg font-semibold">Dein Profil</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wie sollen dich andere Piloten in der Airline sehen? Beides ist
          optional — du kannst es jederzeit in den Einstellungen ändern.
        </p>
      </div>

      <div>
        <Label htmlFor="onboarding-name" className="text-sm font-medium">
          Pilot-Name
        </Label>
        <input
          id="onboarding-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          maxLength={80}
          placeholder="z.B. Max Mustermann"
          className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 outline-none"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Dein anzeigename auf PIREPs, leaderboards und im chat. Wenn du
          das feld leer lässt, bleibt dein Discord-name erhalten.
        </p>
      </div>

      <div>
        <Label htmlFor="onboarding-bio" className="text-sm font-medium">
          Bio
        </Label>
        <textarea
          id="onboarding-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={pending}
          rows={4}
          maxLength={500}
          placeholder="Kurze beschreibung — z.B. liebst du long-haul, fliegst du gerne IFR auf VATSIM, hobbys etc."
          className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 outline-none resize-none"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {bioCharsLeft >= 0 ? `${bioCharsLeft} Zeichen übrig` : `${-bioCharsLeft} Zeichen zu viel`}
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={handleSkipAll} disabled={pending}>
          Wizard überspringen
        </Button>
        <Button type="button" onClick={handleNext} disabled={pending}>
          Weiter →
        </Button>
      </div>
    </Card>
  );
}
