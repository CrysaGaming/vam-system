'use server';

/**
 * Track 5 #3 — PIREP-Annotation server-actions.
 *
 * Three mutations: create / update / delete. Alle mit auth-checks am
 * server. Audit-log integration via Track 4 #101 (`AdminAuditLog`).
 *
 * # Auth-policy (siehe PirepAnnotation model-doc)
 *
 * - Create: approver-role (admin/airline-admin/instructor) in same airline
 * - Update: author-only (kein admin-override; admins können löschen+neu-
 *   anlegen wenn nötig — verhindert silent-edits durch fremde)
 * - Delete: author OR airline-admin/admin in same airline
 *
 * # Validation
 *
 * - frameIndex: int, >= 0, < total-positions-of-pirep-session. Server
 *   liest die positions-count um upper-bound zu prüfen. Bei out-of-range
 *   → error (statt silent clamp damit der user merkt dass was nicht
 *   stimmt).
 * - body: 1..1000 chars after trim. Empty after trim → error. Über 1000
 *   → error (statt silent truncate).
 *
 * # Cache-revalidation
 *
 * Bei jedem mutate: revalidatePath('/pireps/[id]/replay', 'page') +
 * revalidatePath('/pireps/[id]', 'page'). Beide pages zeigen
 * annotations und brauchen frisch nach mutation.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma, hasReplayDataForPirep, logAdminAction } from '@vam/db';
import { isApproverRole, APPROVER_ROLES } from '@/lib/roles';

const BODY_MAX_CHARS = 1000;

export type AnnotationActionResult =
  | { ok: true; annotationId: string }
  | { ok: false; error: string };

/**
 * Resolve the count of replay-positions for a PIREP. Used to validate
 * frameIndex upper-bound. Returns null wenn keine session matched
 * (PIREP ohne replay) — caller behandelt das als "kann keine
 * annotations setzen weil kein trail".
 *
 * Wir nutzen hasReplayDataForPirep + dann count(positions) als
 * 2-step damit wir die teuren positions nicht laden müssen — wir
 * brauchen NUR die count.
 *
 * Allerdings: hasReplayDataForPirep gibt boolean. Für die count müssen
 * wir die session-id auflösen. Statt einen neuen helper zu bauen,
 * machen wir das hier inline mit selber matching-logic wie der bestehende
 * helper (acars-event-trigger zuerst, dann heuristic). Kleine duplication
 * akzeptiert weil:
 *  1. Der match-helper ist in @vam/db nicht öffentlich exportiert in
 *     einer count-form
 *  2. Diese action ist die einzige stelle die total-positions-count
 *     braucht
 *  3. Bei zukünftigem refactor kann ein `getReplaySessionId(pirepId)`
 *     helper das ablösen
 */
async function getReplayPositionCount(pirepId: string): Promise<number | null> {
  const has = await hasReplayDataForPirep(pirepId);
  if (!has) return null;

  // Match-logic re-implementiert inline. Mirrors hasReplayDataForPirep
  // in packages/db/src/replay/queries.ts. Bei zukünftigem refactor:
  // helper extrahieren.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: {
      userId: true,
      submittedAt: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      triggeringEvent: { select: { sessionId: true } },
    },
  });
  if (!pirep) return null;

  let sessionId: string | null = pirep.triggeringEvent?.sessionId ?? null;
  if (!sessionId) {
    const submittedMs = pirep.submittedAt.getTime();
    const minUpdatedAt = new Date(submittedMs - 24 * 60 * 60 * 1000);
    const maxUpdatedAt = new Date(submittedMs + 60 * 60 * 1000);
    const session = await prisma.liveSession.findFirst({
      where: {
        userId: pirep.userId,
        departureIcao: pirep.departure.icao,
        arrivalIcao: pirep.arrival.icao,
        lastUpdatedAt: { gte: minUpdatedAt, lte: maxUpdatedAt },
      },
      orderBy: { lastUpdatedAt: 'desc' },
      select: { id: true },
    });
    sessionId = session?.id ?? null;
  }
  if (!sessionId) return null;

  return prisma.liveSessionPosition.count({ where: { sessionId } });
}

export async function createAnnotation(
  pirepId: string,
  frameIndex: number,
  body: string,
): Promise<AnnotationActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Nicht angemeldet.' };
  }

  // Body-validation. Trim damit nur-whitespace-strings nicht durchkommen.
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Annotation darf nicht leer sein.' };
  }
  if (trimmed.length > BODY_MAX_CHARS) {
    return {
      ok: false,
      error: `Annotation max ${BODY_MAX_CHARS} Zeichen (du hast ${trimmed.length}).`,
    };
  }

  // FrameIndex sanity. Int >= 0 erstmal.
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    return { ok: false, error: 'Ungültiger Frame-Index.' };
  }

  const [currentUser, pirep] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      include: { role: true },
    }),
    prisma.pirep.findUnique({
      where: { id: pirepId },
      select: { id: true, airlineId: true, userId: true },
    }),
  ]);

  if (!currentUser) {
    return { ok: false, error: 'User nicht gefunden.' };
  }
  if (!pirep) {
    return { ok: false, error: 'PIREP nicht gefunden.' };
  }

  // Auth: approver in same airline.
  const isApprover = isApproverRole(currentUser.role?.name);
  const sameAirline = currentUser.airlineId === pirep.airlineId;
  if (!isApprover || !sameAirline) {
    return {
      ok: false,
      error: 'Nur Instructors/Admins der gleichen Airline können annotieren.',
    };
  }

  // FrameIndex upper-bound. Wenn kein replay-trail existiert, blocken
  // wir die annotation komplett — eine annotation an einem frame der
  // nicht visualisierbar ist macht keinen sinn.
  const totalFrames = await getReplayPositionCount(pirepId);
  if (totalFrames === null) {
    return {
      ok: false,
      error: 'Keine Replay-Daten — Annotation nicht möglich.',
    };
  }
  if (frameIndex >= totalFrames) {
    return {
      ok: false,
      error: `Frame-Index ${frameIndex} außerhalb des Trails (max ${totalFrames - 1}).`,
    };
  }

  const annotation = await prisma.pirepAnnotation.create({
    data: {
      pirepId,
      authorId: currentUser.id,
      frameIndex,
      body: trimmed,
    },
    select: { id: true },
  });

  await logAdminAction({
    actorId: currentUser.id,
    action: 'pirep_annotation.create',
    targetType: 'pirep_annotation',
    targetId: annotation.id,
    metadata: {
      pirepId,
      frameIndex,
      bodyLength: trimmed.length,
    },
  });

  revalidatePath(`/pireps/${pirepId}`);
  revalidatePath(`/pireps/${pirepId}/replay`);

  return { ok: true, annotationId: annotation.id };
}

export async function updateAnnotation(
  annotationId: string,
  body: string,
): Promise<AnnotationActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Nicht angemeldet.' };
  }

  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Annotation darf nicht leer sein.' };
  }
  if (trimmed.length > BODY_MAX_CHARS) {
    return {
      ok: false,
      error: `Annotation max ${BODY_MAX_CHARS} Zeichen (du hast ${trimmed.length}).`,
    };
  }

  const annotation = await prisma.pirepAnnotation.findUnique({
    where: { id: annotationId },
    select: { id: true, authorId: true, pirepId: true },
  });
  if (!annotation) {
    return { ok: false, error: 'Annotation nicht gefunden.' };
  }

  // Only author can edit. Kein admin-override — siehe action-doc.
  if (annotation.authorId !== session.user.id) {
    return {
      ok: false,
      error: 'Nur der Autor kann seine Annotation bearbeiten.',
    };
  }

  await prisma.pirepAnnotation.update({
    where: { id: annotationId },
    data: { body: trimmed },
  });

  await logAdminAction({
    actorId: session.user.id,
    action: 'pirep_annotation.update',
    targetType: 'pirep_annotation',
    targetId: annotationId,
    metadata: {
      pirepId: annotation.pirepId,
      bodyLength: trimmed.length,
    },
  });

  revalidatePath(`/pireps/${annotation.pirepId}`);
  revalidatePath(`/pireps/${annotation.pirepId}/replay`);

  return { ok: true, annotationId };
}

export async function deleteAnnotation(
  annotationId: string,
): Promise<AnnotationActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Nicht angemeldet.' };
  }

  const [currentUser, annotation] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      include: { role: true },
    }),
    prisma.pirepAnnotation.findUnique({
      where: { id: annotationId },
      select: {
        id: true,
        authorId: true,
        pirepId: true,
        pirep: { select: { airlineId: true } },
      },
    }),
  ]);

  if (!currentUser) {
    return { ok: false, error: 'User nicht gefunden.' };
  }
  if (!annotation) {
    return { ok: false, error: 'Annotation nicht gefunden.' };
  }

  // Auth: author OR admin/airline-admin in same airline.
  const isAuthor = annotation.authorId === currentUser.id;
  const roleName = currentUser.role?.name;
  const isAdmin = roleName === 'admin' || roleName === 'airline-admin';
  const sameAirline = currentUser.airlineId === annotation.pirep.airlineId;
  const canDelete = isAuthor || (isAdmin && sameAirline);
  if (!canDelete) {
    return {
      ok: false,
      error: 'Keine Berechtigung zum Löschen.',
    };
  }

  await prisma.pirepAnnotation.delete({
    where: { id: annotationId },
  });

  await logAdminAction({
    actorId: currentUser.id,
    action: 'pirep_annotation.delete',
    targetType: 'pirep_annotation',
    targetId: annotationId,
    metadata: {
      pirepId: annotation.pirepId,
      deletedBy: isAuthor ? 'author' : 'admin',
    },
  });

  revalidatePath(`/pireps/${annotation.pirepId}`);
  revalidatePath(`/pireps/${annotation.pirepId}/replay`);

  return { ok: true, annotationId };
}

// Approver-roles export für client-side gates (z.B. "Add"-button nur
// für approver rendern). Avoids importing the @/lib/roles enum from
// a client component which would pull in server-only auth code.
export const APPROVER_ROLES_FOR_CLIENT = APPROVER_ROLES;
