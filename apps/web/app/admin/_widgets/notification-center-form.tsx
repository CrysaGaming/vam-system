'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  sendNotificationAction,
  type ActionResult,
} from '../notifications/actions';

/**
 * Track 3 #11.2.5 v1-Full Item 8/10 — Notification-Center send-form
 * (client component, vision §9.3.10).
 *
 * # Mode-toggle
 *
 * Zwei modi visuell getrennt: "Broadcast an alle" vs "Per pilot".
 * Default = broadcast weil 80% der use-cases (maintenance-windows, neue-
 * features). Toggle ist ein radio-pair, kein dropdown — sichtbarer.
 *
 * Bei per-pilot-mode wird ein zweites text-input für die user-id frei-
 * gegeben. Wir akzeptieren v1 nur die rohe user-id (cuid-string) — ein
 * autocomplete-search wäre cooler aber das ist L-tier (eigenes ticket).
 * Admins können die ID aus /admin/pilots-row kopieren.
 *
 * # Reset nach erfolg
 *
 * resetKey-pattern aus admin/awards/admin-forms.tsx: bei state.ok wird
 * der form-key inkrementiert → react remounted das form → felder leer.
 * Sonst würde die zuletzt-gesendete nachricht im titel-feld stehen
 * bleiben, was admin verwirrt ("hab ich's nochmal abgeschickt?").
 *
 * # Form-validation
 *
 * Native HTML constraints (required, minLength) blocken die häufigsten
 * tippfehler vor dem submit. Echte validation läuft serverseitig (zod
 * in actions.ts). state.error rendert dann unten die meldung.
 */
export function NotificationCenterForm() {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(sendNotificationAction, null);
  const [resetKey, setResetKey] = useState(0);
  const [mode, setMode] = useState<'broadcast' | 'per-user'>('broadcast');
  const lastOkRef = useRef(false);

  // Reset form on successful submit. We track the previous ok-state via
  // ref damit reset nicht doppelt läuft wenn react den effect re-runned.
  useEffect(() => {
    if (state?.ok && !lastOkRef.current) {
      setResetKey((k) => k + 1);
      lastOkRef.current = true;
    } else if (!state?.ok) {
      lastOkRef.current = false;
    }
  }, [state]);

  return (
    <form key={resetKey} action={formAction} className="space-y-3">
      {/* Mode-toggle: broadcast vs per-user */}
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode-radio"
            value="broadcast"
            checked={mode === 'broadcast'}
            onChange={() => setMode('broadcast')}
            className="accent-primary"
          />
          <span>📢 Broadcast (alle piloten)</span>
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode-radio"
            value="per-user"
            checked={mode === 'per-user'}
            onChange={() => setMode('per-user')}
            className="accent-primary"
          />
          <span>👤 Per pilot</span>
        </label>
      </div>

      {/* Recipient-input: nur wenn per-user-mode. Bei broadcast leer
          gelassen → server-action interpretiert leerstring als null. */}
      {mode === 'per-user' ? (
        <div>
          <label
            htmlFor="notif-recipient"
            className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400"
          >
            Empfänger User-ID
          </label>
          <input
            id="notif-recipient"
            name="recipientId"
            required
            minLength={1}
            placeholder="z.B. cuid aus /admin/pilots..."
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-xs font-mono"
          />
        </div>
      ) : (
        <input type="hidden" name="recipientId" value="" />
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label
            htmlFor="notif-title"
            className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400"
          >
            Titel
          </label>
          <input
            id="notif-title"
            name="title"
            required
            minLength={2}
            maxLength={120}
            placeholder="z.B. Wartung Sonntag 8-10 Uhr"
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="notif-kind"
            className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400"
          >
            Typ
          </label>
          <select
            id="notif-kind"
            name="kind"
            defaultValue="info"
            className="px-2 py-1.5 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          >
            <option value="info">ℹ️ Info</option>
            <option value="warning">⚠️ Warnung</option>
            <option value="success">✅ Erfolg</option>
            <option value="event">📅 Event</option>
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="notif-body"
          className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400"
        >
          Nachricht
        </label>
        <textarea
          id="notif-body"
          name="body"
          required
          minLength={2}
          maxLength={2000}
          rows={3}
          placeholder="Was sollen die piloten wissen?"
          className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm resize-y"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded hover:opacity-90 disabled:opacity-50 transition"
        >
          {pending
            ? 'Wird gesendet…'
            : mode === 'broadcast'
              ? 'Broadcast senden'
              : 'An pilot senden'}
        </button>
        {state?.ok && (
          <span className="text-xs text-green-600 dark:text-green-400">
            ✓ {state.message}
          </span>
        )}
        {state && !state.ok && (
          <span className="text-xs text-red-600 dark:text-red-400">
            ✗ {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
