'use server';

/**
 * Invite-Actions — Pilot-Onboarding via Token-Links.
 *
 * Admin-Workflow: createInvite() → admin kopiert link → schickt manuell
 * (Discord, Email, etc.) an pending pilot. Wir senden den Link nicht
 * automatisch, damit der admin den delivery-channel kontrolliert.
 *
 * Pilot-Workflow: klickt link → /invite/[token] → ggf. Discord-OAuth
 * login → "Annehmen" button → acceptInvite() weist Airline+Role zu.
 *
 * Security-Modell:
 *   - Token = cuid (25 chars, unguessable)
 *   - Email-field beim invite ist nur ein hint für den admin, nicht
 *     gate-relevant. Identity kommt aus der NextAuth-session.
 *   - First-accept-wins via usedAt-check; subsequent attempts abgelehnt.
 *   - Expiry = createdAt + 7d default; admin kann revoken via
 *     setExpiresAt(now).
 */

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

async function requireAirlineAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    throw new Error('forbidden');
  }
  if (!user.airlineId) {
    throw new Error('no-airline');
  }

  return { user, airlineId: user.airlineId };
}

export type InviteRow = {
  id: string;
  token: string;
  email: string | null;
  roleName: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  usedByName: string | null;
  createdByName: string | null;
  createdAt: Date;
  // Computed:
  status: 'pending' | 'used' | 'expired' | 'revoked';
};

/**
 * List invites for the admin's airline. Mixed pending + used + expired.
 * Recent-first ordering.
 */
export async function listInvites(): Promise<InviteRow[]> {
  const { airlineId } = await requireAirlineAdmin();

  const invites = await prisma.invite.findMany({
    where: { airlineId },
    include: {
      role: { select: { name: true } },
      usedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const now = new Date();
  return invites.map((inv) => {
    let status: InviteRow['status'];
    if (inv.usedAt) status = 'used';
    else if (inv.expiresAt < now) {
      // Expired AT createdAt+7d normally; but admin-revoke sets
      // expiresAt to past — beide sehen identisch aus, "expired"
      // ist ok als label.
      status = inv.expiresAt.getTime() < inv.createdAt.getTime() + 1000
        ? 'revoked'
        : 'expired';
    } else status = 'pending';

    return {
      id: inv.id,
      token: inv.token,
      email: inv.email,
      roleName: inv.role?.name ?? null,
      expiresAt: inv.expiresAt,
      usedAt: inv.usedAt,
      usedByName: inv.usedBy?.name ?? null,
      createdByName: inv.createdBy?.name ?? null,
      createdAt: inv.createdAt,
      status,
    };
  });
}

const createInviteSchema = z.object({
  email: z.string().email().optional().or(z.literal('')),
  roleId: z.string().optional().or(z.literal('')),
  expiryDays: z.coerce.number().int().min(1).max(30).default(7),
});

export type CreateInviteResult =
  | { ok: true; invite: { id: string; token: string; expiresAt: Date } }
  | { ok: false; error: string };

export async function createInvite(formData: FormData): Promise<CreateInviteResult> {
  const { user, airlineId } = await requireAirlineAdmin();

  const parsed = createInviteSchema.safeParse({
    email: formData.get('email') ?? '',
    roleId: formData.get('roleId') ?? '',
    expiryDays: formData.get('expiryDays') ?? 7,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe' };
  }

  const expiresAt = new Date(Date.now() + parsed.data.expiryDays * 24 * 60 * 60 * 1000);

  const invite = await prisma.invite.create({
    data: {
      // cuid via @id @default(cuid()) generates the id; token same format
      // but separate field so we can rotate or make it shorter later.
      token: crypto.randomUUID().replace(/-/g, ''),
      email: parsed.data.email || null,
      airlineId,
      roleId: parsed.data.roleId || null,
      expiresAt,
      createdById: user.id,
    },
  });

  revalidatePath('/airline');

  return {
    ok: true,
    invite: { id: invite.id, token: invite.token, expiresAt: invite.expiresAt },
  };
}

export type RevokeInviteResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Revoke a pending invite. Sets expiresAt to past — already-used invites
 * cannot be revoked (no-op for safety).
 */
export async function revokeInvite(inviteId: string): Promise<RevokeInviteResult> {
  const { airlineId } = await requireAirlineAdmin();

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.airlineId !== airlineId) {
    return { ok: false, error: 'Invite nicht gefunden' };
  }
  if (invite.usedAt) {
    return { ok: false, error: 'Bereits eingelöst — kann nicht widerrufen werden' };
  }

  // Setting expiresAt < createdAt is the marker we use to distinguish
  // "expired naturally" from "revoked by admin" in listInvites status.
  await prisma.invite.update({
    where: { id: inviteId },
    data: { expiresAt: new Date(invite.createdAt.getTime() - 1000) },
  });

  revalidatePath('/airline');
  return { ok: true };
}

export async function listRolesForInvite() {
  await requireAirlineAdmin();
  // Show all roles — admin decides which to assign. Empty roleName is
  // also valid (= no role assigned, user joins as plain pilot).
  return prisma.role.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
}

// === ACCEPT FLOW ===
//
// Invoked from /invite/[token] page after the user has authenticated.
// Validates the token + assigns the user to the airline+role.

export type AcceptInviteResult =
  | { ok: true; airlineId: string }
  | { ok: false; error: string };

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Bitte zuerst einloggen' };
  }

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { airline: { select: { id: true, name: true } } },
  });

  if (!invite) {
    return { ok: false, error: 'Invite nicht gefunden' };
  }
  if (invite.usedAt) {
    return { ok: false, error: 'Invite wurde bereits eingelöst' };
  }
  if (invite.expiresAt < new Date()) {
    return { ok: false, error: 'Invite ist abgelaufen' };
  }

  // Idempotency check: if user is already in this airline with the
  // intended role, just mark the invite used and proceed.
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true, roleId: true },
  });

  if (!currentUser) {
    return { ok: false, error: 'User nicht gefunden' };
  }

  // Block if user is already in a different airline — switching airlines
  // via invite is intentional but we want explicit confirmation in v1.
  // For now: error out, admin can manually unset airlineId or v2 flow.
  if (currentUser.airlineId && currentUser.airlineId !== invite.airlineId) {
    return {
      ok: false,
      error: `Du bist bereits Mitglied einer anderen Airline. Bitte wende dich an einen Admin um zu wechseln.`,
    };
  }

  // Atomic: assign user + mark invite used. If either fails, both rollback.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: {
        airlineId: invite.airlineId,
        // Only overwrite role if the invite specifies one. Don't clear
        // an existing role with null.
        ...(invite.roleId ? { roleId: invite.roleId } : {}),
      },
    }),
    prisma.invite.update({
      where: { id: invite.id },
      data: {
        usedAt: new Date(),
        usedById: session.user.id,
      },
    }),
  ]);

  revalidatePath('/dashboard');
  revalidatePath('/airline');

  return { ok: true, airlineId: invite.airlineId };
}
