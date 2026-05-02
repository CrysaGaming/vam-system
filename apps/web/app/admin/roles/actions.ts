'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Role names that are referenced in code via string-literal checks (e.g.
 * `role.name === 'admin'` in dashboard, pireps gating, etc.). These must
 * not be renamed or deleted via the UI — doing so would silently break
 * authorization checks across the app. The UI surface should show these
 * as "system roles" with name read-only and delete disabled.
 *
 * If a future refactor migrates the gating logic to permission-array
 * checks (`role.permissions.includes('approve.pireps')`), this list can
 * shrink — but until then it's the safety-net that keeps role-renames
 * from causing silent auth-bypasses.
 */
const SYSTEM_ROLE_NAMES = ['admin', 'airline-admin', 'instructor', 'pilot', 'trainee'];

/** Admin-only gate. Returns the admin user, or throws if non-admin. */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    throw new Error('forbidden');
  }
  return user;
}

const RoleNameSchema = z
  .string()
  .min(2, 'Name muss mindestens 2 Zeichen haben')
  .max(40, 'Name darf höchstens 40 Zeichen haben')
  .regex(/^[a-z][a-z0-9_-]*$/, 'Nur Kleinbuchstaben, Ziffern, "-" und "_"');

const RoleInputSchema = z.object({
  name: RoleNameSchema,
  description: z.string().max(500).optional().nullable(),
  permissions: z.array(z.string()).max(50).default([]),
});

const RoleUpdateSchema = z.object({
  description: z.string().max(500).optional().nullable(),
  permissions: z.array(z.string()).max(50).default([]),
});

export type RoleListItem = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
  createdAt: Date;
};

/**
 * List all roles in the system, with a per-role user-count so the UI can
 * disable delete on roles that still have assignees. The user-count is a
 * single GROUP BY query — no N+1.
 */
export async function listRoles(): Promise<RoleListItem[]> {
  await requireAdmin();

  const roles = await prisma.role.findMany({
    orderBy: { createdAt: 'asc' },
  });

  // Get user-counts in one query, then attach. groupBy returns array of
  // { roleId, _count: { _all: N } } for each role that has at least one
  // user — roles with zero users are simply absent from the result.
  const counts = await prisma.user.groupBy({
    by: ['roleId'],
    _count: { _all: true },
    where: { roleId: { not: null } },
  });
  const countByRoleId = new Map(
    counts.map((c) => [c.roleId, c._count._all]),
  );

  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
    isSystem: SYSTEM_ROLE_NAMES.includes(r.name),
    userCount: countByRoleId.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }));
}

/**
 * Create a new role. Name must be unique (DB unique constraint will throw
 * if not), and must follow the lowercase-snake-or-kebab convention so
 * future code-references stay consistent with existing role-names.
 *
 * The newly created role has zero users — assignment happens via the
 * airline-admin-panel (#21) where members are listed with role-pickers.
 */
export async function createRole(input: z.infer<typeof RoleInputSchema>) {
  await requireAdmin();

  const parsed = RoleInputSchema.parse(input);

  // Uniqueness pre-check for nicer error message than the raw P2002 from
  // Prisma. Race-condition-tolerant: the DB constraint is the real
  // guarantee, this just fronts a friendly error.
  const existing = await prisma.role.findUnique({
    where: { name: parsed.name },
  });
  if (existing) {
    throw new Error(`Eine Rolle mit dem Namen "${parsed.name}" existiert bereits`);
  }

  await prisma.role.create({
    data: {
      name: parsed.name,
      description: parsed.description ?? null,
      permissions: parsed.permissions,
    },
  });

  revalidatePath('/admin/roles');
}

/**
 * Update description + permissions of an existing role. The name is
 * NEVER updatable here — see SYSTEM_ROLE_NAMES rationale above. If a
 * user truly needs to rename a role, the workflow is: create new role →
 * reassign users → delete old role.
 */
export async function updateRole(
  roleId: string,
  input: z.infer<typeof RoleUpdateSchema>,
) {
  await requireAdmin();

  const parsed = RoleUpdateSchema.parse(input);

  // Verify role exists before update so we get a friendly error instead
  // of Prisma's record-not-found stack trace.
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new Error('not-found');

  await prisma.role.update({
    where: { id: roleId },
    data: {
      description: parsed.description ?? null,
      permissions: parsed.permissions,
    },
  });

  revalidatePath('/admin/roles');
}

/**
 * Delete a role. Two safety guards:
 *   1) System roles (admin, airline-admin, instructor, pilot) cannot be
 *      deleted — they're referenced by name in code.
 *   2) Roles with assigned users cannot be deleted — would orphan the
 *      users' role pointer (or worse, FK-fail at the DB level).
 *
 * The UI should disable the delete button when either guard would
 * trigger, but the server-action checks again because guards-on-the-
 * server are the only ones that matter for security.
 */
export async function deleteRole(roleId: string) {
  await requireAdmin();

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw new Error('not-found');

  if (SYSTEM_ROLE_NAMES.includes(role.name)) {
    throw new Error(
      `System-Rolle "${role.name}" kann nicht gelöscht werden (im Code referenziert)`,
    );
  }

  if (role._count.users > 0) {
    throw new Error(
      `Rolle "${role.name}" hat noch ${role._count.users} zugewiesene User. ` +
        `Erst andere Rolle zuweisen bevor löschen.`,
    );
  }

  await prisma.role.delete({ where: { id: roleId } });
  revalidatePath('/admin/roles');
}
