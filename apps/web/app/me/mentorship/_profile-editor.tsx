'use client';

/**
 * Welle K / K4 — Mentor-profile editor (client).
 *
 * Toggle mentorAvailable + edit topics + bio. Topics werden als
 * comma-separated string eingegeben für simplicity (V2 könnte ein
 * tag-input mit autocomplete sein).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMentorshipProfileAction } from './actions';

type Props = {
  initial: {
    mentorAvailable: boolean;
    mentorTopics: string[];
    mentorBio: string;
  };
};

export default function MentorProfileEditor({ initial }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [available, setAvailable] = useState(initial.mentorAvailable);
  const [topicsText, setTopicsText] = useState(initial.mentorTopics.join(', '));
  const [bio, setBio] = useState(initial.mentorBio);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  function save() {
    setMessage(null);
    const topics = topicsText
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    startTransition(async () => {
      const res = await setMentorshipProfileAction({
        mentorAvailable: available,
        topics,
        bio,
      });
      if (res.ok) {
        setMessage({ kind: 'success', text: res.message ?? 'Gespeichert.' });
        router.refresh();
      } else {
        setMessage({ kind: 'error', text: res.error });
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Mentor-Profil</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pilots in deiner airline können dich finden wenn du verfügbar bist.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
            disabled={isPending}
            className="h-4 w-4 rounded border-border accent-indigo-600"
          />
          Verfügbar
        </label>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Topics (komma-getrennt, max 10)
        </label>
        <input
          type="text"
          value={topicsText}
          onChange={(e) => setTopicsText(e.target.value)}
          placeholder="z.B. IFR flying, Long-haul ops, Engine-out procedures"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Kurz-bio (was kannst du anbieten?)
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Ich bin captain auf der A320 mit 8 jahren erfahrung, schwerpunkt IFR-procedures und CRM…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">{bio.length} / 500</div>
      </div>

      {message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            message.kind === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
              : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Speichere…' : 'Profil speichern'}
      </button>
    </div>
  );
}
