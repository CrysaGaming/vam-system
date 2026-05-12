'use client';

import { useState, useTransition } from 'react';
import { createCommentAction } from './comment-actions';

const MAX_CHARS = 2000;

/**
 * Track 5 #14 (Section C) — CommentForm.
 *
 * Client-component für neuen comment. Textarea + char-counter + submit-
 * button. Bei success: textarea wird geleert (server-revalidate fügt
 * den neuen comment in die liste oben in der section ein).
 *
 * UX-details:
 *   - Submit disabled wenn body leer oder >2000 chars
 *   - Counter wird ab 90% gelb, ab 100% rot
 *   - Pending-state via useTransition
 *   - Cmd/Ctrl+Enter submits (für power-users)
 *   - Errors inline unter der textarea
 */
export function CommentForm({ pirepId }: { pirepId: string }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = body.trim();
  const charCount = body.length;
  const tooLong = charCount > MAX_CHARS;
  const canSubmit = trimmed.length > 0 && !tooLong && !isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    const snapshot = body;
    setBody('');
    startTransition(async () => {
      const result = await createCommentAction(pirepId, snapshot);
      if (!result.success) {
        setBody(snapshot); // restore
        setError(result.error);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  const counterTone =
    charCount > MAX_CHARS
      ? 'text-red-600 dark:text-red-400'
      : charCount > MAX_CHARS * 0.9
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-400';

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Was denkst du über diesen Flug?"
        rows={3}
        disabled={isPending}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 resize-y"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className={`text-[11px] tabular-nums ${counterTone}`}>
          {charCount} / {MAX_CHARS}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-gray-400 hidden sm:block">
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[9px]">
              ⌘
            </kbd>
            +
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[9px]">
              ↵
            </kbd>{' '}
            zum senden
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-xs px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-full font-semibold transition whitespace-nowrap"
          >
            {isPending ? '…' : 'Kommentieren'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
