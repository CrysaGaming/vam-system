'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminRevokeLicense,
  adminSuspendLicense,
  adminReinstateLicense,
  adminRevokeTypeRating,
  adminExtendTypeRating,
} from './actions';

interface LicenseActionsProps {
  licenseId: string;
  userId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'SUSPENDED';
}

/**
 * Per-license action-buttons. Status bestimmt welche actions verfügbar
 * sind:
 *   - ACTIVE   → "Suspendieren" + "Widerrufen"
 *   - SUSPENDED → "Reaktivieren" + "Widerrufen"
 *   - EXPIRED  → "Reaktivieren" (mit neuem expiry)
 *   - REVOKED  → "Reaktivieren" (admin-override; warning sichtbar)
 *
 * Click → modal mit reason-input öffnet. Confirm → server-action.
 */
export function LicenseActions({ licenseId, userId, status }: LicenseActionsProps) {
  const [openAction, setOpenAction] = useState<
    'revoke' | 'suspend' | 'reinstate' | null
  >(null);

  return (
    <div className="flex gap-1.5 flex-wrap">
      {(status === 'ACTIVE' || status === 'SUSPENDED') && (
        <button
          type="button"
          onClick={() => setOpenAction('revoke')}
          className="px-2 py-1 text-xs rounded border border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10 transition"
        >
          Widerrufen
        </button>
      )}
      {status === 'ACTIVE' && (
        <button
          type="button"
          onClick={() => setOpenAction('suspend')}
          className="px-2 py-1 text-xs rounded border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 transition"
        >
          Suspendieren
        </button>
      )}
      {(status === 'SUSPENDED' || status === 'EXPIRED' || status === 'REVOKED') && (
        <button
          type="button"
          onClick={() => setOpenAction('reinstate')}
          className="px-2 py-1 text-xs rounded border border-green-500/40 text-green-700 dark:text-green-300 hover:bg-green-500/10 transition"
        >
          Reaktivieren
        </button>
      )}

      {openAction === 'revoke' && (
        <ReasonModal
          title="Lizenz widerrufen"
          description="Lizenz wird auf REVOKED gesetzt. Audit-trail bleibt erhalten. Reason ist im audit-log sichtbar."
          confirmLabel="Widerrufen"
          confirmTone="red"
          onClose={() => setOpenAction(null)}
          onConfirm={async (reason) => {
            await adminRevokeLicense({ licenseId, userId, reason });
          }}
        />
      )}
      {openAction === 'suspend' && (
        <ReasonModal
          title="Lizenz suspendieren"
          description="Lizenz wird auf SUSPENDED gesetzt — temporäre suspension, jederzeit reaktivierbar. Reason wird im audit-log gespeichert."
          confirmLabel="Suspendieren"
          confirmTone="amber"
          onClose={() => setOpenAction(null)}
          onConfirm={async (reason) => {
            await adminSuspendLicense({ licenseId, userId, reason });
          }}
        />
      )}
      {openAction === 'reinstate' && (
        <ReinstateModal
          isFromRevoked={status === 'REVOKED'}
          onClose={() => setOpenAction(null)}
          onConfirm={async (reason, newExpiresAt) => {
            await adminReinstateLicense({
              licenseId,
              userId,
              reason: reason || null,
              newExpiresAt: newExpiresAt || null,
            });
          }}
        />
      )}
    </div>
  );
}

interface TypeRatingActionsProps {
  ratingId: string;
  userId: string;
  isExpired: boolean;
}

/**
 * Per-type-rating action-buttons. Type-ratings haben kein status-feld
 * (sie sind hard-deleted on revoke), also nur:
 *   - "Verlängern" (extendTypeRating mit optional newExpiresAt)
 *   - "Entfernen" (revokeTypeRating, hard-delete)
 *
 * "Reaktivieren" wenn expired = einfach "Verlängern" mit newExpiresAt.
 */
export function TypeRatingActions({ ratingId, userId }: TypeRatingActionsProps) {
  const [openAction, setOpenAction] = useState<
    'extend' | 'revoke' | null
  >(null);

  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => setOpenAction('extend')}
        className="px-2 py-1 text-xs rounded border border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 transition"
      >
        Verlängern
      </button>
      <button
        type="button"
        onClick={() => setOpenAction('revoke')}
        className="px-2 py-1 text-xs rounded border border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10 transition"
      >
        Entfernen
      </button>

      {openAction === 'extend' && (
        <ExtendModal
          onClose={() => setOpenAction(null)}
          onConfirm={async (newExpiresAt, notes) => {
            await adminExtendTypeRating({
              ratingId,
              userId,
              newExpiresAt: newExpiresAt || null,
              notes: notes || null,
            });
          }}
        />
      )}
      {openAction === 'revoke' && (
        <ReasonModal
          title="Type-Rating entfernen"
          description="Type-Rating wird komplett gelöscht. Hours-on-type bleiben in PIREP-history aber das rating-record selbst ist weg. Reason wird im server-log gespeichert."
          confirmLabel="Entfernen"
          confirmTone="red"
          onClose={() => setOpenAction(null)}
          onConfirm={async (reason) => {
            await adminRevokeTypeRating({ ratingId, userId, reason });
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Modals
// ─────────────────────────────────────────────────────────────────────────

function ReasonModal({
  title,
  description,
  confirmLabel,
  confirmTone,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone: 'red' | 'amber' | 'green';
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    if (reason.trim().length < 3) {
      setError('Reason muss mindestens 3 Zeichen lang sein.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm(reason);
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  const toneClasses = {
    red: 'bg-red-600 hover:bg-red-500',
    amber: 'bg-amber-600 hover:bg-amber-500',
    green: 'bg-green-600 hover:bg-green-500',
  }[confirmTone];

  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">{description}</p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (mind. 3 Zeichen)..."
        rows={3}
        maxLength={500}
        autoFocus
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
      />
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className={`px-3 py-1.5 text-sm font-semibold rounded text-white transition disabled:opacity-50 ${toneClasses}`}
        >
          {pending ? '…' : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ReinstateModal({
  isFromRevoked,
  onConfirm,
  onClose,
}: {
  isFromRevoked: boolean;
  onConfirm: (reason: string, newExpiresAt: string) => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm(reason, newExpiresAt);
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <ModalShell title="Lizenz reaktivieren" onClose={onClose}>
      {isFromRevoked && (
        <div className="mb-3 px-3 py-2 rounded border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs">
          ⚠️ Diese Lizenz wurde widerrufen (REVOKED). Reaktivierung ist eine
          admin-override für fehlentscheidungen — bitte mit reason
          dokumentieren.
        </div>
      )}
      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
        Neuer Gültigkeitszeitraum (optional)
      </label>
      <input
        type="datetime-local"
        value={newExpiresAt}
        onChange={(e) => setNewExpiresAt(e.target.value)}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none mb-3"
      />
      <p className="text-xs text-gray-500 mb-3 -mt-2">
        Leer lassen = bisheriger expiresAt bleibt. Bei renewal nach
        recurrent-training neues datum setzen.
      </p>
      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
        Notizen (optional)
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="z.B. 'Recurrent-check 04/2026 bestanden'"
        rows={2}
        maxLength={500}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
      />
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="px-3 py-1.5 text-sm font-semibold rounded text-white transition bg-green-600 hover:bg-green-500 disabled:opacity-50"
        >
          {pending ? '…' : 'Reaktivieren'}
        </button>
      </div>
    </ModalShell>
  );
}

function ExtendModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (newExpiresAt: string, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [newExpiresAt, setNewExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm(newExpiresAt, notes);
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <ModalShell title="Type-Rating verlängern" onClose={onClose}>
      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
        Neues Ablaufdatum (optional)
      </label>
      <input
        type="datetime-local"
        value={newExpiresAt}
        onChange={(e) => setNewExpiresAt(e.target.value)}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none mb-3"
      />
      <p className="text-xs text-gray-500 mb-3 -mt-2">
        Leer lassen = +12 Monate ab altem expiresAt (oder ab heute wenn
        already expired).
      </p>
      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
        Notizen (optional)
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="z.B. 'Recurrent sim-check pass 04/2026'"
        rows={2}
        maxLength={500}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
      />
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="px-3 py-1.5 text-sm font-semibold rounded text-white transition bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? '…' : 'Verlängern'}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md mx-4 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
