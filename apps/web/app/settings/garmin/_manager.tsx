'use client';

/**
 * Welle N / N4 — Garmin token management UI (client).
 *
 * Two responsibilities:
 *   1. Create form (label input → generate token → reveal once)
 *   2. Existing-token list with revoke buttons + suffix-display
 *
 * The "reveal once" pattern: after create returns, we stash plainToken
 * in component state and show it in a copy-able box. Page refresh /
 * navigate-away → gone forever. Same UX as GitHub PAT or Stripe
 * restricted keys.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createGarminTokenAction,
  revokeGarminTokenAction,
} from './actions';

type TokenRow = {
  id: string;
  label: string;
  tokenSuffix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function GarminTokenManager({ tokens }: { tokens: TokenRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function create() {
    if (!label.trim()) {
      setMsg('Label fehlt.');
      return;
    }
    setMsg(null);
    setRevealedToken(null);
    startTransition(async () => {
      const res = await createGarminTokenAction({ label: label.trim() });
      if (res.ok && res.plainToken) {
        setRevealedToken(res.plainToken);
        setLabel('');
        setMsg(res.message ?? 'OK');
        router.refresh();
      } else if (!res.ok) {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  function revoke(tokenId: string, displayLabel: string) {
    if (
      !confirm(
        `Token "${displayLabel}" revoken? Watches mit diesem token verlieren sofort den zugriff.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await revokeGarminTokenAction({ tokenId });
      if (res.ok) {
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => setMsg('In zwischenablage kopiert.'))
      .catch(() => setMsg('Copy fehlgeschlagen — manuell markieren.'));
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Neuen Token erstellen
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Label (z.B. fenix 7, Edge 1040)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={isPending}
          />
          <button
            type="button"
            onClick={create}
            disabled={isPending || !label.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? '…' : 'Token erstellen'}
          </button>
        </div>
        {msg && (
          <p className="mt-2 text-xs text-muted-foreground">{msg}</p>
        )}
      </section>

      {/* Reveal-once block */}
      {revealedToken && (
        <section className="rounded-lg border-2 border-amber-500/50 bg-amber-500/10 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            ⚠️ Token einmalig sichtbar — jetzt kopieren!
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-background/50 px-3 py-2 font-mono text-sm">
              {revealedToken}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(revealedToken)}
              className="rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Kopieren
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Füge den Token in der Connect-IQ phone-app als Setting{' '}
            <code className="rounded bg-muted/40 px-1">apiToken</code> ein.
            Nach navigation siehst du ihn nie wieder — nur den 4-char
            suffix.
          </p>
        </section>
      )}

      {/* Existing tokens */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Aktive Tokens ({tokens.length})
        </h2>
        {tokens.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Noch keine tokens. Lege einen oben an.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Label</th>
                  <th className="px-4 py-2 text-left">Token</th>
                  <th className="px-4 py-2 text-left">Erstellt</th>
                  <th className="px-4 py-2 text-left">Zuletzt benutzt</th>
                  <th className="px-4 py-2 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tokens.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{t.label}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      vamg_••••{t.tokenSuffix}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString('de-DE')}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {t.lastUsedAt
                        ? new Date(t.lastUsedAt).toLocaleString('de-DE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => revoke(t.id, t.label)}
                        disabled={isPending}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                      >
                        Revoken
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
