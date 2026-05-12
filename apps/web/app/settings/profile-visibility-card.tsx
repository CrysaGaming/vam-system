'use client';

import { useState, useTransition } from 'react';
import { setProfileVisibility } from './actions';

/**
 * Track 5 #11 (Section C): Public-Profile-Visibility-Card.
 *
 * Card im /settings die das User.isProfilePublic-flag toggelt. Default
 * false. Wenn enabled, ist /p/[userId] öffentlich zugänglich.
 *
 * Bewusst client-component statt server-action im form-action:
 *   - Optimistic-UI feel via useTransition (button shows "Speichert…")
 *   - Konsistent mit BioCard, EconomyCard, CareerCard patterns
 *   - Live status-toggle ohne page-reload
 *
 * Zeigt copy-link-button wenn enabled — ein klick kopiert die public-
 * profile-URL in die zwischenablage. Schreibt den absoluten URL via
 * window.location.origin, NICHT eine umgebungsvariable, weil das auf
 * cloudflared/preview-deployments natürlich funktioniert.
 */
export function ProfileVisibilityCard({
  userId,
  initialIsPublic,
}: {
  userId: string;
  initialIsPublic: boolean;
}) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !isPublic;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setProfileVisibility(next);
        if (result.success) {
          setIsPublic(next);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim speichern.');
      }
    });
  }

  async function handleCopyLink() {
    const url = `${window.location.origin}/p/${userId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 3000);
    }
  }

  return (
    <section
      id="profile"
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6"
    >
      <header className="mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          🪪 Öffentliches Profil
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Teile deine Karriere mit anderen außerhalb der Airline.
        </p>
      </header>

      <div className="flex items-start gap-4 mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold mb-1">
            {isPublic ? '✓ Profil ist öffentlich' : 'Profil ist privat'}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {isPublic ? (
              <>
                Jeder mit dem link kann deine basis-info, total flights/hours,
                top aircraft + letzte 5 flüge sehen. Email, economy + bookings
                bleiben privat.
              </>
            ) : (
              <>
                Nur du selbst und mitglieder deiner Airline sehen dein profil.
                Aktiviere dies um deinen public-link zu teilen.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={isPending}
          aria-pressed={isPublic}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
            isPublic
              ? 'bg-indigo-600 dark:bg-indigo-500'
              : 'bg-gray-300 dark:bg-gray-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
              isPublic ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>
      )}

      {isPublic && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Dein public-link:
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs px-2 py-1.5 bg-gray-100 dark:bg-gray-800 rounded font-mono flex-1 min-w-0 truncate">
              /p/{userId}
            </code>
            <button
              type="button"
              onClick={handleCopyLink}
              className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition whitespace-nowrap"
            >
              {copyState === 'copied'
                ? '✓ Kopiert'
                : copyState === 'error'
                  ? '✗ Fehler'
                  : '📋 Link kopieren'}
            </button>
            <a
              href={`/p/${userId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded transition whitespace-nowrap"
            >
              ↗ Öffnen
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
