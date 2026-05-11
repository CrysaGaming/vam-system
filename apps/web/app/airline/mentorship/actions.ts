'use server';

import { prisma, MentorshipStatus } from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Track 4 #93 (Section R) — Mentorship server-actions.
 *
 * Auth: AIRLINE_MANAGER_ROLES.
 * Multi-tenant: alle queries airlineId-gescoped.
 *
 * Action-surface:
 *   - createMentorship:       admin paart mentor+mentee, default ACTIVE
 *                              (oder PROPOSED wenn invitation-flow gewollt)
 *   - acceptMentorship:       PROPOSED → ACTIVE (startedAt=now)
 *   - rejectMentorship:       PROPOSED → REJECTED (endedAt=now)
 *   - endMentorship:          ACTIVE → ENDED (endedAt=now)
 *   - deleteMentorship:       hard-delete (admin-tool für versehentliche)
 *
 * Constraint app-layer: pro mentee max 1 ACTIVE mentorship gleichzeitig.
 * Bei createMentorship checken wir das vor dem insert; bei accept ebenfalls
 * (zwischen PROPOSED und ACTIVE könnte was anderes acceptiert worden sein).
 *
 * Alle return Promise<void>; bei validation/state-errors throw new Error
 * (form-action zeigt next.js error-boundary). UX-feedback via toast wäre
 * eigene welle.
 */
const requireAdmin = requireAirlineManagerWithAirline;

// ─────────────────────────────────────────────────────────────────────────
// Create mentorship
// ─────────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  mentorId: z.string().min(1, 'Mentor fehlt'),
  menteeId: z.string().min(1, 'Mentee fehlt'),
  /** Comma-separated topics-string; split + trim + filter empty in handler */
  topicsRaw: z.string().max(1000).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  /** Initial-status: ACTIVE (admin-assign sofort) oder PROPOSED (invitation) */
  initialStatus: z.enum(['ACTIVE', 'PROPOSED']).default('ACTIVE'),
});

export async function createMentorship(formData: FormData) {
  const { airlineId } = await requireAdmin();

  const parsed = CreateSchema.safeParse({
    mentorId: String(formData.get('mentorId') ?? '').trim(),
    menteeId: String(formData.get('menteeId') ?? '').trim(),
    topicsRaw: String(formData.get('topicsRaw') ?? '').trim() || undefined,
    notes: String(formData.get('notes') ?? '').trim() || undefined,
    initialStatus: String(formData.get('initialStatus') ?? 'ACTIVE'),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Ungültige Eingabe');
  }

  if (parsed.data.mentorId === parsed.data.menteeId) {
    throw new Error('Mentor und Mentee dürfen nicht dieselbe Person sein.');
  }

  // Both users must be in actor's airline (multi-tenant gate).
  const [mentor, mentee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: parsed.data.mentorId },
      select: { id: true, airlineId: true, name: true, email: true },
    }),
    prisma.user.findUnique({
      where: { id: parsed.data.menteeId },
      select: { id: true, airlineId: true, name: true, email: true },
    }),
  ]);
  if (!mentor || mentor.airlineId !== airlineId) {
    throw new Error('Mentor nicht gefunden.');
  }
  if (!mentee || mentee.airlineId !== airlineId) {
    throw new Error('Mentee nicht gefunden.');
  }

  // Constraint: mentee darf nicht bereits in einer ACTIVE mentorship sein.
  // PROPOSED ist ok — mehrere vorschläge können gleichzeitig laufen,
  // mentee accepted dann einen davon und die anderen werden rejected.
  const activeForMentee = await prisma.mentorship.findFirst({
    where: {
      menteeId: parsed.data.menteeId,
      status: 'ACTIVE',
    },
    select: { id: true, mentor: { select: { name: true, email: true } } },
  });
  if (activeForMentee) {
    const mentorName =
      activeForMentee.mentor.name ?? activeForMentee.mentor.email;
    throw new Error(
      `${mentee.name ?? mentee.email} hat bereits eine aktive Mentorship mit ${mentorName}. Erst beenden.`,
    );
  }

  // Topics parsen: comma-separated → trim → filter empty + duplicates
  const topics = parsed.data.topicsRaw
    ? Array.from(
        new Set(
          parsed.data.topicsRaw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .slice(0, 20), // cap at 20 topics
        ),
      )
    : [];

  const now = new Date();
  await prisma.mentorship.create({
    data: {
      airlineId,
      mentorId: parsed.data.mentorId,
      menteeId: parsed.data.menteeId,
      status: parsed.data.initialStatus,
      topics,
      notes: parsed.data.notes || null,
      // Bei direkt-ACTIVE start: startedAt=now. Bei PROPOSED: bleibt null
      // bis accept.
      startedAt: parsed.data.initialStatus === 'ACTIVE' ? now : null,
    },
  });

  revalidatePath('/airline/mentorship');
  revalidatePath(`/airline/pilots/${parsed.data.mentorId}`);
  revalidatePath(`/airline/pilots/${parsed.data.menteeId}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Accept proposed mentorship
// ─────────────────────────────────────────────────────────────────────────

export async function acceptMentorship(formData: FormData) {
  const { airlineId } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Mentorship-ID fehlt.');

  const m = await prisma.mentorship.findUnique({
    where: { id },
    select: {
      id: true,
      airlineId: true,
      status: true,
      mentorId: true,
      menteeId: true,
    },
  });
  if (!m || m.airlineId !== airlineId) {
    throw new Error('Mentorship nicht gefunden.');
  }
  if (m.status !== 'PROPOSED') {
    throw new Error(
      `Mentorship ist bereits ${m.status}. Nur PROPOSED kann acceptiert werden.`,
    );
  }

  // Re-check active-mentorship-constraint zum accept-zeitpunkt — zwischen
  // create und accept könnte ein anderer vorschlag akzeptiert worden sein.
  const activeForMentee = await prisma.mentorship.findFirst({
    where: {
      menteeId: m.menteeId,
      status: 'ACTIVE',
      id: { not: m.id },
    },
    select: { id: true },
  });
  if (activeForMentee) {
    throw new Error(
      'Mentee ist bereits in einer aktiven Mentorship. Vorschlag muss erst rejected oder die aktive beendet werden.',
    );
  }

  await prisma.mentorship.update({
    where: { id: m.id },
    data: {
      status: 'ACTIVE',
      startedAt: new Date(),
    },
  });

  revalidatePath('/airline/mentorship');
  revalidatePath(`/airline/pilots/${m.mentorId}`);
  revalidatePath(`/airline/pilots/${m.menteeId}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Reject proposed mentorship
// ─────────────────────────────────────────────────────────────────────────

export async function rejectMentorship(formData: FormData) {
  const { airlineId } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Mentorship-ID fehlt.');

  const m = await prisma.mentorship.findUnique({
    where: { id },
    select: { id: true, airlineId: true, status: true, mentorId: true, menteeId: true },
  });
  if (!m || m.airlineId !== airlineId) {
    throw new Error('Mentorship nicht gefunden.');
  }
  if (m.status !== 'PROPOSED') {
    throw new Error('Nur PROPOSED-mentorships können rejected werden.');
  }

  await prisma.mentorship.update({
    where: { id: m.id },
    data: {
      status: 'REJECTED',
      endedAt: new Date(),
    },
  });

  revalidatePath('/airline/mentorship');
  revalidatePath(`/airline/pilots/${m.mentorId}`);
  revalidatePath(`/airline/pilots/${m.menteeId}`);
}

// ─────────────────────────────────────────────────────────────────────────
// End active mentorship
// ─────────────────────────────────────────────────────────────────────────

export async function endMentorship(formData: FormData) {
  const { airlineId } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Mentorship-ID fehlt.');

  const m = await prisma.mentorship.findUnique({
    where: { id },
    select: { id: true, airlineId: true, status: true, mentorId: true, menteeId: true },
  });
  if (!m || m.airlineId !== airlineId) {
    throw new Error('Mentorship nicht gefunden.');
  }
  if (m.status !== 'ACTIVE') {
    throw new Error('Nur ACTIVE-mentorships können beendet werden.');
  }

  await prisma.mentorship.update({
    where: { id: m.id },
    data: {
      status: 'ENDED',
      endedAt: new Date(),
    },
  });

  revalidatePath('/airline/mentorship');
  revalidatePath(`/airline/pilots/${m.mentorId}`);
  revalidatePath(`/airline/pilots/${m.menteeId}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Delete mentorship (hard-delete für admin-tool)
// ─────────────────────────────────────────────────────────────────────────

export async function deleteMentorship(formData: FormData) {
  const { airlineId } = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Mentorship-ID fehlt.');

  const m = await prisma.mentorship.findUnique({
    where: { id },
    select: { id: true, airlineId: true, mentorId: true, menteeId: true },
  });
  if (!m || m.airlineId !== airlineId) {
    throw new Error('Mentorship nicht gefunden.');
  }

  await prisma.mentorship.delete({ where: { id: m.id } });

  revalidatePath('/airline/mentorship');
  revalidatePath(`/airline/pilots/${m.mentorId}`);
  revalidatePath(`/airline/pilots/${m.menteeId}`);
}

// NOTE: 'use server' modules dürfen nur async-functions exporten. Wenn ein
// consumer (z.B. page.tsx) MentorshipStatus braucht → direkt von @vam/db
// importieren, nicht von hier.
