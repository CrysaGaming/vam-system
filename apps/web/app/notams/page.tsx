/**
 * Welle L / L5 — Public pilot-feed for active NOTAMs.
 *
 * Route: /notams
 *
 * Zeigt alle aktiven (publisht, validFrom ≤ now, validUntil > now,
 * nicht cancelled) NOTAMs der eigenen airline. Sortiert nach severity
 * (Critical → Warning → Info) und dann validFrom desc.
 *
 * Authentifizierte pilots der airline können das sehen. Wenn kein user
 * in airline, leere page (kein redirect, weil die page auch im AppShell
 * gerendert wird wenn der user noch keine airline hat).
 */

import { prisma } from '@vam/db';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<string, string> = {
  Closure: 'Closure',
  Restriction: 'Restriction',
  Procedure: 'Procedure',
  Info: 'Info',
};

const SEVERITY_CLASSES: Record<string, string> = {
  Info: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  Warning:
    'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  Critical: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

const SEVERITY_RANK: Record<string, number> = {
  Critical: 0,
  Warning: 1,
  Info: 2,
};

export default async function PublicNotamsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true, airline: { select: { name: true, icao: true } } },
  });

  if (!me?.airlineId) {
    return (
      <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
        <div className="mx-auto max-w-3xl">
          <header className="mb-6 border-b border-border pb-4">
            <h1 className="text-2xl font-bold sm:text-3xl">📢 NOTAMs</h1>
          </header>
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Du bist noch keiner airline zugeordnet. NOTAMs sind airline-
              spezifisch.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const now = new Date();

  // Active = published, not cancelled, validFrom ≤ now,
  //         (validUntil is null OR validUntil > now)
  const activeNotams = await prisma.notam.findMany({
    where: {
      airlineId: me.airlineId,
      publishedAt: { not: null },
      cancelledAt: null,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    select: {
      id: true,
      type: true,
      severity: true,
      title: true,
      body: true,
      affectedIcaos: true,
      validFrom: true,
      validUntil: true,
      publishedAt: true,
    },
    take: 200,
  });

  // Sort: severity rank ascending, then validFrom desc (newest first)
  const sorted = [...activeNotams].sort((a, b) => {
    const rankDiff =
      (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return b.validFrom.getTime() - a.validFrom.getTime();
  });

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {me.airline?.icao ?? 'Airline'} · NOTAMs
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            📢 Aktive NOTAMs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hinweise deiner airline: closures, restrictions, prozedur-änderungen.
          </p>
        </header>

        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">✅</div>
            <h2 className="text-lg font-semibold">Keine aktiven NOTAMs</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Deine airline hat aktuell keine offenen NOTAMs publisht.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {sorted.map((n) => (
              <li
                key={n.id}
                className={`rounded-lg border bg-card p-4 ${
                  n.severity === 'Critical'
                    ? 'border-red-500/30'
                    : n.severity === 'Warning'
                      ? 'border-yellow-500/30'
                      : 'border-border'
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[n.severity]}`}
                  >
                    {n.severity}
                  </span>
                  <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    {TYPE_LABELS[n.type] ?? n.type}
                  </span>
                  {n.affectedIcaos.length > 0 && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {n.affectedIcaos.join(', ')}
                    </span>
                  )}
                </div>
                <h2 className="text-base font-semibold leading-snug">
                  {n.title}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {n.body}
                </p>
                <div className="mt-3 text-xs text-muted-foreground">
                  Gültig ab{' '}
                  {n.validFrom.toLocaleString('de-DE', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {n.validUntil
                    ? ` bis ${n.validUntil.toLocaleString('de-DE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}`
                    : ' · open-ended'}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          {sorted.length} aktive NOTAM{sorted.length === 1 ? '' : 's'} ·
          generated {new Date().toLocaleTimeString('de-DE')}
        </div>
      </div>
    </main>
  );
}
