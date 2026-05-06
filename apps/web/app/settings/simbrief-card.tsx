'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { setSimBriefUsername } from './actions';

/**
 * Client-side schema. Spiegelt grob die server-side validation in
 * actions.ts (max 50, allowed-chars-regex), plus erlaubt expliziten
 * leer-string ('') als valid input weil RHF's defaultValue '' ist.
 *
 * Track 3 #11.2.3 v1 demo: erste echte form-migration auf RHF + Zod.
 * Server validiert NOCHMAL mit eigenem zod-schema (siehe
 * SetSimBriefUsernameSchema in actions.ts) — client-validation hier
 * ist NUR für UX, nicht für security.
 *
 * Empty-string-handling: zod's regex matched '' (weil pattern endet
 * mit *), aber wir nutzen .or(z.literal('')) zur deutlicherer absicht.
 */
const SimBriefFormSchema = z.object({
  username: z
    .string()
    .trim()
    .max(50, 'Benutzername zu lang (max. 50 Zeichen)')
    .regex(
      /^[a-zA-Z0-9._-]*$/,
      'Nur Buchstaben, Zahlen, Unterstrich, Bindestrich und Punkt erlaubt',
    ),
});

type SimBriefFormData = z.infer<typeof SimBriefFormSchema>;

type Props = {
  initialUsername: string | null;
  /**
   * Whether the deployment has SIMBRIEF_API_KEY configured. Computed
   * server-side in settings/page.tsx so the client never sees the actual
   * key — only whether the popup-based dispatch flow is reachable on this
   * instance. Used purely for the availability indicator at the bottom of
   * the card.
   */
  patternZAvailable: boolean;
  /**
   * The user's name as known to VAM — typically their Discord username
   * (NextAuth populates User.name from the OAuth profile). Used to offer
   * a one-click suggestion when the SimBrief field is empty: many pilots
   * use the same handle on Discord and SimBrief, so prefilling saves the
   * trip to dispatch.simbrief.com/account just to copy a name.
   *
   * The suggestion is non-invasive — never auto-saved, just dropped into
   * the draft input where the user can confirm or override before clicking
   * Speichern. Hidden if name is null (rare, OAuth without a profile name)
   * or already matches the saved username (no point suggesting what's
   * already there).
   */
  suggestedUsername: string | null;
};

export function SimBriefCard({
  initialUsername,
  patternZAvailable,
  suggestedUsername,
}: Props) {
  const [currentUsername, setCurrentUsername] = useState<string | null>(
    initialUsername,
  );
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<SimBriefFormData>({
    resolver: zodResolver(SimBriefFormSchema),
    defaultValues: { username: initialUsername ?? '' },
    // onBlur: zod runs nach blur — verhindert error-flash bei jedem
    // keystroke. onSubmit als fallback wenn user direkt enter drückt.
    mode: 'onBlur',
  });

  const draft = watch('username') ?? '';
  const trimmedDraft = draft.trim();
  const hasChanges = trimmedDraft !== (currentUsername ?? '');
  const canSave = hasChanges && trimmedDraft.length > 0;
  const canClear = currentUsername !== null;

  // Suggestion logic — show only when:
  // 1. We have a name to suggest (typical: Discord-Username via NextAuth)
  // 2. There's no saved SimBrief username yet (currentUsername null)
  // 3. The user hasn't already typed something matching it (avoids the
  //    suggestion sticking around after the user picks it)
  // 4. The suggestion isn't identical to whatever is already in the draft
  const showSuggestion =
    !!suggestedUsername &&
    !currentUsername &&
    suggestedUsername.trim() !== trimmedDraft;

  function applySuggestion() {
    if (suggestedUsername) {
      // shouldDirty:true damit canSave (über hasChanges) sofort true
      // wird; shouldValidate:true damit zod das suggestion-value sofort
      // checkt (alle erlaubten chars bei Discord-Usernames, sollte
      // aber der safety-net bleiben).
      setValue('username', suggestedUsername.trim(), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  const onSave = handleSubmit((data) => {
    const value = data.username.trim();
    startTransition(async () => {
      const result = await setSimBriefUsername({ username: value });
      if (result.success) {
        setCurrentUsername(value);
        // reset mit neuem default — verhindert dass form weiterhin
        // dirty-flag trägt und canSave ungewollt true bleibt.
        reset({ username: value });
        toast.success('SimBrief-Username gespeichert');
      } else {
        toast.error(formatError(result.error));
      }
    });
  });

  function handleClear() {
    startTransition(async () => {
      const result = await setSimBriefUsername({ username: null });
      if (result.success) {
        setCurrentUsername(null);
        reset({ username: '' });
        toast.success('SimBrief-Username gelöscht');
      } else {
        toast.error(formatError(result.error));
      }
    });
  }

  return (
    <Card className="gap-4 p-6">
      <h3 className="text-lg font-semibold">SimBrief Account</h3>
      <p className="text-sm text-muted-foreground">
        Trage deinen SimBrief-Benutzernamen ein, damit VAM deine generierten
        Flight Plans mit deinen Buchungen verknüpfen kann. Den Benutzernamen
        findest du in deinem{' '}
        <a
          href="https://dispatch.simbrief.com/account"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          SimBrief-Profil
        </a>
        .
      </p>

      <form onSubmit={onSave} className="flex gap-3">
        <Label htmlFor="simbrief-username" className="sr-only">
          SimBrief-Benutzername
        </Label>
        <Input
          id="simbrief-username"
          type="text"
          {...register('username')}
          placeholder="z.B. CrysaGaming"
          disabled={isPending}
          maxLength={50}
          aria-invalid={!!errors.username}
          aria-describedby={errors.username ? 'simbrief-username-error' : undefined}
          className="flex-1 font-mono"
        />
        <Button type="submit" disabled={!canSave || isPending || !!errors.username}>
          Speichern
        </Button>
        {canClear && (
          <Button
            type="button"
            variant="secondary"
            onClick={handleClear}
            disabled={isPending}
          >
            Löschen
          </Button>
        )}
      </form>

      {/* Inline field-error (RHF + zod). Server-errors gehen über sonner-
          toast; das hier ist nur client-side schema-validation, also
          immer eine direkt-feedback-quelle nahe am input. */}
      {errors.username && (
        <p
          id="simbrief-username-error"
          className="text-xs text-destructive"
          role="alert"
        >
          {errors.username.message}
        </p>
      )}

      {/* Suggestion row — shown only for fresh accounts where Username
          is empty and we have a name from the login provider. The
          "Übernehmen"-link drops the suggestion into the draft input
          but does not submit; the user reviews and clicks Speichern.
          Designed to feel like a hint, not an instruction — text-tone
          matches the gray-400 helper-paragraph above. */}
      {showSuggestion && suggestedUsername && (
        <p className="text-xs text-muted-foreground">
          Tipp: Dein SimBrief-Username ist oft gleich deinem Discord-
          Namen.{' '}
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={applySuggestion}
            disabled={isPending}
            className="h-auto p-0 font-mono text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {suggestedUsername} übernehmen
          </Button>
        </p>
      )}

      {currentUsername && (
        <p className="text-xs text-muted-foreground">
          Aktuell gespeichert:{' '}
          <span className="font-mono">{currentUsername}</span>
        </p>
      )}

      {/* Dispatch-Mode-Verfügbarkeit. The two-row indicator surfaces the
          deployment-level Pattern Z env-flag plus the per-user username
          state in one place — answers "why does my booking page show
          Pattern α only?" without the user having to dig through the
          booking flow. The popup-form on a booking page hides itself
          silently when not available; this card is where the user finds
          out why. */}
      <div className="mt-1 border-t border-border pt-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
          Verfügbare Dispatch-Modi
        </p>
        <ul className="space-y-1.5 text-xs">
          <li className="flex items-baseline gap-2">
            <span
              className={cn(
                currentUsername
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-muted-foreground/60',
              )}
              aria-hidden
            >
              {currentUsername ? '●' : '○'}
            </span>
            <span className="text-muted-foreground">
              Pattern α (Tab-Redirect)
            </span>
            {!currentUsername && (
              <span className="text-muted-foreground/60">
                — Username fehlt
              </span>
            )}
          </li>
          <li className="flex items-baseline gap-2">
            <span
              className={cn(
                patternZAvailable && currentUsername
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-muted-foreground/60',
              )}
              aria-hidden
            >
              {patternZAvailable && currentUsername ? '●' : '○'}
            </span>
            <span className="text-muted-foreground">Pattern Z (Popup)</span>
            {!patternZAvailable && (
              <span className="text-muted-foreground/60">
                — SIMBRIEF_API_KEY nicht konfiguriert
              </span>
            )}
            {patternZAvailable && !currentUsername && (
              <span className="text-muted-foreground/60">
                — Username fehlt
              </span>
            )}
          </li>
        </ul>
      </div>
    </Card>
  );
}

function formatError(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Nicht angemeldet. Lade die Seite neu.';
    case 'invalid_input':
      return 'Eingabe ungültig.';
    case 'too_long':
      return 'Benutzername zu lang (max. 50 Zeichen).';
    case 'invalid_format':
      return 'Nur Buchstaben, Zahlen, Unterstrich, Bindestrich und Punkt erlaubt.';
    default:
      return `Unbekannter Fehler: ${code}`;
  }
}
