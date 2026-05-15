'use client';

/**
 * Welle O / O4 — Add-reward form for /settings/twitch/channel-points.
 *
 * Client component because the payload-field section is conditional on
 * the selected actionType (dropdown choice changes which input fields
 * appear underneath). Server-component rendering can't do that without
 * full page round-trips on every dropdown change — useState makes it
 * snappy.
 *
 * # Why no edit-mode here
 *
 * Channel-point reward mappings are rarely edited — they're tied to a
 * specific Twitch reward UUID, so "edit" really means "change action-
 * type" or "change payload-config". The list-row already supports
 * toggle (en/disable) + delete. Edit-flow would mean prefilling 4
 * conditional fields based on the existing payloadJson which adds
 * meaningful complexity without changing the streamer's workflow:
 * deleting and re-adding is two clicks instead of "edit→save".
 *
 * If user-feedback shows people repeatedly delete+recreate the same
 * mapping (visible in created/deleted log if we track), we'll add
 * inline-edit then.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ChannelPointActionType } from '@vam/db';
import { createReward, toggleReward, deleteReward } from './actions';

// Catalog of supported action-types with display-metadata. The order
// here drives the dropdown render-order — most-common (fuel bonus =
// "give me money") first, niche (weather nudge = needs active flight)
// last.
const ACTION_CATALOG: Array<{
  value: ChannelPointActionType;
  label: string;
  emoji: string;
  blurb: string;
}> = [
  {
    value: 'FUEL_BONUS',
    label: 'Fuel Bonus',
    emoji: '💰',
    blurb: 'VAM$-credit auf dein wallet pro redemption.',
  },
  {
    value: 'CALLSIGN_SHOUT',
    label: 'Callsign Shout',
    emoji: '📢',
    blurb: 'Bot postet "@viewer redeemed pilot shout" in Discord.',
  },
  {
    value: 'GATE_REQUEST',
    label: 'Gate Request',
    emoji: '🛬',
    blurb: 'Viewer kann während des fluges ein gate vorschlagen (nur bei aktiver flight).',
  },
  {
    value: 'WEATHER_NUDGE',
    label: 'Weather Nudge',
    emoji: '🌦️',
    blurb: 'Viewer kann eine wetter-vorlage vorschlagen (nur bei aktiver flight).',
  },
];

export function AddRewardForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionType, setActionType] = useState<ChannelPointActionType>('FUEL_BONUS');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form-level reset hint. Used to clear inputs after a successful
  // submit without un-mounting the form (which would lose focus and
  // dropdown position). We bump a key on the inner container.
  const [formKey, setFormKey] = useState(0);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await createReward(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess('Mapping angelegt ✓');
      setFormKey((k) => k + 1);
      setActionType('FUEL_BONUS'); // reset to default
      router.refresh();
    });
  }

  const selectedAction = ACTION_CATALOG.find((a) => a.value === actionType)!;

  return (
    <form
      action={handleSubmit}
      key={formKey}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Neues mapping hinzufügen
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Verknüpfe eine Twitch channel-point reward mit einer in-flight
          action. Die reward-ID findest du im Twitch-creator-dashboard
          (URL-segment beim öffnen der reward).
        </p>
      </div>

      {/* Twitch reward-ID */}
      <div>
        <label
          htmlFor="twitchRewardId"
          className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Twitch reward-ID
        </label>
        <input
          id="twitchRewardId"
          name="twitchRewardId"
          type="text"
          required
          maxLength={64}
          placeholder="z.B. 92af9d4e-3da7-4b88-9c4c-..."
          className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* Reward-Titel (display) */}
      <div>
        <label
          htmlFor="rewardTitle"
          className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Reward-Titel (display)
        </label>
        <input
          id="rewardTitle"
          name="rewardTitle"
          type="text"
          required
          maxLength={120}
          placeholder="z.B. Pilot Shout-out"
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Wird nur in dieser Liste benutzt. Bei jeder redemption updaten
          wir den titel zum aktuellen Twitch-wert (falls du umbenennst).
        </p>
      </div>

      {/* Action-typ dropdown */}
      <div>
        <label
          htmlFor="actionType"
          className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Action-typ
        </label>
        <select
          id="actionType"
          name="actionType"
          value={actionType}
          onChange={(e) => setActionType(e.target.value as ChannelPointActionType)}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
        >
          {ACTION_CATALOG.map((a) => (
            <option key={a.value} value={a.value}>
              {a.emoji} {a.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedAction.blurb}
        </p>
      </div>

      {/* Action-type-conditional payload fields */}
      {actionType === 'FUEL_BONUS' && (
        <div>
          <label
            htmlFor="payload_amountVam"
            className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Bonus-Betrag (VAM$)
          </label>
          <input
            id="payload_amountVam"
            name="payload_amountVam"
            type="number"
            required
            min={1}
            max={1000}
            defaultValue={25}
            className="w-32 rounded border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Wird vom system-wallet auf dein wallet überwiesen. 1-1000.
          </p>
        </div>
      )}

      {actionType === 'CALLSIGN_SHOUT' && (
        <p className="text-xs text-muted-foreground">
          Keine zusätzliche konfiguration. Bei jeder redemption postet
          der bot @viewer in deinem #livestreams-channel.
        </p>
      )}

      {actionType === 'GATE_REQUEST' && (
        <div>
          <label
            htmlFor="payload_label"
            className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Custom-Label (optional)
          </label>
          <input
            id="payload_label"
            name="payload_label"
            type="text"
            maxLength={80}
            placeholder="z.B. Approach Request"
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Frei lassen für default "Gate change request".
          </p>
        </div>
      )}

      {actionType === 'WEATHER_NUDGE' && (
        <div>
          <label
            htmlFor="payload_preset"
            className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Wetter-Preset
          </label>
          <input
            id="payload_preset"
            name="payload_preset"
            type="text"
            required
            maxLength={40}
            placeholder="z.B. fog, thunderstorm, clear"
            className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none"
          />
        </div>
      )}

      {/* Error/success messages */}
      {error && (
        <div className="rounded border border-rose-400/40 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded border border-emerald-400/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Speichere…' : 'Mapping hinzufügen'}
      </button>
    </form>
  );
}

// ────────────────────────────────────────────────────────────
// Per-row buttons (toggle + delete) — separate client component
// ────────────────────────────────────────────────────────────

/**
 * Inline action-buttons for an existing reward row. Lives next to the
 * row in the table; uses useTransition so the row dims while a write
 * is in flight without unmounting.
 */
export function RewardRowActions({
  rewardId,
  isEnabled,
}: {
  rewardId: string;
  isEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = await toggleReward(rewardId);
      if (!result.ok) {
        setError(result.error ?? 'Fehler beim toggle');
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (
      !confirm(
        'Mapping wirklich löschen? Historische redemption-logs bleiben erhalten (mapping wird auf null gesetzt).',
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteReward(rewardId);
      if (!result.ok) {
        setError(result.error ?? 'Fehler beim löschen');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={`rounded px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          isEnabled
            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/60'
            : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
        }`}
        title={isEnabled ? 'Aktiv — klicken zum deaktivieren' : 'Deaktiviert — klicken zum aktivieren'}
      >
        {isEnabled ? '✓ Aktiv' : '○ Deaktiviert'}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50"
        title="Löschen"
      >
        Löschen
      </button>
      {error && (
        <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
      )}
    </div>
  );
}
