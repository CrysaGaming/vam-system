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
 *   - "Recurrent Pass" (option #30 — pre-filled extend für den
 *     häufigsten use-case: pilot hat heute den recurrent-check
 *     bestanden, +12 Monate validity, standardized notes-template)
 *   - "Verlängern" (extendTypeRating mit manuell wählbarem datum/notes —
 *     für edge-cases wie backdated extensions oder non-standard
 *     validity-windows)
 *   - "Entfernen" (revokeTypeRating, hard-delete)
 *
 * "Reaktivieren" wenn expired = einfach "Recurrent Pass" oder
 * "Verlängern" mit newExpiresAt.
 *
 * Why two extend-buttons (Recurrent Pass + Verlängern):
 *
 * 95% of type-rating-extensions sind routine recurrent-checks (12-
 * monatszyklus, today's date, standard notes). Forcing admin durch das
 * generic ExtendModal mit leeren feldern für diesen common-case ist
 * unnötige reibung — sie tippen jedes mal die selben werte ein. Der
 * dedizierte "Recurrent Pass"-button öffnet den modal mit allem pre-
 * filled, admin bestätigt nur. Standardized notes ("Recurrent-check
 * passed on YYYY-MM-DD") machen den audit-trail searchable.
 *
 * Das generische "Verlängern" bleibt für edge-cases: pilot's check
 * war letzte woche aber wurde erst heute eingetragen, training-org gab
 * einen 6-monats-extension statt 12, etc.
 */
export function TypeRatingActions({ ratingId, userId }: TypeRatingActionsProps) {
  const [openAction, setOpenAction] = useState<
    'recurrent' | 'extend' | 'revoke' | null
  >(null);

  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => setOpenAction('recurrent')}
        className="px-2 py-1 text-xs rounded border border-green-500/40 text-green-700 dark:text-green-300 hover:bg-green-500/10 transition font-semibold"
        title="Recurrent-Check bestanden — +12 Monate ab heute (oder gewähltem datum)"
      >
        Recurrent Pass
      </button>
      <button
        type="button"
        onClick={() => setOpenAction('extend')}
        className="px-2 py-1 text-xs rounded border border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 transition"
        title="Generic extend mit manuell wählbarem datum/notes — für edge-cases"
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

      {openAction === 'recurrent' && (
        <RecurrentPassModal
          onClose={() => setOpenAction(null)}
          onConfirm={async (newExpiresAt, notes) => {
            await adminExtendTypeRating({
              ratingId,
              userId,
              newExpiresAt,
              notes,
            });
          }}
        />
      )}
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

/**
 * RecurrentPassModal — pre-filled extend für recurrent-check pass
 * (option #30). Common-case shortcut: pilot bestand heute den check,
 * +12 Monate validity ab check-date, standardized notes.
 *
 * # Inputs
 *
 * - check-date (default: heute) — wann der recurrent-check
 *   tatsächlich stattgefunden hat. Allows backdating wenn admin den
 *   pass nachträglich einträgt (paperwork-delay nach training-org).
 * - extra-notes (optional) — free-form additions to the standardized
 *   prefix. z.B. "sim type: A320 LOFT" oder "instructor: J. Smith".
 *
 * # Computed values (passed to adminExtendTypeRating)
 *
 * - newExpiresAt = check-date + 12 Monate. As datetime-local string
 *   "YYYY-MM-DDTHH:mm" weil das was der server-action erwartet
 *   (siehe ExtendTypeRatingSchema in actions.ts).
 * - notes = `Recurrent-check passed on YYYY-MM-DD${extra ? ': ' + extra : ''}`.
 *   Standardized prefix → searchable im audit-trail (z.B. "alle pirep-
 *   recurrent-passes der letzten 90 tage").
 *
 * # Why date-only input (not datetime)
 *
 * Recurrent-checks sind formal-checks die zu einem datum stattfinden,
 * nicht zu einem zeitpunkt. Pilot+training-org dokumentieren "passed
 * 2026-04-15", nicht "passed 2026-04-15 14:32:18". Date-input ist
 * einfacher zu setzen und matcht die geschäftsrealität.
 *
 * Computed expiresAt is in UTC at noon (12:00). Avoids timezone-edge-
 * cases where "expires at midnight local" could be off-by-one in some
 * tz; noon UTC is unambiguous and aligns with how aviation-paperwork
 * usually treats validity-windows.
 */
function RecurrentPassModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (newExpiresAt: string, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();

  // Today's date in YYYY-MM-DD format (local time). The HTML date input
  // expects this format. Local-time is correct here because the admin
  // is selecting "the day the check happened" from their perspective.
  const todayLocal = (() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();

  const [checkDate, setCheckDate] = useState(todayLocal);
  const [extraNotes, setExtraNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Compute new-expiresAt = check-date + 12 months. Date-arithmetic
  // with setMonth handles month-boundaries correctly (e.g. 2026-01-31
  // + 12mo = 2027-01-31, not 2027-01-30 like naive ms-addition would
  // produce). We set hours to noon UTC explicitly to avoid tz-edge.
  const newExpiresAtIso = (() => {
    if (!checkDate) return '';
    const [yyyy, mm, dd] = checkDate.split('-').map(Number);
    if (!yyyy || !mm || !dd) return '';
    // Date.UTC takes month 0-indexed
    const checkUtc = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
    const expires = new Date(checkUtc);
    expires.setUTCFullYear(expires.getUTCFullYear() + 1);
    // Format as datetime-local (server-action accepts that)
    const exYyyy = expires.getUTCFullYear();
    const exMm = String(expires.getUTCMonth() + 1).padStart(2, '0');
    const exDd = String(expires.getUTCDate()).padStart(2, '0');
    return `${exYyyy}-${exMm}-${exDd}T12:00`;
  })();

  // Display-format for the user-visible "Neuer Gültigkeit" preview.
  const newExpiresAtDisplay = (() => {
    if (!newExpiresAtIso) return '—';
    const [date] = newExpiresAtIso.split('T');
    const [yyyy, mm, dd] = date.split('-');
    return `${dd}.${mm}.${yyyy}`;
  })();

  function handleConfirm() {
    if (!checkDate) {
      setError('Check-datum ist erforderlich.');
      return;
    }
    setError(null);
    const trimmedExtra = extraNotes.trim();
    const notes = trimmedExtra
      ? `Recurrent-check passed on ${checkDate}: ${trimmedExtra}`
      : `Recurrent-check passed on ${checkDate}`;

    startTransition(async () => {
      try {
        await onConfirm(newExpiresAtIso, notes);
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <ModalShell title="Recurrent-Check Pass" onClose={onClose}>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
        Type-Rating wird um 12 Monate ab check-datum verlängert.
        Standardized notes werden im audit-trail gespeichert.
      </p>

      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
        Check-Datum
      </label>
      <input
        type="date"
        value={checkDate}
        onChange={(e) => setCheckDate(e.target.value)}
        max={todayLocal}
        autoFocus
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none mb-1"
      />
      <p className="text-xs text-gray-500 mb-3">
        Wann hat der recurrent-check stattgefunden? Default: heute. Backdating
        ist möglich (für nachträgliche dokumentation), zukunftsdaten nicht.
      </p>

      <div className="mb-3 px-3 py-2 rounded bg-green-500/10 border border-green-500/30 text-sm">
        <p className="text-xs uppercase tracking-wider text-green-700 dark:text-green-400 mb-0.5">
          Neue Gültigkeit
        </p>
        <p className="font-mono font-semibold text-green-800 dark:text-green-300">
          bis {newExpiresAtDisplay}
        </p>
      </div>

      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
        Zusätzliche Notizen (optional)
      </label>
      <textarea
        value={extraNotes}
        onChange={(e) => setExtraNotes(e.target.value)}
        placeholder="z.B. 'sim type: A320 LOFT', 'instructor: J. Smith'"
        rows={2}
        maxLength={400}
        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
      />
      <p className="text-xs text-gray-500 mt-1">
        Note wird gespeichert als:{' '}
        <code className="text-[10px]">
          Recurrent-check passed on {checkDate}
          {extraNotes.trim() ? `: ${extraNotes.trim()}` : ''}
        </code>
      </p>

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
          disabled={pending || !checkDate}
          className="px-3 py-1.5 text-sm font-semibold rounded text-white transition bg-green-600 hover:bg-green-500 disabled:opacity-50"
        >
          {pending ? '…' : 'Pass eintragen'}
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
