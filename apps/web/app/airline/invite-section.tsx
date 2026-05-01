'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createInvite,
  revokeInvite,
  type InviteRow,
  type CreateInviteResult,
} from './invites-actions';

interface Props {
  invites: InviteRow[];
  roles: Array<{ id: string; name: string; description: string | null }>;
  appUrl: string; // base URL für invite-link-construction
}

/**
 * Invite-Management — Form to generate, list of issued invites with
 * copy-link + revoke actions. Admin scope; access-control on the
 * server actions.
 *
 * UX-Pattern: Nach Submit zeigt VAM den Link inline mit copy-button.
 * Admin kopiert ihn dann manuell + sendet via Discord/Email. Wir
 * automatisieren delivery NICHT in v1 — admin kontrolliert den channel.
 */
export function InviteSection({ invites, roles, appUrl }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{
    token: string;
    expiresAt: Date;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  function buildInviteLink(token: string): string {
    return `${appUrl}/invite/${token}`;
  }

  async function copyLink(token: string, label?: string) {
    try {
      await navigator.clipboard.writeText(buildInviteLink(token));
      setCopyFeedback(label ? `${label} kopiert` : 'Link kopiert');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback('Kopieren fehlgeschlagen — manuell kopieren');
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: CreateInviteResult = await createInvite(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setJustCreated({
        token: result.invite.token,
        expiresAt: result.invite.expiresAt,
      });
      router.refresh();
    });
  }

  function handleRevoke(inviteId: string) {
    if (!confirm('Invite wirklich widerrufen? Der Link wird sofort ungültig.')) return;
    setError(null);
    startTransition(async () => {
      const result = await revokeInvite(inviteId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const pendingInvites = invites.filter((i) => i.status === 'pending');
  const otherInvites = invites.filter((i) => i.status !== 'pending');

  // Reusable Tailwind class strings for inputs and select to keep
  // the form markup readable.
  const inputCls =
    'w-full px-2 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-50';
  const labelCls = 'block';
  const labelTextCls = 'text-xs text-gray-500 dark:text-gray-400 mb-0.5';

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <h2 className="mt-0 text-lg font-semibold mb-2">Einladungen</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Generiere einen Link und schicke ihn manuell an den Piloten
        (z.B. Discord-DM). Der Link ist nur einmal nutzbar und läuft
        automatisch ab.
      </p>

      <form
        action={handleSubmit}
        className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 mb-4 items-end"
      >
        <label className={labelCls}>
          <div className={labelTextCls}>Email (optional, nur Notiz)</div>
          <input
            type="email"
            name="email"
            placeholder="pilot@example.com"
            disabled={pending}
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          <div className={labelTextCls}>Rolle (optional)</div>
          <select
            name="roleId"
            defaultValue=""
            disabled={pending}
            className={inputCls}
          >
            <option value="">— ohne Rolle (plain pilot) —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.description ? ` — ${r.description}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className={labelCls}>
          <div className={labelTextCls}>Gültig (Tage)</div>
          <input
            type="number"
            name="expiryDays"
            defaultValue={7}
            min={1}
            max={30}
            disabled={pending}
            className="w-20 px-2 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-50"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded text-sm font-medium transition"
        >
          {pending ? '…' : 'Einladung erstellen'}
        </button>
      </form>

      {error && (
        <div className="mb-3 px-3 py-2 bg-red-100 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 text-red-800 dark:text-red-300 rounded text-sm">
          {error}
        </div>
      )}

      {justCreated && (
        <div className="mb-4 px-3 py-3 bg-green-100 dark:bg-green-500/10 border border-green-400 dark:border-green-500/30 rounded">
          <div className="font-semibold mb-1.5 text-green-900 dark:text-green-300">
            ✅ Einladung erstellt — gültig bis{' '}
            {justCreated.expiresAt.toLocaleString('de-DE')}
          </div>
          <div className="flex gap-2 items-center">
            <code className="flex-1 px-2 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-[13px] break-all">
              {buildInviteLink(justCreated.token)}
            </code>
            <button
              type="button"
              onClick={() => copyLink(justCreated.token, 'Neuer Link')}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
            >
              📋 Kopieren
            </button>
          </div>
        </div>
      )}

      {copyFeedback && (
        <div className="mb-3 px-2 py-1.5 bg-indigo-100 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-300 rounded text-[13px]">
          {copyFeedback}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <>
          <h3 className="text-base font-semibold mb-2">
            Offene Einladungen ({pendingInvites.length})
          </h3>
          <table className="w-full border-collapse mb-4">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800/50">
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Email</th>
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Rolle</th>
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Erstellt</th>
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Läuft ab</th>
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-200 dark:border-gray-800">
                  <td className="px-2 py-2 text-sm">
                    {inv.email ?? <em className="text-gray-400 dark:text-gray-600">—</em>}
                  </td>
                  <td className="px-2 py-2 text-sm">
                    {inv.roleName ?? <em className="text-gray-400 dark:text-gray-600">—</em>}
                  </td>
                  <td className="px-2 py-2 text-sm">{inv.createdAt.toLocaleDateString('de-DE')}</td>
                  <td className="px-2 py-2 text-sm">{inv.expiresAt.toLocaleDateString('de-DE')}</td>
                  <td className="px-2 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() => copyLink(inv.token)}
                      disabled={pending}
                      className="mr-1.5 px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-xs disabled:opacity-50"
                    >
                      📋 Link
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(inv.id)}
                      disabled={pending}
                      className="px-2 py-1 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/10 rounded text-xs disabled:opacity-50"
                    >
                      Widerrufen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {otherInvites.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400">
            Eingelöst / abgelaufen ({otherInvites.length})
          </summary>
          <table className="w-full border-collapse mt-2">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800/50">
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Status</th>
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Email</th>
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Eingelöst von</th>
                <th className="px-2 py-2 text-left text-[13px] font-semibold">Datum</th>
              </tr>
            </thead>
            <tbody>
              {otherInvites.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-200 dark:border-gray-800">
                  <td className="px-2 py-2 text-sm">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-2 py-2 text-sm">
                    {inv.email ?? <em className="text-gray-400 dark:text-gray-600">—</em>}
                  </td>
                  <td className="px-2 py-2 text-sm">
                    {inv.usedByName ?? <em className="text-gray-400 dark:text-gray-600">—</em>}
                  </td>
                  <td className="px-2 py-2 text-sm">
                    {(inv.usedAt ?? inv.expiresAt).toLocaleDateString('de-DE')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {invites.length === 0 && (
        <p className="text-sm italic text-gray-500 dark:text-gray-400">
          Noch keine Einladungen erstellt.
        </p>
      )}
    </section>
  );
}

function statusLabel(status: InviteRow['status']): string {
  switch (status) {
    case 'used':
      return '✅ Eingelöst';
    case 'expired':
      return '⏰ Abgelaufen';
    case 'revoked':
      return '🚫 Widerrufen';
    case 'pending':
      return '⏳ Offen';
  }
}

function StatusBadge({ status }: { status: InviteRow['status'] }) {
  const base = 'px-2 py-0.5 rounded text-xs font-medium';
  const variant = {
    used: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400',
    expired: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    revoked: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400',
    pending: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-400',
  }[status];
  return <span className={`${base} ${variant}`}>{statusLabel(status)}</span>;
}
