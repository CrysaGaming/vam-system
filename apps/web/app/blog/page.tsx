/**
 * Welle K / K2 — Public Pilot-Blog feed.
 *
 * Route: /blog
 *
 * Listet alle Published posts neueste-zuerst. Pagination via search-param
 * `?page=N` (1-indexed, 20 per page). Server-component, revalidate=60.
 *
 * # Why nicht infinite-scroll
 *
 * Pagination ist server-friendlier (klare cache-keys, kein client-state-
 * management), simpler zu bookmark, und für eine blog-feed-page mit
 * niedriger frequency (selten >50 posts) völlig ausreichend.
 */

import Link from 'next/link';
import { prisma } from '@vam/db';

export const revalidate = 60;

const POSTS_PER_PAGE = 20;

type SearchParams = Promise<{ page?: string }>;

export default async function BlogFeedPage(props: { searchParams: SearchParams }) {
  const sp = await props.searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const skip = (page - 1) * POSTS_PER_PAGE;

  const [posts, totalCount] = await Promise.all([
    prisma.blogPost.findMany({
      where: { status: 'Published' },
      orderBy: { publishedAt: 'desc' },
      skip,
      take: POSTS_PER_PAGE,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        publishedAt: true,
        viewCount: true,
        author: {
          select: {
            id: true,
            name: true,
            airline: { select: { icao: true } },
          },
        },
      },
    }),
    prisma.blogPost.count({ where: { status: 'Published' } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / POSTS_PER_PAGE));

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Community
          </p>
          <h1 className="mt-1 text-3xl font-bold">Pilot-Blog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Flight stories, route reviews und tips von pilots der platform.
          </p>
        </header>

        {posts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">📝</div>
            <h2 className="text-lg font-semibold">Noch keine Posts</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Schreib den ersten post auf{' '}
              <Link
                href="/me/blog"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                /me/blog
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-4">
              {posts.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-indigo-300 dark:hover:border-indigo-700"
                >
                  <Link href={`/blog/${p.slug}`} className="block">
                    <h2 className="text-lg font-semibold text-foreground hover:text-indigo-600 dark:hover:text-indigo-400">
                      {p.title}
                    </h2>
                  </Link>
                  {p.excerpt && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {p.excerpt}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Link
                      href={`/p/${p.author.id}`}
                      className="hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {p.author.name ?? 'Pilot'}
                    </Link>
                    {p.author.airline?.icao && (
                      <span className="font-mono">· {p.author.airline.icao}</span>
                    )}
                    <span>·</span>
                    <time dateTime={p.publishedAt?.toISOString()}>
                      {p.publishedAt?.toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </time>
                    <span>·</span>
                    <span>{p.viewCount} Aufrufe</span>
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav className="mt-6 flex items-center justify-between text-sm">
                {page > 1 ? (
                  <Link
                    href={`/blog?page=${page - 1}`}
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
                    href={`/blog?page=${page + 1}`}
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
