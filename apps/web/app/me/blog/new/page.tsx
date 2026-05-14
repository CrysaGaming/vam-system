/**
 * Welle K / K2 — Create-new blog-post page.
 *
 * Route: /me/blog/new
 *
 * Wrappt den BlogPostEditor mit initialData=null (create-mode).
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import BlogPostEditor from '../_editor';

export const dynamic = 'force-dynamic';

export default async function NewBlogPostPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

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
          <h1 className="text-2xl font-bold">Neuer Blog-Post</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Wird als Draft erstellt. Du kannst publishen wenn du fertig bist.
          </p>
        </header>
        <BlogPostEditor initialData={null} />
      </div>
    </main>
  );
}
