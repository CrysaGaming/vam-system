'use server';

import { prisma } from '@vam/db';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Track 4 #99 (Section S) — EventComment server-actions.
 *
 * Auth: member-only via auth() session.
 * Multi-tenant: gate via event-airline-match. Pilots können nur events
 * ihrer eigenen airline kommentieren (oder VA-wide events). Admins
 * können in beliebigen events kommentieren (für moderation oder
 * announcements).
 *
 * Action-surface:
 *   - createCommentAction:  pilot postet einen comment auf einem event
 *   - deleteCommentAction:  author löscht eigenen comment ODER admin
 *                           löscht beliebigen comment
 *
 * # Out-of-scope für V1
 *
 * - Edit-flow: nicht implementiert. Pilot löscht + neu posten. Edits
 *   wären für audit-trail interesssant aber MVP nimmt das raus.
 * - Mention/notification: kein @-parsing. Pilots erwähnen sich frei,
 *   keine notification-emission.
 * - Threading/replies: flat. Threading wäre eigene welle.
 */

const CreateSchema = z.object({
  eventId: z.string().min(1, 'Event-ID fehlt.'),
  slug: z.string().min(1, 'Slug fehlt.'),
  body: z
    .string()
    .trim()
    .min(1, 'Comment darf nicht leer sein.')
    .max(2000, 'Comment ist zu lang (max 2000 zeichen).'),
});

// ─────────────────────────────────────────────────────────────────────────
// Create comment
// ─────────────────────────────────────────────────────────────────────────

export async function createCommentAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Nicht angemeldet.');

  const parsed = CreateSchema.safeParse({
    eventId: formData.get('eventId'),
    slug: formData.get('slug'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Ungültige Eingabe.');
  }

  // Multi-tenant gate: event muss zur user-airline gehören oder
  // VA-wide sein. Verhindert dass user comments in fremde airlines posten.
  const [event, currentUser] = await Promise.all([
    prisma.event.findUnique({
      where: { id: parsed.data.eventId },
      select: { id: true, airlineId: true, status: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { airlineId: true, role: { select: { name: true } } },
    }),
  ]);

  if (!event) throw new Error('Event nicht gefunden.');
  const isAdmin = currentUser?.role?.name === 'admin';

  // Airline-scope gate (admins skippen das)
  if (
    !isAdmin &&
    event.airlineId !== null &&
    event.airlineId !== currentUser?.airlineId
  ) {
    throw new Error('Du gehörst nicht zur airline dieses events.');
  }

  // DRAFT-events sollten nicht von public-side bekommentiert werden.
  // Admin-preview ist auf der admin-page, dort gibt's keine comment-UI.
  if (event.status === 'DRAFT' && !isAdmin) {
    throw new Error('Dieses event ist noch nicht publiziert.');
  }

  await prisma.eventComment.create({
    data: {
      eventId: event.id,
      userId: session.user.id,
      body: parsed.data.body,
    },
  });

  revalidatePath(`/events/${parsed.data.slug}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Delete comment
// ─────────────────────────────────────────────────────────────────────────

export async function deleteCommentAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Nicht angemeldet.');

  const id = String(formData.get('id') ?? '');
  const slug = String(formData.get('slug') ?? '');
  if (!id) throw new Error('Comment-ID fehlt.');

  const [comment, currentUser] = await Promise.all([
    prisma.eventComment.findUnique({
      where: { id },
      select: { id: true, userId: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: { select: { name: true } } },
    }),
  ]);

  if (!comment) throw new Error('Comment nicht gefunden.');

  const isAdmin = currentUser?.role?.name === 'admin';
  const isAuthor = comment.userId === session.user.id;

  if (!isAdmin && !isAuthor) {
    throw new Error('Du darfst diesen comment nicht löschen.');
  }

  await prisma.eventComment.delete({ where: { id: comment.id } });

  if (slug) revalidatePath(`/events/${slug}`);
}
