/**
 * Welle K / K2 — Single Pilot-Blog post view.
 *
 * Route: /blog/[slug]
 *
 * Public read-page. Lädt einen Published post by slug, increment view-
 * counter fire-and-forget, render body mit whitespace-pre-wrap damit
 * line-breaks aus dem plaintext-editor sichtbar bleiben.
 *
 * # 404 handling
 *
 * Draft- oder gar-nicht-existing slugs → notFound() (next.js 404 page).
 * Wir gaten auf status='Published' damit der slug eines drafts kein
 * preview-loophole ist.
 *
 * # Caching
 *
 * revalidate=60. View-counter wird trotzdem on-page-load incrementiert
 * (vor dem render); der ISR-cache reflekiert dann den letzten count beim
 * nächsten regeneration. Kleine race aber semantisch egal.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import { incrementBlogPostViews } from '@/app/me/blog/actions';

export const revalidate = 60;

type Params = Promise<{ slug: string }>;

export default async function BlogPostPage(props: { params: Params }) {
  const { slug } = await props.params;

  const post = await prisma.blogPost.findFirst({
    where: { slug, status: 'Published' },
    select: {
      id: true,
      title: true,
      body: true,
      publishedAt: true,
      viewCount: true,
      author: {
        select: {
          id: true,
          name: true,
          airline: { select: { icao: true, name: true } },
          rank: { select: { name: true } },
        },
      },
    },
  });

  if (!post) notFound();

  // Fire-and-forget view-counter. Cookies-basierte dedup wäre nice-to-have
  // (V2) damit reloads den counter nicht künstlich aufblasen — V1 ist
  // "view = page-load" ohne deduplication.
  void incrementBlogPostViews(slug);

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-6 text-xs">
          <Link
            href="/blog"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zum Blog
          </Link>
        </nav>

        <article>
          <header className="mb-6 border-b border-border pb-4">
            <h1 className="text-3xl font-bold leading-tight">{post.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link
                href={`/p/${post.author.id}`}
                className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {post.author.name ?? 'Pilot'}
              </Link>
              {post.author.airline?.icao && (
                <span className="font-mono text-xs">
                  · {post.author.airline.icao}
                  {post.author.airline.name ? ` · ${post.author.airline.name}` : ''}
                </span>
              )}
              {post.author.rank?.name && (
                <span className="text-xs">· {post.author.rank.name}</span>
              )}
              <span>·</span>
              <time dateTime={post.publishedAt?.toISOString()}>
                {post.publishedAt?.toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
              <span>·</span>
              <span className="text-xs">{post.viewCount} Aufrufe</span>
            </div>
          </header>

          {/*
            whitespace-pre-wrap preserves user-typed line-breaks + paragraphs
            ohne dass wir einen markdown-parser brauchen. React's automatic
            text-escaping schützt gegen XSS — body kommt aus der DB ist aber
            in der DB bereits als plaintext (kein HTML) gespeichert.
          */}
          <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
            {post.body}
          </div>
        </article>
      </div>
    </main>
  );
}
