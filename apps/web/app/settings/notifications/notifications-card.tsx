'use client';

import { useState, useTransition } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toastError } from '@/lib/toast';
import {
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  getPref,
  setPref,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPrefs,
} from '@/lib/notification-prefs';

import { updateNotificationPref } from './actions';

/**
 * Track 4 #81 (Section P) — NotificationsCard (client component).
 *
 * Tabellarisches grid (rows=categories, cols=[in-app, email]) mit
 * optimistic-toggle-updates. Per row: icon + label + description links,
 * zwei Switch-controls rechts. Email-column ist visuell als "Bald
 * verfügbar" gekennzeichnet (greyed-out badge) bis Track 4 #82 die
 * email-dispatch-infrastructure freischaltet — die toggles funktionieren
 * aber schon, damit die prefs zum #82-launch-day direkt aktiv sind.
 *
 * # Optimistic-update pattern
 *
 * Bei jedem toggle-flip:
 *   1. setPrefs(setPref(prefs, category, channel, newValue))   // sofort UI
 *   2. server-action updateNotificationPref({category, channel, value})
 *   3. wenn FAIL: setPrefs(prevPrefs) revert + toastError
 *   4. wenn OK: keep optimistic state (server hat exakt das gleiche
 *      computed) — KEIN re-set damit kein render-flackern
 *
 * Mirrors das pattern in economy-card.tsx und career-card.tsx aus Welle
 * 13D-1/13E-3 — proven für settings-toggles.
 */
export function NotificationsCard({
  initialPrefs,
}: {
  initialPrefs: NotificationPrefs;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [pending, startTransition] = useTransition();

  // Track welcher (category, channel) gerade in-flight ist — disabled
  // den Switch optisch (verhindert auch double-click race).
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  function handleToggle(
    category: NotificationCategory,
    channel: NotificationChannel,
    newValue: boolean,
  ) {
    const key = `${category}.${channel}`;
    const previousPrefs = prefs;

    // Optimistic — UI flippt sofort.
    setPrefs((current) => setPref(current, category, channel, newValue));
    setPendingKey(key);

    startTransition(async () => {
      try {
        const result = await updateNotificationPref({
          category,
          channel,
          value: newValue,
        });
        if (!result.success) {
          // revert
          setPrefs(previousPrefs);
          toastError(result.error);
        }
        // wenn success: optimistic state matched server, kein re-set nötig.
      } catch (e) {
        // Network-error, exception, etc. — revert + toast.
        setPrefs(previousPrefs);
        toastError(e);
      } finally {
        setPendingKey(null);
      }
    });
  }

  return (
    <div className="flex flex-col">
      {/* Header-row */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border bg-muted/30 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <div>Kategorie</div>
        <div className="min-w-[80px] text-center">
          {CHANNEL_LABELS.inApp.shortLabel}
        </div>
        <div className="min-w-[80px] text-center">
          <span>{CHANNEL_LABELS.email.shortLabel}</span>
          {CHANNEL_LABELS.email.status === 'coming_soon' && (
            <span className="ml-1 align-middle text-[0.6rem] font-normal normal-case text-amber-600 dark:text-amber-400">
              (bald)
            </span>
          )}
        </div>
      </div>

      {/* Body-rows: eine pro category */}
      {NOTIFICATION_CATEGORIES.map((category, idx) => {
        const meta = CATEGORY_LABELS[category];
        const isLast = idx === NOTIFICATION_CATEGORIES.length - 1;
        return (
          <div
            key={category}
            className={cn(
              'grid grid-cols-[1fr_auto_auto] items-center gap-4 px-6 py-4',
              !isLast && 'border-b border-border',
            )}
          >
            {/* Left: icon + label + description */}
            <div className="flex items-start gap-3">
              <span
                className="shrink-0 text-2xl leading-none"
                aria-hidden="true"
              >
                {meta.icon}
              </span>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor={`notif-${category}-inApp`}
                  className="cursor-default text-sm font-medium text-foreground"
                >
                  {meta.label}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {meta.description}
                </p>
              </div>
            </div>

            {/* Per channel: one Switch */}
            {NOTIFICATION_CHANNELS.map((channel) => {
              const isChecked = getPref(prefs, category, channel);
              const key = `${category}.${channel}`;
              const isPendingThis = pendingKey === key;
              const isComingSoon =
                CHANNEL_LABELS[channel].status === 'coming_soon';

              return (
                <div
                  key={channel}
                  className="flex min-w-[80px] flex-col items-center gap-1"
                >
                  <Switch
                    id={`notif-${category}-${channel}`}
                    checked={isChecked}
                    onCheckedChange={(v) => handleToggle(category, channel, v)}
                    disabled={pending && !isPendingThis}
                    aria-label={`${meta.label} — ${CHANNEL_LABELS[channel].label}`}
                  />
                  {isComingSoon && (
                    <span className="text-[0.65rem] italic leading-tight text-muted-foreground/70">
                      bald
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
