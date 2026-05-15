/**
 * Welle N / N4 — Garmin settings page.
 *
 * Route: /settings/garmin
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { GarminTokenManager } from './_manager';

export const dynamic = 'force-dynamic';

export default async function GarminSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const rows = await prisma.garminApiToken.findMany({
    where: { userId: session.user.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      label: true,
      tokenSuffix: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  // ISO-serialize for client-component prop boundary.
  const tokens = rows.map((r) => ({
    id: r.id,
    label: r.label,
    tokenSuffix: r.tokenSuffix,
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
            ⌚ Garmin Connect IQ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            API-tokens für die Connect-IQ data-field auf deiner Garmin-
            watch oder Edge-cyclo. Pro gerät ein token; revoke ist sofort
            wirksam.
          </p>
        </header>

        <GarminTokenManager tokens={tokens} />

        <section className="mt-8 space-y-3 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="text-sm font-semibold uppercase tracking-wider">
            Setup
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Token oben erstellen, kopieren (du siehst ihn nie wieder).
            </li>
            <li>
              In Garmin Connect-IQ Store{' '}
              <em>&quot;VAM Flight HUD&quot;</em> installieren
              (Quellcode + manifest unter{' '}
              <code className="rounded bg-muted/40 px-1">garmin-iq/</code>{' '}
              im repo).
            </li>
            <li>
              In Connect-IQ phone-app: VAM Flight HUD → Settings →{' '}
              <strong>apiToken</strong> einkleben.
            </li>
            <li>
              Watch face wählen, VAM-data-field auf einen slot legen.
              Während aktiver MSFS-session zeigt sie ALT/GS/HDG live.
            </li>
          </ol>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="text-sm font-semibold uppercase tracking-wider">
            Endpoint
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-muted/30 p-3 font-mono">
            GET /api/garmin/state{'\n'}
            Authorization: Bearer vamg_••••{'\n'}
            ↓{'\n'}
            {`{ t, callsign, alt, gs, hdg, dep, arr, onGnd, hbAge }`}
          </pre>
        </section>
      </div>
    </main>
  );
}
