'use client';

/**
 * Welle K / K4 — Mentorship-action buttons (client).
 *
 * Wrappt accept/reject/end actions in single-button-rendering. Per-row
 * use im /me/mentorship management.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  respondToMentorshipRequestAction,
  endMentorshipAction,
} from './actions';

type Mode = 'mentor-pending' | 'mentor-active' | 'mentee-active';

type Props = {
  mentorshipId: string;
  mode: Mode;
};

export default function MentorshipActions({ mentorshipId, mode }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(accept: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await respondToMentorshipRequestAction({ mentorshipId, accept });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function end() {
    if (!confirm('Mentorship wirklich beenden? Status wird ENDED.')) return;
    setError(null);
    startTransition(async () => {
      const res = await endMentorshipAction(mentorshipId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {mode === 'mentor-pending' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => respond(true)}
            disabled={isPending}
            className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-700 hover:bg-green-500/20 disabled:opacity-50 dark:text-green-300"
          >
            ✓ Annehmen
          </button>
          <button
            type="button"
            onClick={() => respond(false)}
            disabled={isPending}
            className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
          >
            ✕ Ablehnen
          </button>
        </div>
      )}
      {(mode === 'mentor-active' || mode === 'mentee-active') && (
        <button
          type="button"
          onClick={end}
          disabled={isPending}
          className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-500/20 disabled:opacity-50 dark:text-orange-300"
        >
          Mentorship beenden
        </button>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
