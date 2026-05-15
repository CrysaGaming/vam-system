'use client';

/**
 * Welle N / N5 — Embed token management UI (client).
 *
 * Unlike Garmin (reveal-once), embed tokens stay visible because
 * they live in URLs that the user shares persistently. Each row
 * has a "Copy URL" button that copies the ready-to-paste public
 * embed URL — that's the actual UX target, not the token-string
 * itself.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createEmbedTokenAction,
  revokeEmbedTokenAction,
} from './actions';

type TokenRow = {
  id: string;
  label: string;
  tokenString: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export function EmbedTokenManager({
  tokens,
  publicBaseUrl,
}: {
  tokens: TokenRow[];
  publicBaseUrl: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function create() {
    if (!label.trim()) {
      setMsg('Label fehlt.');
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await createEmbedTokenAction({ label: label.trim() });
      if (res.ok) {
        setLabel('');
        setMsg(res.message ?? 'OK');
        router.refresh();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  function revoke(tokenId: string, displayLabel: string) {
    if (
      !confirm(
        `Token "${displayLabel}" revoken? Alle URLs mit diesem token ` +
          `geben sofort 404 zurück (Discord-embeds, OBS-overlays etc).`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await revokeEmbedTokenAction({ tokenId });
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  function buildEmbedUrl(tokenString: string): string {
    return `${publicBaseUrl}/embed/live/${tokenString}`;
  }

  function copyToClipboard(text: string, what: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => setMsg(`${what} kopiert.`))
      .catch(() => setMsg('Copy fehlgeschlagen.'));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Neuen embed erstellen
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Label (z.B. Twitch Panel, Discord, OBS overlay)"
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
            {isPending ? '…' : 'Erstellen'}
          </button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Aktive Tokens ({tokens.length})
        </h2>
        {tokens.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Noch keine embed tokens. Lege einen oben an.
          </div>
        ) : (
          <div className="space-y-3">
            {tokens.map((t) => {
              const url = buildEmbedUrl(t.tokenString);
              return (
                <div
                  key={t.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="font-medium">{t.label}</p>
                    <button
                      type="button"
                      onClick={() => revoke(t.id, t.label)}
                      disabled={isPending}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                    >
                      Revoken
                    </button>
                  </div>
                  <div className="mb-2 flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-muted/30 px-2 py-1.5 font-mono text-xs">
                      {url}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(url, 'URL')}
                      className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      URL kopieren
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Erstellt{' '}
                    {new Date(t.createdAt).toLocaleDateString('de-DE')} ·
                    Zuletzt benutzt{' '}
                    {t.lastUsedAt
                      ? new Date(t.lastUsedAt).toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
