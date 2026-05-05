'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  createEventAction,
  updateEventAction,
  publishEventAction,
  cancelEventAction,
  completeEventAction,
  deleteEventAction,
  markParticipantCompletedAction,
  unmarkParticipantCompletedAction,
  type ActionResult,
} from './actions';
import type { Event, EventStatus } from '@vam/db';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Admin client components.
 *
 * Forms + state-transition-buttons. Server-actions in actions.ts.
 *
 * # Form-pattern
 *
 * useActionState für create/update mit pending-feedback. Datums-felder
 * als <input type="datetime-local"> — der browser handelt picker-UI,
 * value-format ist "YYYY-MM-DDTHH:MM" was new Date() problemlos parst.
 *
 * Legs als JSON-textarea — kein structured editor im MVP. Admin kopiert
 * sich ein template oder edited das JSON manuell. Beispiel-snippet im
 * placeholder zeigt das format.
 */

// ─────────────────────────────────────────────────────────────────────
// Helper: convert Date → datetime-local input value
// ─────────────────────────────────────────────────────────────────────

/**
 * Browser's <input type="datetime-local"> erwartet "YYYY-MM-DDTHH:MM"
 * in lokaler zeitzone. Date.toISOString() liefert UTC mit "Z" — das
 * würde der input nicht akzeptieren. Wir formatieren manuell mit
 * lokalen getter-methoden.
 */
function toDateTimeLocalValue(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────────
// Shared form-fields (gemeinsam für Create + Edit)
// ─────────────────────────────────────────────────────────────────────

const KIND_OPTIONS = [
  { value: 'TOUR', label: 'Tour' },
  { value: 'SINGLE_FLIGHT', label: 'Single-Flight' },
  { value: 'THEMED', label: 'Themen-Event' },
  { value: 'GROUP_FLIGHT', label: 'Group-Flight' },
  { value: 'SEASONAL', label: 'Saison-Event' },
];

const LEG_PLACEHOLDER = `[
  {"icao": "EDDF", "label": "Frankfurt", "note": "Treffpunkt 18:00 UTC"},
  {"icao": "LFPG", "label": "Paris CDG"},
  {"icao": "LEMD", "label": "Madrid"}
]`;

type EventFormDefaults = {
  airlineId?: string | null;
  title?: string;
  description?: string;
  kind?: string;
  coverImageUrl?: string | null;
  bonusReward?: number;
  maxParticipants?: number | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  legs?: unknown;
};

function EventFormFields({
  defaults,
  airlines,
  idPrefix,
}: {
  defaults: EventFormDefaults;
  airlines: Array<{ id: string; name: string }>;
  idPrefix: string;
}) {
  // Legs als JSON-string formatieren für textarea-default
  const legsDefault =
    defaults.legs && Array.isArray(defaults.legs) && defaults.legs.length > 0
      ? JSON.stringify(defaults.legs, null, 2)
      : '';

  return (
    <>
      <div>
        <label
          htmlFor={`${idPrefix}-airlineId`}
          className="block text-sm font-medium mb-1"
        >
          Airline
          <span className="text-gray-500 font-normal text-xs ml-2">
            (leer = VA-weit, sichtbar für alle airlines)
          </span>
        </label>
        <select
          id={`${idPrefix}-airlineId`}
          name="airlineId"
          defaultValue={defaults.airlineId ?? ''}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
        >
          <option value="">— VA-weit —</option>
          {airlines.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-title`} className="block text-sm font-medium mb-1">
          Titel
        </label>
        <input
          id={`${idPrefix}-title`}
          name="title"
          required
          minLength={3}
          maxLength={120}
          defaultValue={defaults.title ?? ''}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          placeholder="z.B. DLH Europa-Tour Mai 2026"
        />
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-description`}
          className="block text-sm font-medium mb-1"
        >
          Beschreibung
        </label>
        <textarea
          id={`${idPrefix}-description`}
          name="description"
          required
          rows={5}
          minLength={10}
          maxLength={5000}
          defaultValue={defaults.description ?? ''}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm resize-y"
          placeholder="Was ist das Event? Wer ist eingeladen? Was wird geflogen?"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-kind`} className="block text-sm font-medium mb-1">
            Art
          </label>
          <select
            id={`${idPrefix}-kind`}
            name="kind"
            defaultValue={defaults.kind ?? 'THEMED'}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-bonusReward`}
            className="block text-sm font-medium mb-1"
          >
            Completion-Bonus (VAM$)
          </label>
          <input
            id={`${idPrefix}-bonusReward`}
            name="bonusReward"
            type="number"
            min={0}
            max={100000}
            step={50}
            defaultValue={defaults.bonusReward ?? 0}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`${idPrefix}-startsAt`}
            className="block text-sm font-medium mb-1"
          >
            Beginn
          </label>
          <input
            id={`${idPrefix}-startsAt`}
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={toDateTimeLocalValue(defaults.startsAt ?? null)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-endsAt`} className="block text-sm font-medium mb-1">
            Ende
            <span className="text-gray-500 font-normal text-xs ml-2">
              (optional)
            </span>
          </label>
          <input
            id={`${idPrefix}-endsAt`}
            name="endsAt"
            type="datetime-local"
            defaultValue={toDateTimeLocalValue(defaults.endsAt ?? null)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`${idPrefix}-maxParticipants`}
            className="block text-sm font-medium mb-1"
          >
            Max. Teilnehmer
            <span className="text-gray-500 font-normal text-xs ml-2">
              (leer = unbegrenzt)
            </span>
          </label>
          <input
            id={`${idPrefix}-maxParticipants`}
            name="maxParticipants"
            type="number"
            min={1}
            max={10000}
            defaultValue={defaults.maxParticipants ?? ''}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
            placeholder="z.B. 25"
          />
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-coverImageUrl`}
            className="block text-sm font-medium mb-1"
          >
            Cover-Bild URL
            <span className="text-gray-500 font-normal text-xs ml-2">
              (https://, optional)
            </span>
          </label>
          <input
            id={`${idPrefix}-coverImageUrl`}
            name="coverImageUrl"
            type="url"
            maxLength={500}
            defaultValue={defaults.coverImageUrl ?? ''}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
            placeholder="https://..."
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-legs`} className="block text-sm font-medium mb-1">
          Strecken (JSON-array)
          <span className="text-gray-500 font-normal text-xs ml-2">
            (optional, nur für Tours)
          </span>
        </label>
        <textarea
          id={`${idPrefix}-legs`}
          name="legs"
          rows={6}
          defaultValue={legsDefault}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-xs font-mono resize-y"
          placeholder={LEG_PLACEHOLDER}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Format: <code>{`[{"icao": "EDDF", "label": "Frankfurt", "note": "..."}]`}</code>
        </p>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CreateEventForm
// ─────────────────────────────────────────────────────────────────────

export function CreateEventForm({
  airlines,
}: {
  airlines: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(createEventAction, null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state?.ok) setResetKey((k) => k + 1);
  }, [state?.ok]);

  return (
    <form key={resetKey} action={formAction} className="space-y-3 max-w-3xl">
      <EventFormFields defaults={{}} airlines={airlines} idPrefix="create" />
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-200 dark:border-gray-800">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded text-sm font-medium transition"
        >
          {pending ? 'Wird angelegt…' : 'Event als Entwurf anlegen'}
        </button>
        {state && (
          <p
            className={`text-xs ${
              state.ok
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
            role={state.ok ? 'status' : 'alert'}
          >
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EditEventForm
// ─────────────────────────────────────────────────────────────────────

export function EditEventForm({
  event,
  airlines,
}: {
  event: Event;
  airlines: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(updateEventAction, null);

  return (
    <form action={formAction} className="space-y-3 max-w-3xl">
      <input type="hidden" name="id" value={event.id} />
      <EventFormFields
        defaults={{
          airlineId: event.airlineId,
          title: event.title,
          description: event.description,
          kind: event.kind,
          coverImageUrl: event.coverImageUrl,
          bonusReward: Number(event.bonusReward),
          maxParticipants: event.maxParticipants,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          legs: event.legs,
        }}
        airlines={airlines}
        idPrefix={`edit-${event.id}`}
      />
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-200 dark:border-gray-800">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded text-sm font-medium transition"
        >
          {pending ? 'Wird gespeichert…' : 'Speichern'}
        </button>
        {state && (
          <p
            className={`text-xs ${
              state.ok
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
            role={state.ok ? 'status' : 'alert'}
          >
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// State-transition buttons (Publish/Cancel/Complete)
// ─────────────────────────────────────────────────────────────────────

/**
 * Generic transition-button mit confirmation-dialog. Wird für publish,
 * cancel, complete + delete genutzt — alle haben dieselbe shape.
 */
function TransitionButton({
  action,
  eventId,
  label,
  pendingLabel,
  confirmMessage,
  variant,
}: {
  action: (id: string) => Promise<ActionResult>;
  eventId: string;
  label: string;
  pendingLabel: string;
  confirmMessage?: string;
  variant: 'primary' | 'warning' | 'danger' | 'success';
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleClick() {
    if (confirmMessage && !confirm(confirmMessage)) return;
    setPending(true);
    setMessage(null);
    setIsError(false);
    const result = await action(eventId);
    setPending(false);
    if (result.ok) {
      setMessage(result.message);
    } else {
      setMessage(result.error);
      setIsError(true);
    }
  }

  const styles: Record<typeof variant, string> = {
    primary:
      'bg-indigo-600 hover:bg-indigo-700 text-white',
    warning:
      'bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-100',
    danger:
      'bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300',
    success:
      'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200',
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`px-3 py-1.5 text-xs rounded font-medium transition disabled:opacity-50 ${styles[variant]}`}
      >
        {pending ? pendingLabel : label}
      </button>
      {message && (
        <span
          className={`text-xs ${
            isError
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}
          role={isError ? 'alert' : 'status'}
        >
          {message}
        </span>
      )}
    </div>
  );
}

/**
 * State-buttons-row. Rendert die je-nach-status-erlaubten transitions.
 *   - DRAFT: Publish, Delete
 *   - PUBLISHED: Cancel, Complete
 *   - COMPLETED: (nichts — finaler state)
 *   - CANCELLED: Delete (cancelled events können noch gelöscht werden)
 */
export function EventStateButtons({
  eventId,
  status,
  title,
}: {
  eventId: string;
  status: EventStatus;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'DRAFT' && (
        <>
          <TransitionButton
            action={publishEventAction}
            eventId={eventId}
            label="Publizieren"
            pendingLabel="Publiziere…"
            confirmMessage={`Event "${title}" jetzt publizieren? Discord-announcement wird gepostet und pilots können sich anmelden.`}
            variant="primary"
          />
          <TransitionButton
            action={deleteEventAction}
            eventId={eventId}
            label="Löschen"
            pendingLabel="Lösche…"
            confirmMessage={`Event "${title}" (DRAFT) wirklich löschen?`}
            variant="danger"
          />
        </>
      )}
      {status === 'PUBLISHED' && (
        <>
          <TransitionButton
            action={completeEventAction}
            eventId={eventId}
            label="Abschließen"
            pendingLabel="Schließe ab…"
            confirmMessage={`Event "${title}" als abgeschlossen markieren? Anmeldungen werden geschlossen.`}
            variant="success"
          />
          <TransitionButton
            action={cancelEventAction}
            eventId={eventId}
            label="Absagen"
            pendingLabel="Sage ab…"
            confirmMessage={`Event "${title}" wirklich absagen? Anmeldungen bleiben als audit-trail erhalten.`}
            variant="warning"
          />
        </>
      )}
      {status === 'CANCELLED' && (
        <TransitionButton
          action={deleteEventAction}
          eventId={eventId}
          label="Endgültig löschen"
          pendingLabel="Lösche…"
          confirmMessage={`Event "${title}" (abgesagt) endgültig löschen? Anmeldungen werden mit-gelöscht.`}
          variant="danger"
        />
      )}
      {status === 'COMPLETED' && (
        <span className="text-xs text-gray-500 dark:text-gray-400 italic">
          Abgeschlossen — kein status-wechsel mehr möglich.
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MarkParticipantButton (per-row toggle in detail-page)
// ─────────────────────────────────────────────────────────────────────

export function MarkParticipantButton({
  participantId,
  completed,
  pilotName,
  bonusReward,
}: {
  participantId: string;
  completed: boolean;
  pilotName: string;
  bonusReward: number;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleClick() {
    let confirmMsg: string;
    if (completed) {
      confirmMsg = `Completion-flag für ${pilotName} zurücksetzen? Bonus-VAM$ bleiben im wallet (nicht rückbuchbar).`;
    } else if (bonusReward > 0) {
      confirmMsg = `${pilotName} als abgeschlossen markieren? +${bonusReward} VAM$ werden gutgeschrieben.`;
    } else {
      confirmMsg = `${pilotName} als abgeschlossen markieren?`;
    }
    if (!confirm(confirmMsg)) return;

    setPending(true);
    setMessage(null);
    setIsError(false);
    const result = completed
      ? await unmarkParticipantCompletedAction(participantId)
      : await markParticipantCompletedAction(participantId);
    setPending(false);
    if (result.ok) {
      setMessage(result.message);
    } else {
      setMessage(result.error);
      setIsError(true);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`px-2.5 py-1 text-xs rounded font-medium transition disabled:opacity-50 ${
          completed
            ? 'bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300'
            : 'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
        }`}
      >
        {pending
          ? '…'
          : completed
            ? '↶ Zurücksetzen'
            : '✓ Abschließen'}
      </button>
      {message && (
        <span
          className={`text-xs ${
            isError
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}
          role={isError ? 'alert' : 'status'}
        >
          {message}
        </span>
      )}
    </div>
  );
}
