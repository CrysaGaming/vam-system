'use client';

import { useState, useTransition } from 'react';
import { setSimBriefUsername } from './actions';

type Props = {
  initialUsername: string | null;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function SimBriefCard({ initialUsername }: Props) {
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
        Flight Plans abrufen kann (Pattern α). Den Benutzernamen findest du in
        deinem{' '}
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

      {currentUsername && (
        <p className="text-xs text-gray-500 mt-3">
          Aktuell gespeichert:{' '}
          <span className="font-mono text-gray-400">{currentUsername}</span>
        </p>
      )}
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
