'use client';

/**
 * Welle K / K4 — Mentorship-request form (client component).
 *
 * Triggert createMentorshipRequestAction. Bei erfolg redirect zu
 * /me/mentorship (wo der user die outgoing-request sieht).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMentorshipRequestAction } from '@/app/me/mentorship/actions';

type Props = {
  mentorId: string;
  suggestedTopics: string[];
};

export default function MentorshipRequestForm({
  mentorId,
  suggestedTopics,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [topics, setTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function toggleTopic(t: string) {
    setTopics((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createMentorshipRequestAction({
        mentorId,
        topics,
        notes,
      });
      if (res.ok) {
        router.push('/me/mentorship');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Mentorship anfragen</h2>

      {suggestedTopics.length > 0 && (
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Topics die du angehen möchtest (aus dem mentor-profil)
          </label>
          <div className="flex flex-wrap gap-1">
            {suggestedTopics.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTopic(t)}
                disabled={isPending}
                className={`rounded-md border px-2 py-1 text-xs ${
                  topics.includes(t)
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                    : 'border-border bg-background hover:border-indigo-400'
                }`}
              >
                {topics.includes(t) ? '✓ ' : ''}
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notiz für den mentor (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Was möchtest du lernen? Was sind deine ziele? Wann hast du zeit zum fliegen?"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">
          {notes.length} / 2000
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Sende anfrage…' : 'Anfrage senden'}
      </button>
    </div>
  );
}
