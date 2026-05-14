'use client';

/**
 * Welle K / K3 — Photo curation row (client-component).
 *
 * Render one photo with feature/unfeature toggle button via useTransition.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { featurePhotoAction, unfeaturePhotoAction } from './actions';

type Photo = {
  id: string;
  url: string;
  caption: string | null;
  createdAt: Date;
  featuredAt: Date | null;
  featuredByName: string | null;
  authorName: string;
  authorId: string;
  airlineIcao: string | null;
  pirepId: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
};

export default function PhotoCurationRow({ photo }: { photo: Photo }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isFeatured = photo.featuredAt !== null;

  function toggleFeature() {
    setError(null);
    startTransition(async () => {
      const res = isFeatured
        ? await unfeaturePhotoAction(photo.id)
        : await featurePhotoAction(photo.id);
      if (!res.ok) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-card ${
        isFeatured ? 'border-indigo-500/50' : 'border-border'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <picture>
        <img
          src={photo.url}
          alt={photo.caption ?? 'Flight photo'}
          className="aspect-video w-full object-cover"
        />
      </picture>
      <div className="p-3">
        {photo.caption && (
          <p className="mb-2 line-clamp-2 text-sm text-foreground">
            {photo.caption}
          </p>
        )}
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            <Link
              href={`/p/${photo.authorId}`}
              className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {photo.authorName}
            </Link>
            {photo.airlineIcao && <span className="font-mono"> · {photo.airlineIcao}</span>}
          </p>
          {photo.pirepId && photo.departureIcao && photo.arrivalIcao && (
            <p>
              <Link
                href={`/pireps/${photo.pirepId}`}
                className="font-mono hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {photo.departureIcao} → {photo.arrivalIcao}
              </Link>
            </p>
          )}
          <p>
            Hochgeladen:{' '}
            {photo.createdAt.toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </p>
          {isFeatured && photo.featuredAt && (
            <p className="text-indigo-600 dark:text-indigo-400">
              ⭐ Featured am{' '}
              {photo.featuredAt.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
              {photo.featuredByName && ` von ${photo.featuredByName}`}
            </p>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <button
          type="button"
          onClick={toggleFeature}
          disabled={isPending}
          className={`mt-3 w-full rounded-md border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            isFeatured
              ? 'border-orange-500/30 bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 dark:text-orange-300'
              : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-300'
          }`}
        >
          {isPending
            ? 'Bitte warten…'
            : isFeatured
              ? 'Unfeature'
              : '⭐ Als Photo of the Week featuren'}
        </button>
      </div>
    </div>
  );
}
