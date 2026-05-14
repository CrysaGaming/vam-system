'use server';

/**
 * Welle K / K3 — Photo-of-the-Week admin server actions.
 *
 * Admin-only mutations. Approver-rollen können photos featuren oder
 * unfeaturen. Mehrere photos können gleichzeitig featuredAt gesetzt
 * haben — wir "rotieren" nicht hart; das letzte featured-photo wird
 * auf /photo-of-the-week als aktuelles gezeigt, ältere landen in
 * der history-grid.
 *
 * # Why kein wöchentlicher cron
 *
 * Auto-rotation wäre nice-to-have aber V1 ist admin-curated. Admin
 * pickt manuell ein highlight wenn er lust hat — bewusst ohne fixen
 * weekly-cycle damit niedrige photo-volumes nicht zu "leeren wochen"
 * mit dem gleichen photo führen.
 */

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { isApproverRole } from '@/lib/roles';

export type PhotoActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Nicht eingeloggt.');
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!user || !isApproverRole(user.role?.name)) {
    throw new Error('Keine Berechtigung — nur approver-rollen.');
  }
  return user.id;
}

export async function featurePhotoAction(
  photoId: string,
): Promise<PhotoActionResult> {
  const adminId = await requireAdmin();

  const photo = await prisma.pirepPhoto.findUnique({
    where: { id: photoId },
    select: { id: true, featuredAt: true },
  });
  if (!photo) return { ok: false, error: 'Photo nicht gefunden.' };
  if (photo.featuredAt) return { ok: true, message: 'Schon featured.' };

  await prisma.pirepPhoto.update({
    where: { id: photoId },
    data: {
      featuredAt: new Date(),
      featuredById: adminId,
    },
  });

  revalidatePath('/photo-of-the-week');
  revalidatePath('/admin/photo-of-the-week');
  return { ok: true, message: 'Featured.' };
}

export async function unfeaturePhotoAction(
  photoId: string,
): Promise<PhotoActionResult> {
  await requireAdmin();

  const photo = await prisma.pirepPhoto.findUnique({
    where: { id: photoId },
    select: { id: true, featuredAt: true },
  });
  if (!photo) return { ok: false, error: 'Photo nicht gefunden.' };
  if (!photo.featuredAt) return { ok: true, message: 'War nicht featured.' };

  await prisma.pirepPhoto.update({
    where: { id: photoId },
    data: {
      featuredAt: null,
      featuredById: null,
    },
  });

  revalidatePath('/photo-of-the-week');
  revalidatePath('/admin/photo-of-the-week');
  return { ok: true, message: 'Unfeatured.' };
}
