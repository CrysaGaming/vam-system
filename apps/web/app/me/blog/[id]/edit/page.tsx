/**
 * Welle K / K2 — Edit existing blog-post page.
 *
 * Route: /me/blog/[id]/edit
 *
 * Lädt den post via id, gated auf authorId === session.user.id, wrappt
 * den BlogPostEditor mit initialData. Wenn der user nicht der author ist
 * → notFound (statt 403 damit wir nicht leak'n dass die id existiert).
 */

import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import BlogPostEditor from '../../_editor';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default async function EditBlogPostPage(props: { params: Params }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const { id } = await props.params;

  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
      title: true,
      body: true,
      excerpt: true,
      status: true,
      slug: true,
      publishedAt: true,
      viewCount: true,
    },
  });

  if (!post || post.authorId !== userId) notFound();

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/me/blog"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zu Mein Blog
          </Link>
        </nav>
        <header className="mb-6 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${
                post.status === 'Draft'
                  ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                  : 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
              }`}
            >
              {post.status}
            </span>
            <h1 className="text-2xl font-bold">Post editieren</h1>
          </div>
          {post.status === 'Published' && (
            <p className="mt-2 text-xs text-muted-foreground">
              Public auf{' '}
              <Link
                href={`/blog/${post.slug}`}
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                /blog/{post.slug}
              </Link>{' '}
              · {post.viewCount} Aufrufe
            </p>
          )}
        </header>
        <BlogPostEditor
          initialData={{
            id: post.id,
            title: post.title,
            body: post.body,
            excerpt: post.excerpt,
            status: post.status,
            slug: post.slug,
          }}
        />
      </div>
    </main>
  );
}
