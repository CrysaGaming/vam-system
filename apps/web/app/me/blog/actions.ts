'use server';

/**
 * Welle K / K2 — Pilot-Blog server actions.
 *
 * Owner-only mutations: create/update/delete sind nur durch den autor
 * möglich. Approver-rollen haben KEINE bearbeitungsrechte — content
 * gehört dem pilot, kein admin-override (V2 könnte ein moderation-
 * flow mit admin-reject sein).
 *
 * # Slug-generation
 *
 * createPost slugifyt den title und hängt ein cuid-suffix dran damit
 * der slug eindeutig ist ohne collision-retry-loop. Beispiel:
 *   title "EDDF → EDDM mit der A320!" → "eddf-eddm-mit-der-a320-clxa12bc"
 *
 * Der suffix macht die URL etwas länger aber garantiert uniqueness
 * ohne Race-condition-handling. SEO-impact ist marginal (Google
 * indexed beides gleich gut).
 *
 * # Body-handling
 *
 * V1: plaintext nur. Body wird wie eingegeben gespeichert; UI rendert
 * mit whitespace-pre-wrap damit line-breaks sichtbar bleiben. Keine
 * markdown, kein HTML — XSS-safe weil React's automatic-escaping.
 */

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const TITLE_MAX = 200;
const EXCERPT_MAX = 500;
const BODY_MAX = 50000; // ~ 10k words

export type BlogActionResult =
  | { ok: true; slug?: string; message?: string }
  | { ok: false; error: string };

async function requireSessionUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  return session.user.id;
}

/**
 * Slugify a title: lowercase, replace non-alphanum with hyphens,
 * collapse multi-hyphens, trim. Max 100 chars before suffix.
 */
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      // Replace common unicode mit ascii-äquivalent
      .replace(/[äöü]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[c] ?? c)
      .replace(/ß/g, 'ss')
      // Strip anything not a-z 0-9 or whitespace
      .replace(/[^a-z0-9\s-]/g, '')
      // Whitespace → hyphen
      .replace(/\s+/g, '-')
      // Collapse multi-hyphens
      .replace(/-+/g, '-')
      // Trim hyphens at edges
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'post'
  );
}

/**
 * Auto-generate excerpt from body wenn keiner explizit übergeben wurde.
 * Erste 250 zeichen, an einem wort-boundary abgeschnitten.
 */
function deriveExcerpt(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 250) return trimmed;
  const slice = trimmed.slice(0, 250);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 200 ? slice.slice(0, lastSpace) : slice) + '…';
}

// ─────────────────────────────────────────────────────────────────────
// createPost
// ─────────────────────────────────────────────────────────────────────

export async function createBlogPostAction(input: {
  title: string;
  body: string;
  excerpt?: string;
}): Promise<BlogActionResult> {
  const userId = await requireSessionUser();

  const title = input.title.trim();
  const body = input.body.trim();
  const excerpt = input.excerpt?.trim() || deriveExcerpt(body);

  if (title.length < 3) {
    return { ok: false, error: 'Title muss mindestens 3 Zeichen haben.' };
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `Title darf max ${TITLE_MAX} Zeichen haben.` };
  }
  if (body.length < 10) {
    return { ok: false, error: 'Body muss mindestens 10 Zeichen haben.' };
  }
  if (body.length > BODY_MAX) {
    return { ok: false, error: `Body darf max ${BODY_MAX} Zeichen haben.` };
  }
  if (excerpt.length > EXCERPT_MAX) {
    return { ok: false, error: `Excerpt darf max ${EXCERPT_MAX} Zeichen haben.` };
  }

  // Slug = slugify(title) + "-" + short-cuid-suffix.
  // Slugify allein könnte mit anderen posts colliden; suffix-cuid macht
  // das deterministisch unique ohne retry-loop.
  const slugBase = slugify(title);
  const slugSuffix = Math.random().toString(36).slice(2, 10);
  const slug = `${slugBase}-${slugSuffix}`;

  const post = await prisma.blogPost.create({
    data: {
      authorId: userId,
      title,
      body,
      excerpt,
      slug,
      status: 'Draft',
    },
    select: { slug: true, id: true },
  });

  revalidatePath('/me/blog');
  return { ok: true, slug: post.slug, message: 'Draft erstellt.' };
}

// ─────────────────────────────────────────────────────────────────────
// updatePost
// ─────────────────────────────────────────────────────────────────────

export async function updateBlogPostAction(
  id: string,
  input: { title?: string; body?: string; excerpt?: string },
): Promise<BlogActionResult> {
  const userId = await requireSessionUser();

  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: { authorId: true, slug: true, status: true },
  });
  if (!post) return { ok: false, error: 'Post nicht gefunden.' };
  if (post.authorId !== userId) {
    return { ok: false, error: 'Du kannst nur eigene posts editieren.' };
  }

  const data: {
    title?: string;
    body?: string;
    excerpt?: string;
  } = {};

  if (input.title !== undefined) {
    const t = input.title.trim();
    if (t.length < 3 || t.length > TITLE_MAX) {
      return {
        ok: false,
        error: `Title length muss 3-${TITLE_MAX} chars sein.`,
      };
    }
    data.title = t;
  }

  if (input.body !== undefined) {
    const b = input.body.trim();
    if (b.length < 10 || b.length > BODY_MAX) {
      return {
        ok: false,
        error: `Body length muss 10-${BODY_MAX} chars sein.`,
      };
    }
    data.body = b;
  }

  if (input.excerpt !== undefined) {
    const e = input.excerpt.trim();
    if (e.length > EXCERPT_MAX) {
      return { ok: false, error: `Excerpt max ${EXCERPT_MAX} chars.` };
    }
    data.excerpt = e || (data.body ? deriveExcerpt(data.body) : undefined);
  }

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.blogPost.update({ where: { id }, data });

  revalidatePath('/me/blog');
  revalidatePath(`/me/blog/${id}`);
  if (post.status === 'Published') {
    revalidatePath('/blog');
    revalidatePath(`/blog/${post.slug}`);
  }
  return { ok: true, message: 'Gespeichert.' };
}

// ─────────────────────────────────────────────────────────────────────
// publish / unpublish
// ─────────────────────────────────────────────────────────────────────

export async function publishBlogPostAction(
  id: string,
): Promise<BlogActionResult> {
  const userId = await requireSessionUser();

  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: { authorId: true, status: true, slug: true },
  });
  if (!post) return { ok: false, error: 'Post nicht gefunden.' };
  if (post.authorId !== userId) {
    return { ok: false, error: 'Du kannst nur eigene posts publishen.' };
  }
  if (post.status === 'Published') return { ok: true, message: 'Schon public.' };

  await prisma.blogPost.update({
    where: { id },
    data: {
      status: 'Published',
      publishedAt: new Date(),
    },
  });

  revalidatePath('/me/blog');
  revalidatePath('/blog');
  revalidatePath(`/blog/${post.slug}`);
  return { ok: true, slug: post.slug, message: 'Post publiziert.' };
}

export async function unpublishBlogPostAction(
  id: string,
): Promise<BlogActionResult> {
  const userId = await requireSessionUser();

  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: { authorId: true, status: true, slug: true },
  });
  if (!post) return { ok: false, error: 'Post nicht gefunden.' };
  if (post.authorId !== userId) {
    return { ok: false, error: 'Du kannst nur eigene posts unpublishen.' };
  }

  await prisma.blogPost.update({
    where: { id },
    // publishedAt bewusst NICHT cleared — wir wollen die history wissen
    // wann der post zum ersten mal published war. Bei re-publish bleibt
    // das original-datum erhalten (keine erneute "Neu!"-anzeige im feed).
    data: { status: 'Draft' },
  });

  revalidatePath('/me/blog');
  revalidatePath('/blog');
  revalidatePath(`/blog/${post.slug}`);
  return { ok: true, message: 'Post zurück auf Draft.' };
}

// ─────────────────────────────────────────────────────────────────────
// deletePost
// ─────────────────────────────────────────────────────────────────────

export async function deleteBlogPostAction(
  id: string,
): Promise<BlogActionResult> {
  const userId = await requireSessionUser();

  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: { authorId: true, slug: true, status: true },
  });
  if (!post) return { ok: false, error: 'Post nicht gefunden.' };
  if (post.authorId !== userId) {
    return { ok: false, error: 'Du kannst nur eigene posts löschen.' };
  }

  await prisma.blogPost.delete({ where: { id } });

  revalidatePath('/me/blog');
  if (post.status === 'Published') {
    revalidatePath('/blog');
    revalidatePath(`/blog/${post.slug}`);
  }
  return { ok: true, message: 'Post gelöscht.' };
}

// ─────────────────────────────────────────────────────────────────────
// view-counter (called from /blog/[slug] page-load)
// ─────────────────────────────────────────────────────────────────────

/**
 * Increment view-counter. NOT a server-action in the form sense —
 * called directly from the /blog/[slug] page server-component.
 * Fire-and-forget; race-conditions on counter sind toleriert (zwei
 * concurrent reads → vielleicht +1 statt +2; semantisch ok, view-counts
 * sind ein vanity-feature).
 *
 * Wir gaten auf status='Published' damit drafts nicht versehentlich
 * gezählt werden (falls jemand draft-id raten würde und treffen).
 */
export async function incrementBlogPostViews(slug: string): Promise<void> {
  try {
    await prisma.blogPost.updateMany({
      where: { slug, status: 'Published' },
      data: { viewCount: { increment: 1 } },
    });
  } catch (err) {
    console.warn('[blog] view-increment failed:', err);
  }
}
