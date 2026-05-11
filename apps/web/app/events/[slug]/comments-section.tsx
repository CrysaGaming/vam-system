import Link from 'next/link';
import { prisma } from '@vam/db';
import {
  createCommentAction,
  deleteCommentAction,
} from './comments-actions';

/**
 * Track 4 #99 (Section S) — Event-Comments section.
 *
 * Server-component rendered below the participants-list auf
 * /events/[slug]. Zeigt comment-thread + post-form für authenticated
 * users (read-only für unauthenticated, aber die page redirects eh
 * auf login).
 *
 * Author kann eigene comments löschen via inline 🗑️-button.
 * Admin kann beliebige comments löschen (markiert als admin-action mit
 * roter farbe damit der bias visible ist — admin-moderation, nicht
 * normales author-cleanup).
 */

interface Props {
  eventId: string;
  slug: string;
  currentUserId: string;
  currentUserIsAdmin: boolean;
}

export async function CommentsSection({
  eventId,
  slug,
  currentUserId,
  currentUserIsAdmin,
}: Props) {
  const comments = await prisma.eventComment.findMany({
    where: { eventId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          role: { select: { name: true } },
        },
      },
    },
  });

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <h2 className="font-semibold text-lg mb-1">
        💬 Diskussion ({comments.length})
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
        Fragen, briefings, post-event-feedback — alles was zum event passt.
      </p>

      {/* Comments-list */}
      {comments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic mb-6">
          Noch keine kommentare. Sei der erste!
        </p>
      ) : (
        <ul className="space-y-3 mb-6">
          {comments.map((c) => {
            const isOwnComment = c.userId === currentUserId;
            const canDelete = isOwnComment || currentUserIsAdmin;
            const authorIsAdmin = c.user.role?.name === 'admin';
            return (
              <li
                key={c.id}
                className={`flex gap-3 p-3 rounded-lg ${
                  authorIsAdmin
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30'
                    : 'bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800'
                }`}
              >
                {c.user.image ? (
                  <picture className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.user.image}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-gray-800"
                    />
                  </picture>
                ) : (
                  <div
                    className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-sm font-semibold text-gray-500 dark:text-gray-400 shrink-0"
                    aria-hidden="true"
                  >
                    {(c.user.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <Link
                        href={`/pilots/${c.user.id}`}
                        className="font-semibold text-sm hover:underline"
                      >
                        {c.user.name ?? 'Anonym'}
                      </Link>
                      {authorIsAdmin && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-200 dark:bg-indigo-500/30 text-indigo-800 dark:text-indigo-200 font-semibold">
                          Admin
                        </span>
                      )}
                      <span className="text-[11px] text-gray-500 dark:text-gray-500">
                        {c.createdAt.toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                    {canDelete && (
                      <form action={deleteCommentAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <button
                          type="submit"
                          className={`text-xs px-1.5 py-0.5 rounded transition ${
                            isOwnComment
                              ? 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
                              : 'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20'
                          }`}
                          title={
                            isOwnComment
                              ? 'Eigenen comment löschen'
                              : 'Admin-action: comment moderieren'
                          }
                        >
                          🗑️
                        </button>
                      </form>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                    {c.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Post-form */}
      <form
        action={createCommentAction}
        className="border-t border-gray-200 dark:border-gray-800 pt-4"
      >
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="slug" value={slug} />
        <label className="text-sm">
          <span className="block mb-1 font-medium">Comment posten</span>
          <textarea
            name="body"
            required
            rows={3}
            maxLength={2000}
            placeholder="Stelle eine frage oder teile gedanken zum event..."
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
          />
        </label>
        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-500">
            Max 2000 zeichen. Bleib respektvoll — admins können comments
            entfernen.
          </p>
          <button
            type="submit"
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition"
          >
            💬 Posten
          </button>
        </div>
      </form>
    </section>
  );
}
