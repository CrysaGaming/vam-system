'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  createAwardAction,
  updateAwardAction,
  deleteAwardAction,
  grantAwardAction,
  revokeAwardAction,
  type ActionResult,
} from './actions';
import type { Award } from '@vam/db';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Admin client components.
 *
 * Server-actions sind in actions.ts; hier sind die client-side wrappers
 * die forms rendern, useActionState für pending/errors handeln, und
 * confirmation-dialogs für destructive ops zeigen.
 *
 * Pattern spiegelt /admin/roles/* — collapsible <details>-card für
 * create-form, inline edit-buttons in der liste.
 */

// ─────────────────────────────────────────────────────────────────────
// CreateAwardForm
// ─────────────────────────────────────────────────────────────────────

export function CreateAwardForm() {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(createAwardAction, null);
  const [resetKey, setResetKey] = useState(0);

  // Bei erfolg formular zurücksetzen — useActionState behält state nach
  // submit, also würde sonst der alte input stehen bleiben. resetKey
  // forciert ein remount des form-elements.
  useEffect(() => {
    if (state?.ok) setResetKey((k) => k + 1);
  }, [state?.ok]);

  return (
    <form
      key={resetKey}
      action={formAction}
      className="space-y-3 max-w-xl"
    >
      <div>
        <label htmlFor="create-name" className="block text-sm font-medium mb-1">
          Name
        </label>
        <input
          id="create-name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          placeholder="z.B. PMDG-Master"
        />
      </div>
      <div>
        <label
          htmlFor="create-description"
          className="block text-sm font-medium mb-1"
        >
          Beschreibung
          <span className="text-gray-500 font-normal text-xs ml-2">
            (optional)
          </span>
        </label>
        <textarea
          id="create-description"
          name="description"
          rows={2}
          maxLength={500}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm resize-none"
          placeholder="Wofür wird der award vergeben?"
        />
      </div>
      <div>
        <label
          htmlFor="create-iconUrl"
          className="block text-sm font-medium mb-1"
        >
          Icon-URL
          <span className="text-gray-500 font-normal text-xs ml-2">
            (optional, muss https:// sein)
          </span>
        </label>
        <input
          id="create-iconUrl"
          name="iconUrl"
          type="url"
          maxLength={500}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          placeholder="https://..."
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded text-sm font-medium transition"
        >
          {pending ? 'Wird angelegt…' : 'Award anlegen'}
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
// EditAwardForm
// ─────────────────────────────────────────────────────────────────────

export function EditAwardForm({ award }: { award: Award }) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(updateAwardAction, null);

  return (
    <form action={formAction} className="space-y-3 max-w-xl">
      <input type="hidden" name="id" value={award.id} />
      <div>
        <label
          htmlFor={`edit-name-${award.id}`}
          className="block text-sm font-medium mb-1"
        >
          Name
        </label>
        <input
          id={`edit-name-${award.id}`}
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={award.name}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
        />
      </div>
      <div>
        <label
          htmlFor={`edit-description-${award.id}`}
          className="block text-sm font-medium mb-1"
        >
          Beschreibung
        </label>
        <textarea
          id={`edit-description-${award.id}`}
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={award.description ?? ''}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm resize-none"
        />
      </div>
      <div>
        <label
          htmlFor={`edit-iconUrl-${award.id}`}
          className="block text-sm font-medium mb-1"
        >
          Icon-URL
        </label>
        <input
          id={`edit-iconUrl-${award.id}`}
          name="iconUrl"
          type="url"
          maxLength={500}
          defaultValue={award.iconUrl ?? ''}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
        />
      </div>
      <div className="flex items-center justify-between gap-3">
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
// DeleteAwardButton (with confirmation)
// ─────────────────────────────────────────────────────────────────────

export function DeleteAwardButton({
  awardId,
  awardName,
  recipientCount,
}: {
  awardId: string;
  awardName: string;
  recipientCount: number;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmMsg =
      recipientCount > 0
        ? `Award "${awardName}" hat ${recipientCount} ${
            recipientCount === 1 ? 'vergabe' : 'vergaben'
          }. Beim löschen werden die alle entfernt. Wirklich löschen?`
        : `Award "${awardName}" wirklich löschen?`;
    if (!confirm(confirmMsg)) return;

    setPending(true);
    setError(null);
    const result = await deleteAwardAction(awardId);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
    }
    // Bei success: revalidate hat schon das page-refresh getriggert,
    // wir werden eh re-rendered.
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="px-3 py-1.5 text-xs bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded font-medium transition disabled:opacity-50"
      >
        {pending ? 'Wird gelöscht…' : 'Löschen'}
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// GrantAwardButton (per-pilot in admin detail page)
// ─────────────────────────────────────────────────────────────────────

export function GrantRevokeAwardButton({
  awardId,
  userId,
  earned,
}: {
  awardId: string;
  userId: string;
  earned: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleClick() {
    setPending(true);
    setMessage(null);
    setIsError(false);
    const result = earned
      ? await revokeAwardAction(awardId, userId)
      : await grantAwardAction(awardId, userId);
    setPending(false);
    if (result.ok) {
      setMessage(result.message);
      setIsError(false);
    } else {
      setMessage(result.error);
      setIsError(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`px-3 py-1.5 text-xs rounded font-medium transition disabled:opacity-50 ${
          earned
            ? 'bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300'
            : 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300'
        }`}
      >
        {pending ? '…' : earned ? 'Entziehen' : 'Vergeben'}
      </button>
      {message && (
        <span
          className={`text-xs ${
            isError
              ? 'text-red-600 dark:text-red-400'
              : 'text-green-600 dark:text-green-400'
          }`}
          role={isError ? 'alert' : 'status'}
        >
          {message}
        </span>
      )}
    </div>
  );
}
