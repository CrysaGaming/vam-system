/**
 * Welle L / L5 — NOTAM detail page (admin view).
 *
 * Route: /airline/notams/[id]
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { deriveNotamStatus, type NotamStatus } from '@/lib/notams/status';
import NotamActions from './_actions';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

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

export default async function NotamDetailPage(props: { params: Params }) {
  const user = await requireAirlineManagerWithAirlinePage();
  const { id } = await props.params;

  const notam = await prisma.notam.findUnique({
    where: { id },
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
      cancelledAt: true,
      createdAt: true,
      airlineId: true,
      createdBy: { select: { name: true } },
    },
  });

  if (!notam || notam.airlineId !== user.airlineId) notFound();

  const status = deriveNotamStatus(notam);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/airline/notams"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur NOTAM-Liste
          </Link>
        </nav>

        <header className="mb-6 rounded-lg border border-border bg-card p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
            >
              {status}
            </span>
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[notam.severity]}`}
            >
              {notam.severity}
            </span>
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              {notam.type}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{notam.title}</h1>

          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {notam.affectedIcaos.length > 0 && (
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Affected Airports
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {notam.affectedIcaos.map((icao) => (
                    <span
                      key={icao}
                      className="rounded border border-border bg-background px-2 py-0.5 font-mono text-sm"
                    >
                      {icao}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Gültig ab
              </p>
              <p className="mt-1 text-sm">
                {notam.validFrom.toLocaleString('de-DE', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Gültig bis
              </p>
              <p className="mt-1 text-sm">
                {notam.validUntil
                  ? notam.validUntil.toLocaleString('de-DE', {
                      dateStyle: 'full',
                      timeStyle: 'short',
                    })
                  : 'Open-ended'}
              </p>
            </div>
            {notam.publishedAt && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Publisht
                </p>
                <p className="mt-1 text-xs">
                  {notam.publishedAt.toLocaleString('de-DE')}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Erstellt von
              </p>
              <p className="mt-1 text-xs">
                {notam.createdBy.name ?? 'Admin'} ·{' '}
                {notam.createdAt.toLocaleDateString('de-DE')}
              </p>
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Body
            </p>
            <p className="whitespace-pre-wrap text-base leading-relaxed">
              {notam.body}
            </p>
          </div>
        </header>

        <section>
          <NotamActions notamId={notam.id} status={status} />
        </section>
      </div>
    </main>
  );
}
