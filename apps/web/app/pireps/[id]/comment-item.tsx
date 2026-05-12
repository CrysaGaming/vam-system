'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  updateCommentAction,
  deleteCommentAction,
} from './comment-actions';

const MAX_CHARS = 2000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

type CommentItemProps = {
  comment: {
    id: string;
    body: string;
    createdAt: string;       // serialized von der parent server-component
    editedAt: string | null; // serialized
    authorId: string;
    author: {
      id: string;
      name: string | null;
      image: string | null;
      rankName: string | null;
      airlineIcao: string | null;
      isProfilePublic: boolean;
    };
  };
  pirepId: string;
  currentUserId: string | null;
};

/**
 * Track 5 #14 (Section C) — CommentItem.
 *
 * Eine zeile in der comments-liste. Bei owner-view + innerhalb des
 * 15-min-fensters: edit + delete buttons. Außerhalb: nur delete (owner).
 *
 * # State-modes
 *
 *   - default: liest comment-body, owner sieht edit/delete buttons
 *   - editing: textarea + save/cancel
 *   - deleting: opacity gedimmt während pending
 */
export function CommentItem({
  comment,
  pirepId,
  currentUserId,
}: CommentItemProps) {
  const isOwner = currentUserId === comment.authorId;
  const createdAt = new Date(comment.createdAt);
  const editedAt = comment.editedAt ? new Date(comment.editedAt) : null;

  // Edit-fenster ist client-side berechnet — server enforced es auch
  // beim updateCommentAction. Client-check ist nur fürs UI (button
  // hide). Bei race "klick auf edit kurz vor ablauf, type 5min lang,
  // then save" returnt der server CommentEditWindowClosedError → form
  // zeigt die error-message.
  const ageMs = Date.now() - createdAt.getTime();
  const canEdit = isOwner && ageMs < EDIT_WINDOW_MS;

  const [mode, setMode] = useState<'default' | 'editing'>('default');
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSaveEdit() {
    setError(null);
    startTransition(async () => {
      const result = await updateCommentAction(
        comment.id,
        pirepId,
        draft,
      );
      if (!result.success) {
        setError(result.error);
      } else {
        setMode('default');
      }
    });
  }

  function handleDelete() {
    if (!confirm('Diesen Kommentar wirklich löschen?')) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCommentAction(comment.id, pirepId);
      if (!result.success) {
        setError(result.error);
      }
      // success: revalidatePath in der action → liste re-rendert ohne diesen
    });
  }

  const dimmed = isPending ? 'opacity-50' : '';

  return (
    <article
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 transition ${dimmed}`}
    >
      {/* ── Author row ── */}
      <header className="flex items-start gap-3">
        <AuthorAvatar author={comment.author} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <AuthorName author={comment.author} />
            {comment.author.rankName && (
              <span className="text-[11px] text-gray-500">
                {comment.author.rankName}
              </span>
            )}
            {comment.author.airlineIcao && (
              <span className="text-[11px] text-gray-500 font-mono">
                {comment.author.airlineIcao}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            <time dateTime={createdAt.toISOString()}>
              {formatTime(createdAt)}
            </time>
            {editedAt && (
              <span className="ml-1.5 italic">(bearbeitet)</span>
            )}
          </p>
        </div>

        {/* Owner-actions */}
        {isOwner && mode === 'default' && (
          <div className="flex items-center gap-1">
            {canEdit && (
              <button
                type="button"
                onClick={() => setMode('editing')}
                disabled={isPending}
                className="text-[11px] px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition"
                aria-label="Kommentar bearbeiten"
              >
                ✏️
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="text-[11px] px-2 py-1 hover:bg-red-50 dark:hover:bg-red-950/40 rounded text-gray-500 hover:text-red-700 dark:hover:text-red-400 transition"
              aria-label="Kommentar löschen"
            >
              🗑️
            </button>
          </div>
        )}
      </header>

      {/* ── Body / Editor ── */}
      <div className="mt-3">
        {mode === 'editing' ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              disabled={isPending}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 resize-y"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <p
                className={`text-[11px] tabular-nums mr-auto ${
                  draft.length > MAX_CHARS
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-400'
                }`}
              >
                {draft.length} / {MAX_CHARS}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode('default');
                  setDraft(comment.body);
                  setError(null);
                }}
                disabled={isPending}
                className="text-xs px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded transition disabled:opacity-60"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={
                  isPending ||
                  draft.trim().length === 0 ||
                  draft.length > MAX_CHARS ||
                  draft === comment.body
                }
                className="text-xs px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-full font-semibold transition"
              >
                {isPending ? '…' : 'Speichern'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
            {comment.body}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </article>
  );
}

function AuthorAvatar({ author }: { author: CommentItemProps['comment']['author'] }) {
  if (author.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <picture>
        <img
          src={author.image}
          alt=""
          className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 shrink-0"
        />
      </picture>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
  );
}

function AuthorName({ author }: { author: CommentItemProps['comment']['author'] }) {
  const name = author.name ?? 'Unbenannt';
  if (author.isProfilePublic) {
    return (
      <Link
        href={`/p/${author.id}`}
        className="text-sm font-semibold hover:underline"
      >
        {name}
      </Link>
    );
  }
  return <span className="text-sm font-semibold">{name}</span>;
}

/**
 * Relative-time bis 7 tage, dann absolute. Deutsch-locale.
 * Selbe logik wie im Activity-Feed (#12) — V2 könnte das in
 * apps/web/lib/format.ts auslagern.
 */
function formatTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `vor ${diffD}d`;
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
