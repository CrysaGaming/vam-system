'use client';

import { useState, useTransition } from 'react';
import { createPhotoAction } from './photo-actions';

const MAX_URL_CHARS = 1000;
const MAX_CAPTION_CHARS = 500;

/**
 * Track 5 #15 (Section C) — PhotoForm.
 *
 * Client-component für neuen photo-post. Zwei felder: URL (required)
 * und caption (optional). Im default-state collapsed mit "Foto hinzufügen"-
 * button — verhindert dass das form-pärchen visuelle laufweite verbraucht
 * wenn der user gar nicht posten will.
 *
 * # Preview
 *
 * Wenn die URL valid-looking ist (https + matches einer common image-
 * extension), zeigen wir einen kleinen preview-thumb. Reines client-side
 * heuristic — wenn der host die URL killt sieht der user direkt
 * "broken image", was eh besser ist als nach dem submit überrascht zu sein.
 */
export function PhotoForm({
  pirepId,
  atLimit,
}: {
  pirepId: string;
  atLimit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedUrl = url.trim();
  const urlOk =
    trimmedUrl.length > 0 &&
    trimmedUrl.length <= MAX_URL_CHARS &&
    /^https:\/\//.test(trimmedUrl);
  const captionOk = caption.length <= MAX_CAPTION_CHARS;
  const canSubmit = urlOk && captionOk && !isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    const urlSnapshot = trimmedUrl;
    const captionSnapshot = caption.trim() || null;
    startTransition(async () => {
      const result = await createPhotoAction(
        pirepId,
        urlSnapshot,
        captionSnapshot,
      );
      if (!result.success) {
        setError(result.error);
      } else {
        // Reset + collapse
        setUrl('');
        setCaption('');
        setExpanded(false);
      }
    });
  }

  // Sieht die URL aus wie ein image-link? Reine client-heuristic.
  const looksLikeImage =
    urlOk &&
    /\.(jpe?g|png|gif|webp|avif|bmp)(\?.*)?$/i.test(trimmedUrl);

  if (atLimit) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/40 rounded-lg p-4 text-center">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Limit erreicht: max. 12 Fotos pro PIREP. Lösche ein bestehendes
          Foto bevor du ein neues hochlädst.
        </p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full px-4 py-3 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-400 transition flex items-center justify-center gap-2"
      >
        <span aria-hidden="true">📸</span>
        Foto hinzufügen
      </button>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-3">
      {/* URL field */}
      <div>
        <label
          htmlFor="photo-url"
          className="block text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5"
        >
          Bild-URL (https://…)
        </label>
        <input
          id="photo-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://i.imgur.com/abc123.jpg"
          maxLength={MAX_URL_CHARS}
          disabled={isPending}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
        />
        <p className="text-[10px] text-gray-400 mt-1">
          Hoste das Bild bei imgur, discord, dropbox oder einem anderen
          host und füge den direkten Bild-Link ein.
        </p>
      </div>

      {/* Caption field */}
      <div>
        <label
          htmlFor="photo-caption"
          className="block text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5"
        >
          Caption (optional)
        </label>
        <input
          id="photo-caption"
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Sonnenaufgang über FL350…"
          maxLength={MAX_CAPTION_CHARS + 50}
          disabled={isPending}
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
        />
        <p
          className={`text-[10px] mt-1 tabular-nums text-right ${
            caption.length > MAX_CAPTION_CHARS
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-400'
          }`}
        >
          {caption.length} / {MAX_CAPTION_CHARS}
        </p>
      </div>

      {/* Preview thumb (client-side heuristic) */}
      {looksLikeImage && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
            Vorschau
          </p>
          <div className="bg-gray-100 dark:bg-gray-800 rounded overflow-hidden max-w-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <picture>
              <img
                src={trimmedUrl}
                alt="Vorschau"
                className="w-full h-auto max-h-48 object-contain"
                onError={(e) => {
                  // Replace with placeholder if load fails. Pure-presentation,
                  // user kann immer noch posten (server validates URL-format
                  // nicht reachability).
                  (e.currentTarget as HTMLImageElement).style.display =
                    'none';
                }}
              />
            </picture>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setUrl('');
            setCaption('');
            setError(null);
          }}
          disabled={isPending}
          className="text-xs px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded transition disabled:opacity-60"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="text-xs px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-full font-semibold transition whitespace-nowrap"
        >
          {isPending ? '…' : 'Hochladen'}
        </button>
      </div>
    </div>
  );
}
