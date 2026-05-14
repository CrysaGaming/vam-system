/**
 * Welle K / K3 — Photo-of-the-Week public page.
 *
 * Route: /photo-of-the-week
 *
 * Server-component. Zeigt das zuletzt featured-photo gross + grid der
 * vorherigen features als history. Public — kein auth-gate.
 */

import Link from 'next/link';
import { prisma } from '@vam/db';

export const revalidate = 300;

export default async function PhotoOfTheWeekPage() {
  const featured = await prisma.pirepPhoto.findMany({
    where: { featuredAt: { not: null } },
    orderBy: { featuredAt: 'desc' },
    take: 24, // current + 23 history items
    select: {
      id: true,
      url: true,
      caption: true,
      featuredAt: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          name: true,
          airline: { select: { icao: true } },
        },
      },
      pirep: {
        select: {
          id: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
        },
      },
    },
  });

  if (featured.length === 0) {
    return (
      <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
        <div className="mx-auto max-w-4xl">
          <PageHeader />
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">📸</div>
            <h2 className="text-lg font-semibold">Noch kein Photo ausgewählt</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sobald ein admin ein flight-photo featured, erscheint es hier.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const current = featured[0];
  const history = featured.slice(1);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl">
        <PageHeader />

        {/* Current featured — large display */}
        <section className="mb-10 rounded-lg border border-border bg-card overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <picture>
            <img
              src={current.url}
              alt={current.caption ?? 'Featured flight photo'}
              className="aspect-video w-full object-cover"
            />
          </picture>
          <div className="p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              ⭐ Aktuelles Photo of the Week
            </div>
            {current.caption && (
              <p className="mt-2 text-base leading-relaxed text-foreground">
                {current.caption}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Link
                href={`/p/${current.author.id}`}
                className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {current.author.name ?? 'Pilot'}
              </Link>
              {current.author.airline?.icao && (
                <span className="font-mono">· {current.author.airline.icao}</span>
              )}
              {current.pirep && (
                <>
                  <span>·</span>
                  <Link
                    href={`/pireps/${current.pirep.id}`}
                    className="font-mono hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {current.pirep.departure.icao} → {current.pirep.arrival.icao}
                  </Link>
                </>
              )}
              {current.featuredAt && (
                <>
                  <span>·</span>
                  <span>
                    Featured am{' '}
                    {current.featuredAt.toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </span>
                </>
              )}
            </div>
          </div>
        </section>

        {history.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Frühere Features
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {history.map((p) => (
                <div
                  key={p.id}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <picture>
                    <img
                      src={p.url}
                      alt={p.caption ?? 'Featured flight photo'}
                      className="aspect-square w-full object-cover"
                    />
                  </picture>
                  <div className="p-2 text-xs text-muted-foreground">
                    <Link
                      href={`/p/${p.author.id}`}
                      className="block truncate font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {p.author.name ?? 'Pilot'}
                    </Link>
                    {p.pirep && (
                      <p className="truncate font-mono">
                        {p.pirep.departure.icao} → {p.pirep.arrival.icao}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function PageHeader() {
  return (
    <header className="mb-8 border-b border-border pb-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Community
      </p>
      <h1 className="mt-1 text-3xl font-bold">📸 Photo of the Week</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ausgewählte flight-photos von pilots der platform — kuratiert vom
        admin-team.
      </p>
    </header>
  );
}
