/**
 * Welle K / K3 — Admin photo curation.
 *
 * Route: /admin/photo-of-the-week
 *
 * Approver-only. Listet alle PirepPhotos (neueste-zuerst) mit
 * feature/unfeature toggle. Featured-photos sind hervorgehoben.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import { isApproverRole } from '@/lib/roles';
import PhotoCurationRow from './_curation-row';

export const dynamic = 'force-dynamic';

const PHOTOS_PER_PAGE = 40;

type SearchParams = Promise<{ page?: string; filter?: string }>;

export default async function AdminPhotoOfTheWeekPage(props: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!user || !isApproverRole(user.role?.name)) redirect('/');

  const sp = await props.searchParams;
  const filter = sp.filter === 'featured' ? 'featured' : 'all';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const skip = (page - 1) * PHOTOS_PER_PAGE;

  const where =
    filter === 'featured' ? { featuredAt: { not: null } } : {};

  const [photos, totalCount, featuredCount] = await Promise.all([
    prisma.pirepPhoto.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PHOTOS_PER_PAGE,
      select: {
        id: true,
        url: true,
        caption: true,
        createdAt: true,
        featuredAt: true,
        featuredById: true,
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
        featuredBy: { select: { name: true } },
      },
    }),
    prisma.pirepPhoto.count({ where }),
    prisma.pirepPhoto.count({ where: { featuredAt: { not: null } } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PHOTOS_PER_PAGE));

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Admin · Curation
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            Photo-of-the-Week
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Featured photos erscheinen public auf{' '}
            <Link
              href="/photo-of-the-week"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              /photo-of-the-week
            </Link>
            . Aktuell {featuredCount} photos featured.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link
            href="/admin/photo-of-the-week"
            className={`rounded-md border px-3 py-1.5 ${
              filter === 'all'
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Alle photos
          </Link>
          <Link
            href="/admin/photo-of-the-week?filter=featured"
            className={`rounded-md border px-3 py-1.5 ${
              filter === 'featured'
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Nur featured ({featuredCount})
          </Link>
        </div>

        {photos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">
              {filter === 'featured'
                ? 'Keine featured photos. Pick eines aus "Alle photos".'
                : 'Noch keine photos im system.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((p) => (
                <PhotoCurationRow
                  key={p.id}
                  photo={{
                    id: p.id,
                    url: p.url,
                    caption: p.caption,
                    createdAt: p.createdAt,
                    featuredAt: p.featuredAt,
                    featuredByName: p.featuredBy?.name ?? null,
                    authorName: p.author.name ?? 'Pilot',
                    authorId: p.author.id,
                    airlineIcao: p.author.airline?.icao ?? null,
                    pirepId: p.pirep?.id ?? null,
                    departureIcao: p.pirep?.departure.icao ?? null,
                    arrivalIcao: p.pirep?.arrival.icao ?? null,
                  }}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <nav className="mt-6 flex items-center justify-between text-sm">
                {page > 1 ? (
                  <Link
                    href={`/admin/photo-of-the-week?filter=${filter}&page=${page - 1}`}
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    ← Neuere
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-xs text-muted-foreground">
                  Seite {page} / {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={`/admin/photo-of-the-week?filter=${filter}&page=${page + 1}`}
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Ältere →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  );
}
