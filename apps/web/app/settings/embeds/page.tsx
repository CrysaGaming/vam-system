/**
 * Welle N / N5 — Embed token settings page.
 *
 * Route: /settings/embeds
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { EmbedTokenManager } from './_manager';

export const dynamic = 'force-dynamic';

/**
 * Resolve the public origin so the manager can build copy-able URLs.
 * Prefer the request's own forwarded host (works behind the cloudflared
 * tunnel + any future reverse proxy); fall back to the NEXT_PUBLIC_
 * SITE_URL env, then a localhost default.
 */
async function resolvePublicBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

export default async function EmbedsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const [rows, publicBaseUrl] = await Promise.all([
    prisma.embedToken.findMany({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        tokenString: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }),
    resolvePublicBaseUrl(),
  ]);

  const tokens = rows.map((r) => ({
    id: r.id,
    label: r.label,
    tokenString: r.tokenString,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Settings · Integrations
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            🔗 Live-Status Embeds
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Teil-bare URLs für deinen aktuellen flight-status. Funktioniert
            in Discord, OBS, Twitch panels, Streamlabs, oder jedem iframe-
            fähigen system. Token-im-URL pattern — wer den link hat, sieht
            deine live-daten (read-only).
          </p>
        </header>

        <EmbedTokenManager
          tokens={tokens}
          publicBaseUrl={publicBaseUrl}
        />

        <section className="mt-8 space-y-3 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="text-sm font-semibold uppercase tracking-wider">
            Verwendung
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>OBS:</strong> Quelle &quot;Browser&quot; hinzufügen,
              URL einfügen, 400×120 px (oder eigene größe), CSS{' '}
              <code className="rounded bg-muted/40 px-1">
                body {`{ background: transparent; }`}
              </code>
              .
            </li>
            <li>
              <strong>Discord:</strong> URL in voice-channel-description
              kleben oder im chat posten — Discord rendert ein OG-card-
              preview. Für vollwertigen embed siehe{' '}
              <code className="rounded bg-muted/40 px-1">
                discord-activity/
              </code>{' '}
              im repo.
            </li>
            <li>
              <strong>Twitch Panel:</strong> Channel-page → Edit Panels →
              Image-link → URL als &quot;Link zur seite&quot; einfügen.
            </li>
            <li>
              <strong>Privacy:</strong> Anyone-with-the-URL sieht deine
              live-route (callsign/ALT/GS/DEP→ARR). Bei leak sofort
              revoken — alte URL gibt 404 zurück.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
