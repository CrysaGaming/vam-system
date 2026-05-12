/**
 * Track 5 #15 (Section C) — PhotoGallery.
 *
 * Server-component die die photo-liste lädt und die UI rendert. Direkt
 * vor der CommentsSection auf der PIREP-detail-page eingebunden.
 *
 * # Permissions-input
 *
 *   - currentUserId: für owner-detection bei delete-buttons
 *   - canDeleteAny: derived in der parent-page (admin/airline-admin in
 *     derselben airline). Wird an jedes PhotoItem durchgereicht.
 *
 * # Layout
 *
 *   - Header: count + (für authenticated user) Foto-hinzufügen-button
 *   - Grid: 2 cols mobile, 3 cols tablet, 4 cols desktop. aspect-square
 *     items mit object-cover. Click → lightbox.
 *
 * # No-photos state
 *
 *   - Logged-in: zeig PhotoForm direkt (kein collapsed-state)
 *   - Logged-out: hide section komplett (kein "kein content"-noise)
 *
 * # Hide-vs-render
 *
 *   Section wird IMMER gerendert wenn der user logged-in ist, auch
 *   ohne photos — sonst entdeckt niemand die feature. Bei logged-out
 *   nur wenn photos da sind.
 */

import { listPhotosForPirep, MAX_PHOTOS_PER_PIREP } from '@vam/db';
import { PhotoForm } from './photo-form';
import { PhotoItem } from './photo-item';

export async function PhotoGallery({
  pirepId,
  currentUserId,
  canDeleteAny,
}: {
  pirepId: string;
  currentUserId: string | null;
  canDeleteAny: boolean;
}) {
  const photos = await listPhotosForPirep(pirepId);
  const atLimit = photos.length >= MAX_PHOTOS_PER_PIREP;

  // Logged-out + keine photos → komplett hidden. Kein noise.
  if (!currentUserId && photos.length === 0) return null;

  return (
    <section className="mt-8">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Fotos{' '}
          <span className="text-sm text-gray-500 font-normal tabular-nums">
            ({photos.length}
            {atLimit ? ` / ${MAX_PHOTOS_PER_PIREP}` : ''})
          </span>
        </h2>
      </header>

      {/* Form (logged-in only). Bei leerer gallery direkt expanded
          (PhotoForm self-collapsed default, aber wir wollen empty-state
          encouragement → wir lassen es self-managed, der user klickt
          den "Foto hinzufügen"-button). */}
      {currentUserId && (
        <div className="mb-4">
          <PhotoForm pirepId={pirepId} atLimit={atLimit} />
        </div>
      )}

      {/* Gallery grid */}
      {photos.length === 0 ? (
        currentUserId ? (
          <p className="text-xs text-gray-500 text-center py-2">
            Noch keine Fotos. Teile dein bestes Cockpit-shot!
          </p>
        ) : null
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p) => (
            <li key={p.id}>
              <PhotoItem
                photo={{
                  id: p.id,
                  url: p.url,
                  caption: p.caption,
                  createdAt: p.createdAt.toISOString(),
                  authorId: p.authorId,
                  author: p.author,
                }}
                pirepId={pirepId}
                currentUserId={currentUserId}
                canDeleteAny={canDeleteAny}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
