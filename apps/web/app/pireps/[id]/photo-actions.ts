'use server';

/**
 * Track 5 #15 (Section C) — PIREP-Photo server-actions.
 *
 * createPhotoAction:  jeder logged-in user der den PIREP sehen kann
 * deletePhotoAction:  owner OR admin/airline-admin
 *
 * Wir checken den PIREP-existence vor create (sonst kommt prisma mit
 * P2003 FK-violation und das wäre kryptisch für den user).
 *
 * Für deletePhotoAction berechnen wir die canDeleteAny-permission
 * server-side: admin oder airline-admin in derselben airline wie der
 * PIREP. Das ist dasselbe muster wie bei PirepAnnotation-deletion.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  prisma,
  createPhoto,
  deletePhoto,
  PhotoNotFoundError,
  PhotoForbiddenError,
  PhotoUrlError,
  PhotoCaptionError,
  PhotoLimitError,
} from '@vam/db';

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  return session.user.id;
}

type ActionResult =
  | { success: true }
  | { success: false; error: string };

function formatError(e: unknown): string {
  if (e instanceof PhotoNotFoundError) return 'Foto nicht gefunden.';
  if (e instanceof PhotoForbiddenError) return 'Keine Berechtigung.';
  if (e instanceof PhotoUrlError) return e.message;
  if (e instanceof PhotoCaptionError) return e.message;
  if (e instanceof PhotoLimitError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Unbekannter Fehler.';
}

export async function createPhotoAction(
  pirepId: string,
  rawUrl: string,
  rawCaption: string | null,
): Promise<ActionResult> {
  const userId = await requireUserId();

  // PIREP-existence-check. Gleichzeitig die airline-id fetchen damit
  // wir checken können dass der user den PIREP sehen darf (= entweder
  // owner oder approver in derselben airline). Sonst könnte jemand
  // mit einem cross-airline-PIREP-id einen photo dranhängen.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: { id: true, userId: true, airlineId: true },
  });
  if (!pirep) return { success: false, error: 'PIREP nicht gefunden.' };

  // Access-check: owner ODER selbe airline wie der user. Nicht-owner
  // ohne airline-match darf nicht posten. (Falls die page-action das
  // schon enforced hat ist der check hier defensive.)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { airlineId: true },
  });
  const isOwn = pirep.userId === userId;
  const sameAirline =
    user?.airlineId !== null && user?.airlineId === pirep.airlineId;
  if (!isOwn && !sameAirline) {
    return { success: false, error: 'Keine Berechtigung.' };
  }

  try {
    await createPhoto(userId, pirepId, rawUrl, rawCaption);
  } catch (e) {
    return { success: false, error: formatError(e) };
  }
  revalidatePath(`/pireps/${pirepId}`);
  return { success: true };
}

export async function deletePhotoAction(
  photoId: string,
  pirepId: string,
): Promise<ActionResult> {
  const userId = await requireUserId();

  // canDeleteAny berechnen: ist der user admin oder airline-admin
  // in derselben airline wie der PIREP? Wenn ja kann er fremde photos
  // löschen (moderation).
  const [user, pirep] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { airlineId: true, role: { select: { name: true } } },
    }),
    prisma.pirep.findUnique({
      where: { id: pirepId },
      select: { airlineId: true },
    }),
  ]);

  const isModRole =
    user?.role?.name === 'admin' || user?.role?.name === 'airline-admin';
  const sameAirline =
    user?.airlineId !== null && user?.airlineId === pirep?.airlineId;
  const canDeleteAny = isModRole && sameAirline;

  try {
    await deletePhoto(photoId, userId, { canDeleteAny });
  } catch (e) {
    return { success: false, error: formatError(e) };
  }
  revalidatePath(`/pireps/${pirepId}`);
  return { success: true };
}
