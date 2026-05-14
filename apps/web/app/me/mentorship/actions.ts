'use server';

/**
 * Welle K / K4 — Mentorship self-service actions.
 *
 * Self-service flow (im gegensatz zum existing admin-driven matching
 * in /airline/mentorship):
 *   1. Pilots können sich als mentor verfügbar machen via setMentorshipProfile
 *   2. Andere pilots browsen /mentorship und schicken einen request
 *      via createMentorshipRequest (Mentorship.status=PROPOSED)
 *   3. Mentor accept/reject via respondToMentorshipRequest
 *   4. Beide seiten können die ACTIVE mentorship via endMentorship
 *      beenden
 *
 * # Airline-scope
 *
 * V1 enforced: mentor + mentee müssen in derselben airline sein. Cross-
 * airline mentoring wäre denkbar (für inter-airline knowledge-sharing)
 * aber Mentorship.airlineId ist NOT NULL und der existing admin-flow
 * gated darauf — wir bleiben konsistent.
 */

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';

export type MentorshipActionResult =
  | { ok: true; message?: string; mentorshipId?: string }
  | { ok: false; error: string };

async function requireSessionUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Nicht eingeloggt.');
  return session.user.id;
}

const TOPIC_MAX = 50;
const TOPICS_MAX_COUNT = 10;
const BIO_MAX = 500;

/**
 * Update mentor-profile (availability + topics + bio).
 *
 * Toggle-vom-mentor-side: wenn mentorAvailable=false gesetzt wird,
 * werden bereits gestartete ACTIVE-mentorships NICHT beendet — die
 * sind kommitments, der mentor muss explizit endMentorship aufrufen.
 * mentorAvailable=false bedeutet nur "ich nehme keine neuen mentees an".
 */
export async function setMentorshipProfileAction(input: {
  mentorAvailable: boolean;
  topics: string[];
  bio: string;
}): Promise<MentorshipActionResult> {
  const userId = await requireSessionUser();

  const topics = input.topics
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, TOPICS_MAX_COUNT);
  for (const t of topics) {
    if (t.length > TOPIC_MAX) {
      return { ok: false, error: `Topic max ${TOPIC_MAX} chars.` };
    }
  }

  const bio = input.bio.trim();
  if (bio.length > BIO_MAX) {
    return { ok: false, error: `Bio max ${BIO_MAX} chars.` };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      mentorAvailable: input.mentorAvailable,
      mentorTopics: topics,
      mentorBio: bio || null,
    },
  });

  revalidatePath('/me/mentorship');
  revalidatePath('/mentorship');
  return { ok: true, message: 'Mentor-profil aktualisiert.' };
}

/**
 * Mentee → Mentor request. Creates Mentorship.status=PROPOSED.
 *
 * Constraint: mentor + mentee müssen in derselben airline sein.
 * Mentor muss mentorAvailable=true haben (sonst tu wir so, als gäbe es
 * den mentor nicht — kein info-leak).
 *
 * Anti-spam: ein mentee kann nicht parallel zwei PROPOSED/ACTIVE
 * mentorships zum selben mentor haben. Check via existing-query
 * vor create.
 */
export async function createMentorshipRequestAction(input: {
  mentorId: string;
  topics: string[];
  notes: string;
}): Promise<MentorshipActionResult> {
  const menteeId = await requireSessionUser();

  if (input.mentorId === menteeId) {
    return { ok: false, error: 'Du kannst dich nicht selbst mentoren.' };
  }

  const [mentor, mentee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.mentorId },
      select: {
        id: true,
        airlineId: true,
        mentorAvailable: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: menteeId },
      select: { id: true, airlineId: true },
    }),
  ]);

  if (!mentor || !mentor.mentorAvailable) {
    return { ok: false, error: 'Mentor nicht verfügbar.' };
  }
  if (!mentee || !mentee.airlineId) {
    return { ok: false, error: 'Du brauchst eine airline-zugehörigkeit.' };
  }
  if (mentor.airlineId !== mentee.airlineId) {
    return {
      ok: false,
      error: 'Mentor + mentee müssen in derselben airline sein.',
    };
  }

  // Check für existing PROPOSED/ACTIVE mentorship zwischen den beiden.
  const existing = await prisma.mentorship.findFirst({
    where: {
      mentorId: input.mentorId,
      menteeId,
      status: { in: ['PROPOSED', 'ACTIVE'] },
    },
    select: { id: true, status: true },
  });
  if (existing) {
    return {
      ok: false,
      error: `Du hast bereits eine ${existing.status}-mentorship mit diesem mentor.`,
    };
  }

  const topics = input.topics
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, TOPICS_MAX_COUNT);
  const notes = input.notes.trim().slice(0, 2000) || null;

  const m = await prisma.mentorship.create({
    data: {
      airlineId: mentor.airlineId!, // non-null weil same as mentee.airlineId
      mentorId: input.mentorId,
      menteeId,
      topics,
      notes,
      status: 'PROPOSED',
    },
    select: { id: true },
  });

  revalidatePath('/me/mentorship');
  revalidatePath('/mentorship');
  return {
    ok: true,
    message: 'Anfrage gesendet. Der mentor kann sie auf seinem dashboard annehmen.',
    mentorshipId: m.id,
  };
}

/**
 * Mentor → response (accept/reject). Nur durch den mentor möglich.
 */
export async function respondToMentorshipRequestAction(input: {
  mentorshipId: string;
  accept: boolean;
}): Promise<MentorshipActionResult> {
  const userId = await requireSessionUser();

  const m = await prisma.mentorship.findUnique({
    where: { id: input.mentorshipId },
    select: {
      id: true,
      mentorId: true,
      status: true,
    },
  });
  if (!m) return { ok: false, error: 'Mentorship nicht gefunden.' };
  if (m.mentorId !== userId) {
    return { ok: false, error: 'Nur der mentor kann antworten.' };
  }
  if (m.status !== 'PROPOSED') {
    return { ok: false, error: `Status ist ${m.status}, kann nicht beantwortet werden.` };
  }

  if (input.accept) {
    await prisma.mentorship.update({
      where: { id: input.mentorshipId },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });
  } else {
    await prisma.mentorship.update({
      where: { id: input.mentorshipId },
      data: { status: 'REJECTED', endedAt: new Date() },
    });
  }

  revalidatePath('/me/mentorship');
  return {
    ok: true,
    message: input.accept ? 'Mentorship angenommen.' : 'Mentorship abgelehnt.',
  };
}

/**
 * End an ACTIVE mentorship. Beide seiten (mentor + mentee) können
 * beenden. Audit-trail bleibt via status=ENDED + endedAt erhalten.
 */
export async function endMentorshipAction(
  mentorshipId: string,
): Promise<MentorshipActionResult> {
  const userId = await requireSessionUser();

  const m = await prisma.mentorship.findUnique({
    where: { id: mentorshipId },
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      status: true,
    },
  });
  if (!m) return { ok: false, error: 'Mentorship nicht gefunden.' };
  if (m.mentorId !== userId && m.menteeId !== userId) {
    return { ok: false, error: 'Nur mentor oder mentee können beenden.' };
  }
  if (m.status !== 'ACTIVE') {
    return { ok: false, error: `Status ist ${m.status}, nur ACTIVE kann beendet werden.` };
  }

  await prisma.mentorship.update({
    where: { id: mentorshipId },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  revalidatePath('/me/mentorship');
  return { ok: true, message: 'Mentorship beendet.' };
}
