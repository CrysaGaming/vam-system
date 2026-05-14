/**
 * Welle K / K2 — Pilot's own blog-posts list.
 *
 * Route: /me/blog
 *
 * Server-component, session-required. Listet die eigenen posts des
 * eingeloggten pilots inkl. drafts. Drafts sind hier sichtbar (im
 * unterschied zum public /blog), damit der pilot weiter-edit'n kann.
 *
 * Sortierung: Draft zuerst (zum weiter-editieren), dann Published
 * neueste-zuerst. Per-status badges.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';

export const dynamic = 'force-dynamic';

export default async function MyBlogPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const posts = await prisma.blogPost.findMany({
    where: { authorId: userId },
    orderBy: [
      // Draft zuerst (alpha order: Draft < Published)
      { status: 'asc' },
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      viewCount: true,
    },
  });

  const drafts = posts.filter((p) => p.status === 'Draft');
  const published = posts.filter((p) => p.status === 'Published');

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between border-b border-border pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Meine Inhalte
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Mein Blog</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Deine eigenen blog-posts — drafts + published.
            </p>
          </div>
          <Link
            href="/me/blog/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + Neuer Post
          </Link>
        </header>

        {posts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">✍️</div>
            <h2 className="text-lg font-semibold">Noch keine Posts</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Schreib deinen ersten blog-post über eine flugerfahrung, eine
              route, oder einen tipp.
            </p>
            <Link
              href="/me/blog/new"
              className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Ersten post schreiben
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {drafts.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Drafts ({drafts.length})
                </h2>
                <ul className="space-y-2">
                  {drafts.map((p) => (
                    <PostRow key={p.id} post={p} />
                  ))}
                </ul>
              </section>
            )}

            {published.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Published ({published.length})
                </h2>
                <ul className="space-y-2">
                  {published.map((p) => (
                    <PostRow key={p.id} post={p} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function PostRow({
  post,
}: {
  post: {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    status: 'Draft' | 'Published';
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
    viewCount: number;
  };
}) {
  const isDraft = post.status === 'Draft';
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${
                isDraft
                  ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                  : 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
              }`}
            >
              {isDraft ? 'Draft' : 'Public'}
            </span>
            <Link
              href={`/me/blog/${post.id}/edit`}
              className="truncate font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {post.title}
            </Link>
          </div>
          {post.excerpt && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {post.excerpt}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>
              Erstellt:{' '}
              {post.createdAt.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </span>
            {!isDraft && post.publishedAt && (
              <>
                <span>·</span>
                <span>
                  Published:{' '}
                  {post.publishedAt.toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </span>
                <span>·</span>
                <span>{post.viewCount} Aufrufe</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1 text-xs">
          <Link
            href={`/me/blog/${post.id}/edit`}
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Editieren
          </Link>
          {!isDraft && (
            <Link
              href={`/blog/${post.slug}`}
              className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              Ansehen
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
