'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/recently-viewed';
import { toastError, toastSuccess } from '@/lib/toast';

import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationListItem,
} from './actions';

/**
 * Track 4 #84 (Section P) — Notification-inbox client.
 *
 * # State-management
 *
 * Wir spiegeln den server-side state (notifications-prop) in lokaler
 * useState wider damit die UI sofort updates zeigt nach mark-read-actions,
 * ohne auf den revalidatePath-roundtrip warten zu müssen.
 *
 * Pattern:
 *   1. User klickt "mark read" auf row X
 *   2. Optimistic update: lokaler state setzt readAt für X (UI re-rendert
 *      sofort, item kriegt "gelesen"-styling)
 *   3. startTransition → server-action läuft im hintergrund
 *   4. Bei success: lokaler state ist schon korrekt, nichts mehr zu tun.
 *      Server hat über revalidatePath('/notifications') den page-cache
 *      invalidiert; das nächste mal wenn der pilot die page lädt, sieht
 *      er den frischen state.
 *   5. Bei error: revertieren wir den lokalen state + zeigen toast.
 *
 * # Why not useOptimistic?
 *
 * useOptimistic ist next.js 14+ idiomatic für dieses pattern. Wir nutzen
 * hier stattdessen useState weil:
 *   - useOptimistic erwartet dass der parent-state aus einem server-
 *     component kommt der nach mutation re-fetched wird. Das ist hier
 *     der fall (page.tsx ist RSC, revalidatePath triggert re-fetch).
 *   - ABER: revalidatePath in einer server-action triggert kein full
 *     navigation — der client-component-tree wird re-rendered mit
 *     fresh props. useOptimistic würde dann den lokalen optimistic-
 *     state revertieren weil der "echte" wert kommt.
 *   - useState + manual revert-on-error ist hier transparenter und
 *     weniger fragil. Wenn das pattern an mehreren stellen gebraucht
 *     wird, kann es später in einen useOptimistic-hook konsolidiert
 *     werden.
 */

/** Mapping kind → icon + tailwind-color für badge. */
const KIND_META: Record<string, { icon: string; label: string; colorClass: string }> = {
  info: { icon: 'ℹ️', label: 'Info', colorClass: 'text-blue-600 dark:text-blue-400' },
  warning: { icon: '⚠️', label: 'Warnung', colorClass: 'text-amber-600 dark:text-amber-400' },
  success: { icon: '✅', label: 'Erfolg', colorClass: 'text-emerald-600 dark:text-emerald-400' },
  event: { icon: '📅', label: 'Event', colorClass: 'text-violet-600 dark:text-violet-400' },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? KIND_META.info;
}

export function NotificationsList({
  initial,
}: {
  initial: NotificationListItem[];
}) {
  const [items, setItems] = useState(initial);
  const [pending, startTransition] = useTransition();

  const unreadCount = items.filter((n) => n.readAt === null).length;

  function handleMarkOne(id: string) {
    // Optimistic update
    const previous = items;
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n)),
    );

    startTransition(async () => {
      try {
        await markNotificationRead(id);
        // success: optimistic-state ist schon korrekt
      } catch (e) {
        // Revert
        setItems(previous);
        toastError(e);
      }
    });
  }

  function handleMarkAll() {
    if (unreadCount === 0) return;

    const previous = items;
    const now = new Date();
    setItems((prev) =>
      prev.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)),
    );

    startTransition(async () => {
      try {
        const { count } = await markAllNotificationsRead();
        toastSuccess(
          count === 1
            ? '1 Benachrichtigung als gelesen markiert'
            : `${count} Benachrichtigungen als gelesen markiert`,
        );
      } catch (e) {
        setItems(previous);
        toastError(e);
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
        <div className="text-4xl mb-2" aria-hidden="true">📭</div>
        <p className="text-sm font-medium">Keine Benachrichtigungen</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Hier erscheinen System-Nachrichten und Broadcasts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top-bar mit unread-count + mark-all */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
        <div className="text-sm">
          {unreadCount > 0 ? (
            <span>
              <span className="font-medium">{unreadCount}</span>{' '}
              {unreadCount === 1 ? 'ungelesene' : 'ungelesene'} von{' '}
              <span className="font-medium">{items.length}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              Alle gelesen ({items.length})
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || pending}
          onClick={handleMarkAll}
        >
          {pending && unreadCount > 0
            ? 'Markiert…'
            : 'Alle als gelesen markieren'}
        </Button>
      </div>

      {/* Notification-rows */}
      <ul className="space-y-2">
        {items.map((n) => {
          const meta = kindMeta(n.kind);
          const isUnread = n.readAt === null;

          return (
            <li
              key={n.id}
              className={cn(
                'rounded-md border bg-card transition',
                isUnread
                  ? 'border-primary/40 shadow-sm'
                  : 'border-border opacity-75',
              )}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                {/* Kind-icon */}
                <div
                  className={cn('mt-0.5 text-xl shrink-0', meta.colorClass)}
                  aria-hidden="true"
                  title={meta.label}
                >
                  {meta.icon}
                </div>

                {/* Title + body + meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className={cn(
                        'text-sm',
                        isUnread ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {n.title}
                    </h3>
                    {isUnread && (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-primary"
                        aria-label="Ungelesen"
                      />
                    )}
                    {n.isBroadcast && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                        An alle
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line break-words">
                    {n.body}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-foreground">
                    {n.authorName && (
                      <>
                        <span>von {n.authorName}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span title={n.createdAt.toLocaleString('de-DE')}>
                      {formatRelativeTime(n.createdAt.getTime())}
                    </span>
                  </div>
                </div>

                {/* Per-row action */}
                {isUnread && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMarkOne(n.id)}
                    disabled={pending}
                    className="shrink-0 text-xs"
                  >
                    Gelesen
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
