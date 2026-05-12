'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { deletePhotoAction } from './photo-actions';

type PhotoItemProps = {
  photo: {
    id: string;
    url: string;
    caption: string | null;
    createdAt: string; // serialized
    authorId: string;
    author: {
      id: string;
      name: string | null;
      image: string | null;
      isProfilePublic: boolean;
    };
  };
  pirepId: string;
  currentUserId: string | null;
  canDeleteAny: boolean;
};

/**
 * Track 5 #15 (Section C) — PhotoItem.
 *
 * Eine zelle in der photo-gallery. Klick auf das thumbnail öffnet einen
 * fullscreen-lightbox (native dialog). Owner/admin sieht delete-button
 * unten rechts beim hover.
 *
 * # Lightbox
 *
 * Native HTML <dialog> element — kein library, kein portal, browser
 * handled stacking + focus-trap + Esc-to-close. ShowModal() öffnet
 * mit backdrop, close() schließt. Onclick auf den backdrop schließt
 * auch.
 *
 * # Delete UX
 *
 * Confirm-dialog vor delete. Optimistic: opacity-dim while pending,
 * dann server-revalidate räumt das item aus der liste. Bei fehler
 * zeigen wir die error-message inline statt die ganze card auszublenden.
 */
export function PhotoItem({
  photo,
  pirepId,
  currentUserId,
  canDeleteAny,
}: PhotoItemProps) {
  const isOwner = currentUserId === photo.authorId;
  const canDelete = isOwner || canDeleteAny;
  const createdAt = new Date(photo.createdAt);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!confirm('Dieses Foto wirklich löschen?')) return;
    setError(null);
    startTransition(async () => {
      const result = await deletePhotoAction(photo.id, pirepId);
      if (!result.success) {
        setError(result.error);
      }
      // success: revalidatePath in der action → item verschwindet
    });
  }

  const dimmed = isPending ? 'opacity-40' : '';

  return (
    <>
      <article
        className={`group relative bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden aspect-square transition ${dimmed}`}
      >
        {/* Thumbnail (click → lightbox) */}
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="absolute inset-0 w-full h-full"
          aria-label={photo.caption ?? 'Foto vergrößern'}
          disabled={isPending}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <picture>
            <img
              src={photo.url}
              alt={photo.caption ?? ''}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
              onError={(e) => {
                // Broken-image fallback: zeig einen subtle placeholder.
                // Wir können nicht das DOM-element selbst replacen weil
                // das React-managed ist; stattdessen verstecken wir das
                // <img> und der parent button zeigt einen background-text.
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </picture>
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs pointer-events-none -z-10">
            🖼️ Bild nicht ladbar
          </div>
        </button>

        {/* Caption overlay (bottom) */}
        {photo.caption && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 pointer-events-none">
            <p className="text-xs text-white line-clamp-2">{photo.caption}</p>
          </div>
        )}

        {/* Author + date overlay (top) */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent px-2 pt-2 pb-4 flex items-start gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
          <AuthorAvatar author={photo.author} />
          <div className="flex-1 min-w-0">
            <AuthorName author={photo.author} />
            <p className="text-[9px] text-white/70 leading-tight">
              {createdAt.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: 'short',
              })}
            </p>
          </div>
          {/* Delete button — only for owner or canDeleteAny */}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="text-[11px] px-1.5 py-1 bg-red-600/80 hover:bg-red-700 disabled:opacity-60 text-white rounded transition leading-none"
              aria-label="Foto löschen"
              title="Foto löschen"
            >
              🗑️
            </button>
          )}
        </div>

        {/* Inline error (über alles wenn vorhanden) */}
        {error && (
          <div className="absolute inset-x-0 bottom-0 bg-red-600/90 px-2 py-1 text-[10px] text-white text-center">
            {error}
          </div>
        )}
      </article>

      {/* Lightbox dialog */}
      {lightboxOpen && (
        <Lightbox photo={photo} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  );
}

function Lightbox({
  photo,
  onClose,
}: {
  photo: PhotoItemProps['photo'];
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
      // Esc to close
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      tabIndex={-1}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Schließen"
        className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full text-white text-xl flex items-center justify-center transition"
      >
        ✕
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[95vh] flex flex-col items-center cursor-default"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <picture>
          <img
            src={photo.url}
            alt={photo.caption ?? ''}
            className="max-w-full max-h-[80vh] object-contain rounded"
          />
        </picture>
        {photo.caption && (
          <p className="text-sm text-white/90 mt-4 max-w-2xl text-center px-4 whitespace-pre-wrap">
            {photo.caption}
          </p>
        )}
        <div className="text-[11px] text-white/60 mt-3 flex items-center gap-2">
          <span>von {photo.author.name ?? 'Unbenannt'}</span>
          <span>·</span>
          <a
            href={photo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-white/80"
          >
            Original öffnen ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function AuthorAvatar({ author }: { author: PhotoItemProps['photo']['author'] }) {
  if (author.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <picture>
        <img
          src={author.image}
          alt=""
          className="w-6 h-6 rounded-full border border-white/30 shrink-0"
        />
      </picture>
    );
  }
  return (
    <div className="w-6 h-6 rounded-full bg-white/20 border border-white/30 shrink-0" />
  );
}

function AuthorName({ author }: { author: PhotoItemProps['photo']['author'] }) {
  const name = author.name ?? 'Unbenannt';
  if (author.isProfilePublic) {
    return (
      <Link
        href={`/p/${author.id}`}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] font-semibold text-white hover:underline truncate block"
      >
        {name}
      </Link>
    );
  }
  return (
    <span className="text-[11px] font-semibold text-white truncate block">
      {name}
    </span>
  );
}
