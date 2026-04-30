'use client';

import { useState, useTransition } from 'react';
import { setSimBriefUsername } from './actions';

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

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function SimBriefCard({
  initialUsername,
  patternZAvailable,
  suggestedUsername,
}: Props) {
  const [currentUsername, setCurrentUsername] = useState<string | null>(
    initialUsername,
  );
  const [draft, setDraft] = useState<string>(initialUsername ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      setDraft(suggestedUsername.trim());
    }
  }

  function handleSave() {
    setStatus('saving');
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setSimBriefUsername({ username: trimmedDraft });
      if (result.success) {
        setCurrentUsername(trimmedDraft);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setStatus('error');
        setErrorMessage(formatError(result.error));
      }
    });
  }

  function handleClear() {
    setStatus('saving');
    setErrorMessage(null);
    startTransition(async () => {
      const result = await setSimBriefUsername({ username: null });
      if (result.success) {
        setCurrentUsername(null);
        setDraft('');
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setStatus('error');
        setErrorMessage(formatError(result.error));
      }
    });
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">SimBrief Account</h3>
        <SaveStatusBadge status={status} />
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Trage deinen SimBrief-Benutzernamen ein, damit VAM deine generierten
        Flight Plans mit deinen Buchungen verknüpfen kann. Den Benutzernamen
        findest du in deinem{' '}
        <a
          href="https://dispatch.simbrief.com/account"
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline"
        >
          SimBrief-Profil
        </a>
        .
      </p>

      <div className="flex gap-3 mb-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="z.B. CrysaGaming"
          disabled={isPending}
          maxLength={50}
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-sm font-medium transition"
        >
          Speichern
        </button>
        {canClear && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
          >
            Löschen
          </button>
        )}
      </div>

      {errorMessage && (
        <p className="text-sm text-red-400 mt-2">{errorMessage}</p>
      )}

      {/* Suggestion row — shown only for fresh accounts where Username
          is empty and we have a name from the login provider. The
          "Übernehmen"-link drops the suggestion into the draft input
          but does not submit; the user reviews and clicks Speichern.
          Designed to feel like a hint, not an instruction — text-tone
          matches the gray-400 helper-paragraph above. */}
      {showSuggestion && suggestedUsername && (
        <p className="text-xs text-gray-500 mt-3">
          Tipp: Dein SimBrief-Username ist oft gleich deinem Discord-
          Namen.{' '}
          <button
            type="button"
            onClick={applySuggestion}
            disabled={isPending}
            className="text-indigo-400 hover:text-indigo-300 underline font-mono disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {suggestedUsername} übernehmen
          </button>
        </p>
      )}

      {currentUsername && (
        <p className="text-xs text-gray-500 mt-3">
          Aktuell gespeichert:{' '}
          <span className="font-mono text-gray-400">{currentUsername}</span>
        </p>
      )}

      {/* Dispatch-Mode-Verfügbarkeit. The two-row indicator surfaces the
          deployment-level Pattern Z env-flag plus the per-user username
          state in one place — answers "why does my booking page show
          Pattern α only?" without the user having to dig through the
          booking flow. The popup-form on a booking page hides itself
          silently when not available; this card is where the user finds
          out why. */}
      <div className="mt-5 pt-4 border-t border-gray-800">
        <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
          Verfügbare Dispatch-Modi
        </p>
        <ul className="space-y-1.5 text-xs">
          <li className="flex items-baseline gap-2">
            <span
              className={
                currentUsername ? 'text-green-400' : 'text-gray-600'
              }
              aria-hidden
            >
              {currentUsername ? '●' : '○'}
            </span>
            <span className="text-gray-400">Pattern α (Tab-Redirect)</span>
            {!currentUsername && (
              <span className="text-gray-600">— Username fehlt</span>
            )}
          </li>
          <li className="flex items-baseline gap-2">
            <span
              className={
                patternZAvailable && currentUsername
                  ? 'text-green-400'
                  : 'text-gray-600'
              }
              aria-hidden
            >
              {patternZAvailable && currentUsername ? '●' : '○'}
            </span>
            <span className="text-gray-400">Pattern Z (Popup)</span>
            {!patternZAvailable && (
              <span className="text-gray-600">
                — SIMBRIEF_API_KEY nicht konfiguriert
              </span>
            )}
            {patternZAvailable && !currentUsername && (
              <span className="text-gray-600">— Username fehlt</span>
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  if (status === 'saving') {
    return <span className="text-xs text-gray-400">Speichern...</span>;
  }
  if (status === 'saved') {
    return <span className="text-xs text-green-400">✓ Gespeichert</span>;
  }
  return <span className="text-xs text-red-400">✗ Fehler</span>;
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
