'use client';

import { useState, useTransition } from 'react';
import { joinEventAction, leaveEventAction, type JoinActionResult } from './actions';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Signup-button für event-
 * detail-page.
 *
 * Client-component die joinEventAction / leaveEventAction triggert und
 * lokales pending-state + error-message rendert. Keine optimistic-update
 * weil wir auf revalidatePath hoffen — der server rendert nach action
 * frisch und der button-state passt sich an.
 *
 * # Toggle-logic
 *
 * Component kriegt initial den `joined` boolean vom server. Bei click:
 *   - joined=false → joinEventAction
 *   - joined=true → leaveEventAction
 * Nach success refreshen wir via router.refresh() damit page-revalidate
 * sicher trigger'd (revalidatePath alleine reicht oft, aber mit refresh
 * sind wir paranoid-sure).
 *
 * # Disabled-states
 *
 * Wenn der event nicht joinable ist (status != PUBLISHED, oder full,
 * oder past), kommt vom server `disabled=true` + `disabledReason`.
 * Component zeigt dann nur den disabled-button mit reason als tooltip-
 * text.
 */

export type EventSignupButtonProps = {
  eventId: string;
  slug: string;
  initialJoined: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Bitte einloggen.',
  'event-not-found': 'Event nicht mehr verfügbar.',
  'event-not-published': 'Event ist nicht öffentlich.',
  'event-full': 'Event ist bereits voll.',
  'event-ended': 'Event ist bereits vorbei.',
};

export function EventSignupButton({
  eventId,
  slug,
  initialJoined,
  disabled,
  disabledReason,
}: EventSignupButtonProps) {
  const [joined, setJoined] = useState(initialJoined);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      let result: JoinActionResult | { ok: true } | { ok: false; reason: string };
      if (joined) {
        result = await leaveEventAction(eventId, slug);
      } else {
        result = await joinEventAction(eventId, slug);
      }

      if (result.ok) {
        setJoined(!joined);
      } else if ('reason' in result) {
        setError(ERROR_MESSAGES[result.reason] ?? 'Aktion fehlgeschlagen.');
      }
    });
  };

  if (disabled) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          className="px-6 py-2.5 bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded font-medium cursor-not-allowed"
          title={disabledReason ?? undefined}
        >
          Anmeldung nicht möglich
        </button>
        {disabledReason && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {disabledReason}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={
          joined
            ? 'px-6 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded font-medium transition'
            : 'px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded font-medium transition'
        }
      >
        {isPending
          ? joined
            ? 'Abmelden…'
            : 'Anmelden…'
          : joined
            ? 'Abmelden'
            : 'Anmelden'}
      </button>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {joined && !error && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Du bist angemeldet ✓
        </p>
      )}
    </div>
  );
}
