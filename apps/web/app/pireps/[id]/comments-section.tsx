/**
 * Track 5 #14 (Section C) — CommentsSection.
 *
 * Server-component die die comments-list lädt und die client-components
 * (CommentForm + CommentItem) rendert. Direkt unter AnnotationList auf
 * der PIREP-detail-page gemounted.
 *
 * # Data-flow
 *
 *   - listCommentsForPirep läuft auf dem server
 *   - Date-fields werden für die client-component-prop serialisiert
 *     (Next.js erlaubt Date-objects in props erst seit v13.3+ — wir
 *     serialisieren sicherheitshalber zu strings)
 *
 * # Auth
 *
 *   - Logged-out user sehen die liste read-only + login-prompt statt form
 *   - Logged-in user sehen form oben + edit/delete-buttons auf eigenen
 *     comments
 */

import Link from 'next/link';
import { listCommentsForPirep } from '@vam/db';
import { CommentForm } from './comment-form';
import { CommentItem } from './comment-item';

export async function CommentsSection({
  pirepId,
  currentUserId,
}: {
  pirepId: string;
  currentUserId: string | null;
}) {
  const comments = await listCommentsForPirep(pirepId);

  return (
    <section className="mt-8">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Kommentare{' '}
          <span className="text-sm text-gray-500 font-normal tabular-nums">
            ({comments.length})
          </span>
        </h2>
      </header>

      {/* ── New comment form ── */}
      {currentUserId ? (
        <div className="mb-4">
          <CommentForm pirepId={pirepId} />
        </div>
      ) : (
        <div className="mb-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-500">
            <Link
              href="/api/auth/signin"
              className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
            >
              Anmelden
            </Link>{' '}
            um zu kommentieren.
          </p>
        </div>
      )}

      {/* ── Comments list ── */}
      {comments.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-500">
            Noch keine Kommentare. Sei der erste!
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentItem
                comment={{
                  id: c.id,
                  body: c.body,
                  createdAt: c.createdAt.toISOString(),
                  editedAt: c.editedAt ? c.editedAt.toISOString() : null,
                  authorId: c.authorId,
                  author: c.author,
                }}
                pirepId={pirepId}
                currentUserId={currentUserId}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
