'use client';

import { useState, useTransition } from 'react';
import { setUserBio } from './actions';

/**
 * Track 4 #61 (Section L): Pilot-Bio editor card im /settings.
 *
 * Edit-mode + preview-mode toggle. Im edit-mode ist die textarea sichtbar
 * mit live char-count + save/cancel/clear actions. Im preview-mode zeigt
 * sie die bio als formatierten plain-text-block (newlines preserved via
 * `whitespace-pre-wrap`) oder einen empty-placeholder.
 *
 * Length-budget 500 chars (mirrors server-action cap). Char-counter wird
 * rot wenn > 500 (= save-button blocked + visual warning).
 *
 * useTransition für optimistic-UI feel: button shows "Speichert…" während
 * server-action läuft, error-state wird im error-banner unten gezeigt.
 *
 * Bewusst client-component statt server-action im form-action attribute —
 * wir wollen draft-editing state (textarea-value lokal halten), char-count
 * live-update, edit/preview-toggle. Form-action würde nach jedem submit
 * resetten was schlechter UX wäre.
 */
export function BioCard({ initialBio }: { initialBio: string | null }) {
  // editing=true wenn der user grade tippt. Initial-state: edit-mode ON
  // wenn bio leer ist (= CTA "schreibe deine bio"), preview-mode wenn bio
  // schon gesetzt ist (= existing-text anzeigen, edit-button für changes).
  const [editing, setEditing] = useState(initialBio === null);
  const [draft, setDraft] = useState(initialBio ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // currentBio = was der server zuletzt bestätigt hat. Wird nach erfolgreichem
  // save aktualisiert. Initial = initialBio (prop vom server-component-render).
  const [currentBio, setCurrentBio] = useState<string | null>(initialBio);

  const charCount = draft.length;
  const overLimit = charCount > 500;

  function submit() {
    if (overLimit) {
      setError('Bio ist zu lang (max. 500 zeichen).');
      return;
    }
    setError(null);
    const toSave = draft.trim().length === 0 ? null : draft;
    startTransition(async () => {
      try {
        const result = await setUserBio(toSave);
        setCurrentBio(result.bio);
        // Wenn cleared (= null result), bleiben wir im edit-mode mit dem
        // empty-CTA. Wenn bio gesetzt, in preview-mode wechseln.
        if (result.bio !== null) {
          setEditing(false);
        }
        setDraft(result.bio ?? '');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Konnte bio nicht speichern.');
      }
    });
  }

  function clearBio() {
    setError(null);
    startTransition(async () => {
      try {
        await setUserBio(null);
        setCurrentBio(null);
        setDraft('');
        // Nach clear in den edit-mode (= CTA "schreibe deine bio")
        setEditing(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Konnte bio nicht entfernen.');
      }
    });
  }

  function cancelEdit() {
    setDraft(currentBio ?? '');
    setError(null);
    setEditing(false);
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-gray-500">
            ✍️ Pilot-Bio
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Eine kurze beschreibung sichtbar auf deinem öffentlichen pilot-profil.
          </p>
        </div>
        {currentBio !== null && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Bearbeiten
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={pending}
              rows={5}
              placeholder="z.B. 'Heimatbase EDDF, fliege A320-family und 737, hobby seit 2018. Lieblings-strecke: EDDF-OMDB. Aktiv auf VATSIM.'"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono resize-none focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              aria-label="Pilot-Bio"
            />
            <div className="flex items-center justify-between mt-1 text-xs">
              <span
                className={
                  overLimit
                    ? 'text-rose-600 dark:text-rose-400 font-medium'
                    : charCount > 400
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-gray-500 dark:text-gray-500'
                }
              >
                {charCount} / 500 zeichen
              </span>
              <span className="text-gray-500 dark:text-gray-500">
                Plain-text, zeilenumbrüche bleiben erhalten.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={submit}
              disabled={pending || overLimit}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition"
            >
              {pending ? 'Speichert…' : 'Speichern'}
            </button>
            {currentBio !== null && (
              <button
                type="button"
                onClick={cancelEdit}
                disabled={pending}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                Abbrechen
              </button>
            )}
            {currentBio !== null && (
              <button
                type="button"
                onClick={clearBio}
                disabled={pending}
                className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:underline"
              >
                Bio entfernen
              </button>
            )}
          </div>

          {error && (
            <p
              className="text-sm text-rose-600 dark:text-rose-400"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-md bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
            {currentBio}
          </p>
        </div>
      )}
    </section>
  );
}
