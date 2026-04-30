'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Admin gate scoped to a specific airline. Returns the admin user along
 * with their airlineId so callers don't need a second query. Throws on
 * any of: no session, no admin role, no airline assignment.
 *
 * The "scoped to airline" part matters for the airline-admin-panel: a
 * global admin who isn't a member of any airline still has nothing to
 * manage here — the panel is for airline-internal management.
 */
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

export type AirlineMember = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  roleName: string | null;
  rankName: string | null;
  totalFlightHours: number;
  totalFlights: number;
  joinedAt: Date | null; // we don't track this; use createdAt as proxy
};

export type AirlineSettings = {
  id: string;
  icao: string;
  iata: string | null;
  name: string;
  callsign: string | null;
  logoUrl: string | null;
};

/**
 * List all members of the admin's airline with their role + rank +
 * activity stats. Used by the airline-admin-panel to render the member
 * table with role-assignment dropdowns.
 */
export async function listAirlineMembers(): Promise<AirlineMember[]> {
  const { airlineId } = await requireAirlineAdmin();

  const users = await prisma.user.findMany({
    where: { airlineId },
    include: { role: true, rank: true },
    orderBy: [{ totalFlightHours: 'desc' }, { name: 'asc' }],
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    roleName: u.role?.name ?? null,
    rankName: u.rank?.name ?? null,
    totalFlightHours: u.totalFlightHours,
    totalFlights: u.totalFlights,
    // The User model doesn't have a joinedAt field separately — using
    // createdAt as the proxy. Future: add airline-membership table with
    // explicit joined-at tracking when invite-flow (#22) lands.
    joinedAt: null,
  }));
}

/** All available roles for the role-assignment dropdown. */
export async function listAvailableRoles() {
  await requireAirlineAdmin();
  return prisma.role.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { createdAt: 'asc' },
  });
}

const AssignRoleSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().nullable(),
});

/**
 * Assign (or unassign with null) a role to a member. Two safety guards:
 *   1) Target user must be a member of the admin's airline — prevents
 *      a malicious admin from elevating users in other airlines.
 *   2) Cannot demote the last admin of the airline — would lock out
 *      the airline from any future role-changes. The admin must
 *      explicitly promote a successor first.
 */
export async function assignRoleToMember(
  input: z.infer<typeof AssignRoleSchema>,
) {
  const { airlineId, user: actingAdmin } = await requireAirlineAdmin();
  const parsed = AssignRoleSchema.parse(input);

  // Scope-guard: target user must be in same airline.
  const target = await prisma.user.findUnique({
    where: { id: parsed.userId },
    include: { role: true },
  });
  if (!target || target.airlineId !== airlineId) {
    throw new Error('forbidden');
  }

  // Last-admin protection. If we're about to remove admin from the
  // last admin, refuse. Allow self-demotion only if there is at least
  // one other admin in the airline.
  if (target.role?.name === 'admin') {
    const newRole = parsed.roleId
      ? await prisma.role.findUnique({ where: { id: parsed.roleId } })
      : null;
    const becomingNonAdmin = !newRole || newRole.name !== 'admin';
    if (becomingNonAdmin) {
      const otherAdmins = await prisma.user.count({
        where: {
          airlineId,
          NOT: { id: target.id },
          role: { name: 'admin' },
        },
      });
      if (otherAdmins === 0) {
        throw new Error(
          'Letzten Admin der Airline kann man nicht demoten. ' +
            'Erst einen anderen User zum Admin machen.',
        );
      }
    }
  }

  await prisma.user.update({
    where: { id: parsed.userId },
    data: { roleId: parsed.roleId },
  });

  // Audit-log placeholder — when invite/audit-tracking lands we'll
  // record actor + target + previous + new role. For now, just log
  // server-side so it shows up in dev console.
  console.log(
    `[airline-admin] ${actingAdmin.name} assigned role ${parsed.roleId} ` +
      `to ${target.name} in airline ${airlineId}`,
  );

  revalidatePath('/airline');
}

const AirlineSettingsSchema = z.object({
  name: z.string().min(2).max(80),
  callsign: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9 ]+$/, 'Nur Großbuchstaben und Ziffern')
    .optional()
    .nullable(),
  iata: z
    .string()
    .length(2)
    .regex(/^[A-Z0-9]{2}$/)
    .optional()
    .nullable(),
  logoUrl: z.string().url().max(500).optional().nullable(),
});

/** Read airline settings for the admin's airline. */
export async function getAirlineSettings(): Promise<AirlineSettings> {
  const { airlineId } = await requireAirlineAdmin();
  const a = await prisma.airline.findUnique({ where: { id: airlineId } });
  if (!a) throw new Error('not-found');
  return {
    id: a.id,
    icao: a.icao,
    iata: a.iata,
    name: a.name,
    callsign: a.callsign,
    logoUrl: a.logoUrl,
  };
}

/**
 * Update airline metadata. ICAO is intentionally not editable here —
 * it's the unique identifier referenced by aircraft, routes, and bookings,
 * so a rename would cascade across the system. If a user truly needs to
 * change ICAO, that's a migration-level operation, not a UI action.
 */
export async function updateAirlineSettings(
  input: z.infer<typeof AirlineSettingsSchema>,
) {
  const { airlineId } = await requireAirlineAdmin();
  const parsed = AirlineSettingsSchema.parse(input);

  await prisma.airline.update({
    where: { id: airlineId },
    data: {
      name: parsed.name,
      callsign: parsed.callsign?.trim().toUpperCase() || null,
      iata: parsed.iata?.trim().toUpperCase() || null,
      logoUrl: parsed.logoUrl?.trim() || null,
    },
  });

  revalidatePath('/airline');
  revalidatePath('/dashboard');
}
