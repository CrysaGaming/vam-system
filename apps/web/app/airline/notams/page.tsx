/**
 * Welle L / L5 — NOTAM admin overview.
 *
 * Route: /airline/notams
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { deriveNotamStatus, type NotamStatus } from '@/lib/notams/status';

export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<string, string> = {
  Closure: 'Closure',
  Restriction: 'Restriction',
  Procedure: 'Procedure',
  Info: 'Info',
};

const SEVERITY_CLASSES: Record<string, string> = {
  Info: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  Warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  Critical: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

const STATUS_CLASSES: Record<NotamStatus, string> = {
  Draft: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  Pending: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  Active: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
  Expired: 'border-gray-500/30 bg-gray-500/10 text-gray-700 dark:text-gray-300',
  Cancelled: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

export default async function AirlineNotamsPage() {
  const user = await requireAirlineManagerWithAirlinePage();

  const notams = await prisma.notam.findMany({
    where: { airlineId: user.airlineId },
    orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      type: true,
      severity: true,
      title: true,
      affectedIcaos: true,
      validFrom: true,
      validUntil: true,
      publishedAt: true,
      cancelledAt: true,
      createdAt: true,
    },
  });

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Airline · Operations
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              📢 NOTAMs
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Notice-to-Airmen für deine pilots: closures, restrictions,
              prozedur-änderungen.
            </p>
          </div>
          <Link
            href="/airline/notams/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + Neuer NOTAM
          </Link>
        </header>

        <div className="mb-4 text-sm">
          <Link
            href="/notams"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            → Pilot-Feed (was deine pilots sehen)
          </Link>
        </div>

        {notams.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">📭</div>
            <h2 className="text-lg font-semibold">Noch keine NOTAMs</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Informiere deine pilots über airport-closures, restrictions,
              neue procedures.
            </p>
            <Link
              href="/airline/notams/new"
              className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Ersten NOTAM erstellen
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {notams.map((n) => {
              const status = deriveNotamStatus(n);
              return (
                <li
                  key={n.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
                        >
                          {status}
                        </span>
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
                      <Link
                        href={`/airline/notams/${n.id}`}
                        className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {n.title}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">
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
                          : ' (open-ended)'}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
