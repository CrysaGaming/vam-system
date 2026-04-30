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

  return (
    <section
      style={{
        border: '1px solid var(--border, #ddd)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Einladungen</h2>
      <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginBottom: 16 }}>
        Generiere einen Link und schicke ihn manuell an den Piloten
        (z.B. Discord-DM). Der Link ist nur einmal nutzbar und läuft
        automatisch ab.
      </p>

      <form
        action={handleSubmit}
        style={{
          display: 'grid',
          gap: 8,
          marginBottom: 16,
          gridTemplateColumns: '1fr 1fr auto auto',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12, marginBottom: 2 }}>Email (optional, nur Notiz)</div>
          <input
            type="email"
            name="email"
            placeholder="pilot@example.com"
            disabled={pending}
            style={{ width: '100%', padding: 6, boxSizing: 'border-box' }}
          />
        </label>

        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12, marginBottom: 2 }}>Rolle (optional)</div>
          <select
            name="roleId"
            defaultValue=""
            disabled={pending}
            style={{ width: '100%', padding: 6, boxSizing: 'border-box' }}
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

        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12, marginBottom: 2 }}>Gültig (Tage)</div>
          <input
            type="number"
            name="expiryDays"
            defaultValue={7}
            min={1}
            max={30}
            disabled={pending}
            style={{ width: 80, padding: 6 }}
          />
        </label>

        <button type="submit" disabled={pending} style={{ padding: '6px 12px' }}>
          {pending ? '…' : 'Einladung erstellen'}
        </button>
      </form>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            background: '#fee',
            color: '#900',
            border: '1px solid #f99',
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      {justCreated && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: '#efe',
            border: '1px solid #9c9',
            borderRadius: 4,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            ✅ Einladung erstellt — gültig bis{' '}
            {justCreated.expiresAt.toLocaleString('de-DE')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code
              style={{
                flex: 1,
                padding: 8,
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 13,
                wordBreak: 'break-all',
              }}
            >
              {buildInviteLink(justCreated.token)}
            </code>
            <button
              type="button"
              onClick={() => copyLink(justCreated.token, 'Neuer Link')}
              style={{ padding: '6px 12px' }}
            >
              📋 Kopieren
            </button>
          </div>
        </div>
      )}

      {copyFeedback && (
        <div
          style={{
            marginBottom: 12,
            padding: 6,
            background: '#eef',
            color: '#003',
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {copyFeedback}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>
            Offene Einladungen ({pendingInvites.length})
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr style={{ background: 'var(--muted-bg, #f5f5f5)' }}>
                <th style={th}>Email</th>
                <th style={th}>Rolle</th>
                <th style={th}>Erstellt</th>
                <th style={th}>Läuft ab</th>
                <th style={th}>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                  <td style={td}>{inv.email ?? <em style={{ color: '#999' }}>—</em>}</td>
                  <td style={td}>{inv.roleName ?? <em style={{ color: '#999' }}>—</em>}</td>
                  <td style={td}>{inv.createdAt.toLocaleDateString('de-DE')}</td>
                  <td style={td}>{inv.expiresAt.toLocaleDateString('de-DE')}</td>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => copyLink(inv.token)}
                      disabled={pending}
                      style={{ marginRight: 6 }}
                    >
                      📋 Link
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(inv.id)}
                      disabled={pending}
                      style={{ color: '#900' }}
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
          <summary style={{ cursor: 'pointer', fontSize: 14, color: 'var(--muted, #666)' }}>
            Eingelöst / abgelaufen ({otherInvites.length})
          </summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead>
              <tr style={{ background: 'var(--muted-bg, #f5f5f5)' }}>
                <th style={th}>Status</th>
                <th style={th}>Email</th>
                <th style={th}>Eingelöst von</th>
                <th style={th}>Datum</th>
              </tr>
            </thead>
            <tbody>
              {otherInvites.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                  <td style={td}>
                    <span style={badgeStyle(inv.status)}>{statusLabel(inv.status)}</span>
                  </td>
                  <td style={td}>{inv.email ?? <em style={{ color: '#999' }}>—</em>}</td>
                  <td style={td}>{inv.usedByName ?? <em style={{ color: '#999' }}>—</em>}</td>
                  <td style={td}>
                    {(inv.usedAt ?? inv.expiresAt).toLocaleDateString('de-DE')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {invites.length === 0 && (
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, fontStyle: 'italic' }}>
          Noch keine Einladungen erstellt.
        </p>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  padding: 8,
  textAlign: 'left',
  fontSize: 13,
  fontWeight: 600,
};

const td: React.CSSProperties = {
  padding: 8,
  fontSize: 14,
};

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

function badgeStyle(status: InviteRow['status']): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
  };
  switch (status) {
    case 'used':
      return { ...base, background: '#cfc', color: '#060' };
    case 'expired':
      return { ...base, background: '#eee', color: '#666' };
    case 'revoked':
      return { ...base, background: '#fcc', color: '#900' };
    case 'pending':
      return { ...base, background: '#cce', color: '#003' };
  }
}
