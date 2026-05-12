'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { followAction, unfollowAction } from './actions';

/**
 * Track 5 #13 (Section C) — Follow-Button.
 *
 * Client-component für instant-feedback. useTransition für pending-state,
 * lokaler state für optimistic-UI feel (button-label/style ändert sich
 * sofort, server-revalidate kommt 50-200ms später).
 *
 * # Variants
 *
 *   - viewerLoggedIn === false: Link zum login statt button
 *   - viewer === target: kein button (wird vom parent gar nicht erst
 *     rendered, defensive return null hier)
 *   - isFollowing === false: "Folgen"-button (primary)
 *   - isFollowing === true: "Folge ich"-button (subtle, hover→"Entfolgen")
 *
 * # Mutual-badge
 *
 * Wenn isFollowedBy === true (target folgt viewer): kleines "folgt dir"-
 * badge daneben. Twitter-style relationship-hint.
 */
export function FollowButton({
  targetId,
  viewerId,
  initialIsFollowing,
  isFollowedByTarget,
}: {
  targetId: string;
  viewerId: string | null;
  initialIsFollowing: boolean;
  isFollowedByTarget: boolean;
}) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [error, setError] = useState<string | null>(null);
  const [hoveringUnfollow, setHoveringUnfollow] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Self-view: kein button. Parent sollte das schon abfangen aber defensive.
  if (viewerId === targetId) return null;

  // Unlogged: zeige "Anmelden"-link statt button.
  if (!viewerId) {
    return (
      <Link
        href="/api/auth/signin"
        className="text-xs px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-semibold transition whitespace-nowrap"
      >
        Anmelden um zu folgen
      </Link>
    );
  }

  function handleClick() {
    setError(null);
    const next = !isFollowing;
    // Optimistic update
    setIsFollowing(next);
    startTransition(async () => {
      try {
        if (next) {
          const result = await followAction(targetId);
          if (!result.success) {
            // Revert
            setIsFollowing(false);
            setError(
              result.error === 'not_followable'
                ? 'Profil nicht mehr öffentlich.'
                : result.error === 'self_follow'
                  ? 'Du kannst dir nicht selbst folgen.'
                  : 'Fehler.',
            );
          }
        } else {
          await unfollowAction(targetId);
        }
      } catch (e) {
        // Revert + show error
        setIsFollowing(!next);
        setError(e instanceof Error ? e.message : 'Fehler.');
      }
    });
  }

  // Button-label hängt vom state ab. Beim hover über einen "Folge ich"-
  // button blendet das label zu "Entfolgen" damit klar ist was der klick
  // bewirkt.
  let label: string;
  let buttonClass: string;
  if (!isFollowing) {
    label = 'Folgen';
    buttonClass =
      'bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-600';
  } else if (hoveringUnfollow) {
    label = 'Entfolgen';
    buttonClass =
      'bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700';
  } else {
    label = '✓ Folge ich';
    buttonClass =
      'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700';
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {isFollowedByTarget && (
          <span className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full whitespace-nowrap">
            folgt dir
          </span>
        )}
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => isFollowing && setHoveringUnfollow(true)}
          onMouseLeave={() => setHoveringUnfollow(false)}
          disabled={isPending}
          className={`text-xs px-4 py-1.5 rounded-full font-semibold transition whitespace-nowrap disabled:opacity-60 ${buttonClass}`}
        >
          {isPending ? '…' : label}
        </button>
      </div>
      {error && (
        <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
