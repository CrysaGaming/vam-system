'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Roles allowed to manage an airline. Mirrors the Sidebar-gating in
 * components/AppShell.tsx (Airline-Admin-sektor) — diese drei rollen
 * sehen den Sidebar-link UND dürfen die actions ausführen. Wenn diese
 * liste hier aus dem sidebar-gating divergiert wird, sehen User links
 * im Sidebar die zu errors auf der page führen.
 *
 * - admin: System-admin, hat überall zugriff.
 * - airline-admin: Airline-spezifischer admin (von 2026-05-02 commit
 *   a2dxxxx neu eingeführt). Verwaltet die ihm zugewiesene airline.
 * - instructor: Trainer-rolle, hat lt. Kevin's design auch zugriff zur
 *   airline-verwaltung (kann new members onboarden + roles assignen).
 */
const AIRLINE_MANAGER_ROLES = ['admin', 'airline-admin', 'instructor'];

/**
 * Airline-management gate scoped to a specific airline. Returns the user
 * along with their airlineId so callers don't need a second query.
 * Throws on any of: no session, role not in AIRLINE_MANAGER_ROLES, no
 * airline assignment.
 *
 * Name behält die alte semantik (`requireAirlineAdmin`) für minimal-
 * invasive änderung — alle existing callers funktionieren ohne refactor.
 * Das "scoped to airline" matters: ein global-admin ohne airline-zuordnung
 * hat hier nichts zu verwalten — der panel ist airline-internal.
 */
async function requireAirlineAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || !AIRLINE_MANAGER_ROLES.includes(user.role.name)) {
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
  rankId: string | null;
  rankName: string | null;
  totalFlightHours: number;
  totalFlights: number;
  /**
   * Wann der user der airline beigetreten ist. Kommt aus
   * User.joinedAirlineAt (seit migration 20260502161030). Für legacy-
   * users die vor der migration registriert wurden ist das null —
   * die UI zeigt dann createdAt als fallback (mit subtle marker).
   */
  joinedAirlineAt: Date | null;
  /**
   * Fallback-feld für joinedAirlineAt — wird immer gesetzt (User row
   * hat default(now())). Damit kann die UI immer ein "Beigetreten"-
   * datum anzeigen, auch für legacy-users.
   */
  createdAt: Date;
};

export type AirlineSettings = {
  id: string;
  icao: string;
  iata: string | null;
  name: string;
  callsign: string | null;
  logoUrl: string | null;
  // Welle 8 branding fields (8A-2)
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  publicVisible: boolean;
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
    rankId: u.rankId,
    rankName: u.rank?.name ?? null,
    totalFlightHours: u.totalFlightHours,
    totalFlights: u.totalFlights,
    joinedAirlineAt: u.joinedAirlineAt,
    createdAt: u.createdAt,
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

/**
 * All ranks der eigenen airline für den Rang-dropdown. Ranks sind
 * airline-spezifisch (jede airline hat ihre eigene rank-hierarchie),
 * also scoped wir hart auf die airlineId des actors. Sortiert nach
 * order — Trainee (order=0) steht oben, Captain (order=high) unten.
 *
 * Note: rang-zuweisung ist normalerweise auto-promotion via flugstunden
 * (siehe rank.minFlightHours). Diese manuelle assignment-action ist
 * für edge-cases: ehemaliger pilot der schon 500h in einer anderen
 * airline hat, oder admin der einen rank zurücksetzen will.
 */
export async function listAvailableRanks() {
  const { airlineId } = await requireAirlineAdmin();
  return prisma.rank.findMany({
    where: { airlineId },
    select: { id: true, name: true, minFlightHours: true, order: true },
    orderBy: { order: 'asc' },
  });
}

const AssignRoleSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().nullable(),
});

/**
 * Assign (or unassign with null) a role to a member. Three safety guards:
 *   1) Target user must be a member of the admin's airline — prevents
 *      a malicious admin from elevating users in other airlines.
 *   2) Cannot demote the last admin of the airline — would lock out
 *      the airline from any future role-changes. The admin must
 *      explicitly promote a successor first.
 *   3) Privilege-escalation guard: nur system-admins (role.name='admin')
 *      dürfen die admin-rolle zuweisen. Sonst könnten airline-admin
 *      oder instructor (die seit 2026-05-02 auch durch requireAirlineAdmin
 *      kommen) sich selbst oder andere zum global-admin promoten.
 */
export async function assignRoleToMember(
  input: z.infer<typeof AssignRoleSchema>,
) {
  const { airlineId, user: actingAdmin } = await requireAirlineAdmin();
  const parsed = AssignRoleSchema.parse(input);

  // Resolve newRole once — used by both privilege-escalation guard und
  // last-admin protection unten. Saves eine DB-roundtrip wenn beide
  // checks zutreffen würden.
  const newRole = parsed.roleId
    ? await prisma.role.findUnique({ where: { id: parsed.roleId } })
    : null;

  // Privilege-escalation guard. airline-admin/instructor dürfen alle
  // anderen rollen zuweisen, aber nicht 'admin' — sonst escalation-vector.
  // Nur ein bestehender admin darf admin-rolle vergeben.
  if (newRole?.name === 'admin' && actingAdmin.role?.name !== 'admin') {
    throw new Error(
      'Nur System-Admins dürfen die Rolle "admin" zuweisen.',
    );
  }

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

const AssignRankSchema = z.object({
  userId: z.string().min(1),
  rankId: z.string().nullable(),
});

/**
 * Assign (or unassign with null) a rank to a member. Two safety guards:
 *   1) Target user muss member der actor-airline sein.
 *   2) Target rank (wenn nicht null) muss eine rank derselben airline
 *      sein — sonst könnte ein actor versehentlich (oder absichtlich)
 *      einen rank einer ANDEREN airline zuweisen, was die rank-anzeige
 *      völlig zerschießt (z.B. "First Officer" der DLH bei einem
 *      Leav-pilot).
 *
 * Anders als role-zuweisung gibt es hier KEINE last-admin-protection
 * (rank ist nicht security-relevant) und KEINE privilege-escalation
 * (alle ranks sind gleich-mächtig — sie unterscheiden sich nur in
 * minFlightHours-threshold).
 *
 * Side-effect: das überschreibt die auto-promotion-logik. Wenn der
 * admin manuell einen niedrigeren rank zuweist, wird der user beim
 * nächsten flight wieder hochgepromotet wenn er die flight-hours-
 * threshold übersteigt. Das ist intentional — manuelle zuweisung
 * ist eine korrektur, kein hard-cap.
 */
export async function assignRankToMember(
  input: z.infer<typeof AssignRankSchema>,
) {
  const { airlineId, user: actingAdmin } = await requireAirlineAdmin();
  const parsed = AssignRankSchema.parse(input);

  // Target-user muss in derselben airline sein
  const target = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, name: true, airlineId: true },
  });
  if (!target || target.airlineId !== airlineId) {
    throw new Error('forbidden');
  }

  // Target-rank muss in derselben airline sein (wenn gesetzt)
  if (parsed.rankId) {
    const rank = await prisma.rank.findUnique({
      where: { id: parsed.rankId },
      select: { airlineId: true },
    });
    if (!rank || rank.airlineId !== airlineId) {
      throw new Error('Rang gehört nicht zu dieser Airline');
    }
  }

  await prisma.user.update({
    where: { id: parsed.userId },
    data: { rankId: parsed.rankId },
  });

  console.log(
    `[airline-admin] ${actingAdmin.name} assigned rank ${parsed.rankId} ` +
      `to ${target.name} in airline ${airlineId}`,
  );

  revalidatePath('/airline');
  revalidatePath('/pilots');
  revalidatePath('/dashboard'); // Rang-progress-bar
}

const RemoveMemberSchema = z.object({
  userId: z.string().min(1),
});

/**
 * Member aus airline entfernen. Setzt airlineId/rankId/roleId/
 * joinedAirlineAt alle auf null. Der user-account selbst bleibt
 * bestehen — nur die airline-membership wird aufgelöst.
 *
 * Safety guards:
 *   1) Target user muss member der actor-airline sein.
 *   2) Letzten admin der airline kann man nicht entfernen — sonst
 *      ist die airline ohne admin und keiner kann mehr role-changes
 *      machen. Analog zu assignRoleToMember last-admin-protection,
 *      nur dass hier "entfernen" auch demote-zu-non-admin bedeutet.
 *   3) Self-removal (actor entfernt sich selbst) ist erlaubt SOFERN
 *      es noch andere admins gibt. Sinnvoll: airline-admin der seine
 *      rolle aufgibt.
 *
 * Side-effects auf zugehörige daten:
 *   - PIREPs des users bleiben (history-erhaltung). PIREP.userId bleibt
 *     gesetzt aber der user hat keine airlineId mehr — die PIREPs
 *     zeigen weiter im /admin/stats der airline weil dort by airlineId
 *     gefiltert wird, nicht by user.airlineId.
 *   - Bookings: bleiben auch bestehen mit ihrer airlineId. Wenn der
 *     user später in eine andere airline kommt, sieht er seine alten
 *     bookings nicht mehr in /bookings (das filtert auf user.airlineId).
 *   - Aircraft: airframes haben keine direkte user-FK, nichts zu tun.
 */
export async function removeMemberFromAirline(
  input: z.infer<typeof RemoveMemberSchema>,
) {
  const { airlineId, user: actingAdmin } = await requireAirlineAdmin();
  const parsed = RemoveMemberSchema.parse(input);

  const target = await prisma.user.findUnique({
    where: { id: parsed.userId },
    include: { role: true },
  });
  if (!target || target.airlineId !== airlineId) {
    throw new Error('forbidden');
  }

  // Last-admin-protection. Wenn target ein admin ist, prüfe ob es
  // noch andere admins gibt.
  if (target.role?.name === 'admin') {
    const otherAdmins = await prisma.user.count({
      where: {
        airlineId,
        NOT: { id: target.id },
        role: { name: 'admin' },
      },
    });
    if (otherAdmins === 0) {
      throw new Error(
        'Letzten Admin der Airline kann man nicht entfernen. ' +
          'Erst einen anderen User zum Admin machen.',
      );
    }
  }

  await prisma.user.update({
    where: { id: parsed.userId },
    data: {
      airlineId: null,
      rankId: null,
      roleId: null,
      joinedAirlineAt: null,
    },
  });

  console.log(
    `[airline-admin] ${actingAdmin.name} removed ${target.name} ` +
      `from airline ${airlineId}`,
  );

  revalidatePath('/airline');
  revalidatePath('/pilots');
  revalidatePath('/admin/pilots');
}

const BulkAssignRoleSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
  roleId: z.string().nullable(),
});

/**
 * Bulk-rolle-zuweisung an mehrere members. Wird die existing-action
 * `assignRoleToMember` PRO USER aufgerufen — damit erbt jeder einzelne
 * user-update alle safety-guards (privilege-escalation, last-admin,
 * scope) ohne dass wir die logik duplizieren müssen.
 *
 * Errors-strategy: collect, nicht fail-fast. Wenn 5 von 10 users
 * einen guard auslösen (z.B. der eine letzte admin), werden die anderen
 * 5 trotzdem updated. Result enthält pro user den status. UI zeigt
 * dann eine summary "8 erfolgreich, 2 fehlgeschlagen mit gründen".
 *
 * Performance: das ist N+1 queries (pro user mehrere DB-roundtrips).
 * Bei den 1-50 users die hier realistisch durchlaufen, irrelevant.
 * Wenn die airlines mal 1000+ members haben, kann man auf einen
 * batched-transaction-pattern umstellen — aber dann brauchen wir
 * auch eine andere safety-guard-strategie (transaktionsweite checks
 * statt per-user-checks).
 */
export async function bulkAssignRoleToMembers(
  input: z.infer<typeof BulkAssignRoleSchema>,
) {
  const parsed = BulkAssignRoleSchema.parse(input);

  // Per-user durchlaufen. assignRoleToMember enthält alle guards,
  // also kein code-duplication hier nötig. Wir fangen errors per-user
  // ab damit ein user-fehler nicht den ganzen batch killt.
  const results = await Promise.allSettled(
    parsed.userIds.map((userId) =>
      assignRoleToMember({ userId, roleId: parsed.roleId }),
    ),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => ({ userId: parsed.userIds[i], result: r }))
    .filter(
      (
        x,
      ): x is { userId: string; result: PromiseRejectedResult } =>
        x.result.status === 'rejected',
    )
    .map((x) => ({
      userId: x.userId,
      error:
        x.result.reason instanceof Error
          ? x.result.reason.message
          : String(x.result.reason),
    }));

  // assignRoleToMember already calls revalidatePath internally per
  // call, but call once more to be sure the bulk-state is fresh.
  revalidatePath('/airline');

  return { succeeded, failed };
}

const BulkRemoveSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * Bulk-entfernen. Analog zu bulkAssignRoleToMembers — wir delegieren
 * an `removeMemberFromAirline` pro user, fangen errors ab, returnen
 * eine summary. Dasselbe N+1-pattern und dieselben performance-tradeoffs.
 *
 * Ein wichtiger semantik-unterschied: wenn ALLE admins der airline im
 * batch sind, scheitert irgendein user (der "letzte" der zufällig
 * zuletzt durchläuft) — die ordering ist deterministisch durch das
 * input-array, aber die ergebnis-reihenfolge ist promise-completion-
 * order. Praktisch: erste N-1 admins werden entfernt, der letzte fällt
 * raus mit error. Das ist der intended behavior — die airline behält
 * mindestens einen admin.
 */
export async function bulkRemoveMembersFromAirline(
  input: z.infer<typeof BulkRemoveSchema>,
) {
  const parsed = BulkRemoveSchema.parse(input);

  const results = await Promise.allSettled(
    parsed.userIds.map((userId) => removeMemberFromAirline({ userId })),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => ({ userId: parsed.userIds[i], result: r }))
    .filter(
      (
        x,
      ): x is { userId: string; result: PromiseRejectedResult } =>
        x.result.status === 'rejected',
    )
    .map((x) => ({
      userId: x.userId,
      error:
        x.result.reason instanceof Error
          ? x.result.reason.message
          : String(x.result.reason),
    }));

  revalidatePath('/airline');
  revalidatePath('/pilots');
  revalidatePath('/admin/pilots');

  return { succeeded, failed };
}

const AirlineSettingsSchema = z.object({
  name: z.string().min(2).max(80),
  icao: z
    .string()
    .min(3)
    .max(4)
    .regex(/^[A-Z]{3,4}$/, 'ICAO muss 3-4 Großbuchstaben sein (A-Z)'),
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
  // Welle 8 branding fields. All optional — admin can leave empty.
  tagline: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  websiteUrl: z.string().url().max(500).optional().nullable(),
  // Hex-color regex: #RRGGBB only (no shorthand like #FFF, no alpha,
  // no rgb()). Keeps the rendering layer simple — both Tailwind's
  // arbitrary-value syntax `bg-[#RRGGBB]` and inline `style={{}}`
  // work directly with this format.
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Format: #RRGGBB')
    .optional()
    .nullable(),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Format: #RRGGBB')
    .optional()
    .nullable(),
  publicVisible: z.boolean(),
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
    tagline: a.tagline,
    description: a.description,
    websiteUrl: a.websiteUrl,
    primaryColor: a.primaryColor,
    secondaryColor: a.secondaryColor,
    publicVisible: a.publicVisible,
  };
}

/**
 * Update airline metadata including ICAO. Although ICAO is the human-
 * readable identifier shown across the UI (dashboard, bookings, ATC
 * communication), it is NOT used as a foreign key — all relations to
 * Airline go through `airlineId` (cuid). So renaming ICAO is safe at
 * the DB-level: aircraft, routes, bookings, members all keep their
 * airlineId reference and just see the new ICAO on next read.
 *
 * The `@unique` constraint is preserved by the DB itself; we catch
 * the Prisma P2002 error and return a friendly message instead of
 * letting it bubble as "Unbekannter Fehler".
 *
 * Note: external systems (VATSIM/IVAO callsigns, SimBrief OFP, ATIS
 * lookups) reference ICAO as text — those will see the new code on
 * the next flight. There's no migration needed because ICAO isn't
 * persisted as historical data anywhere; PIREPs reference airlineId,
 * not ICAO.
 */
export async function updateAirlineSettings(
  input: z.infer<typeof AirlineSettingsSchema>,
) {
  const { airlineId } = await requireAirlineAdmin();
  const parsed = AirlineSettingsSchema.parse(input);

  const newIcao = parsed.icao.trim().toUpperCase();

  try {
    await prisma.airline.update({
      where: { id: airlineId },
      data: {
        name: parsed.name,
        icao: newIcao,
        callsign: parsed.callsign?.trim().toUpperCase() || null,
        iata: parsed.iata?.trim().toUpperCase() || null,
        logoUrl: parsed.logoUrl?.trim() || null,
        tagline: parsed.tagline?.trim() || null,
        description: parsed.description?.trim() || null,
        websiteUrl: parsed.websiteUrl?.trim() || null,
        // Hex normalization: store always as uppercase #RRGGBB so the
        // public-page renderer doesn't need to lower/upper-case at read
        // time.
        primaryColor: parsed.primaryColor?.toUpperCase() || null,
        secondaryColor: parsed.secondaryColor?.toUpperCase() || null,
        publicVisible: parsed.publicVisible,
      },
    });
  } catch (e: unknown) {
    // Prisma unique-constraint violation. The error code P2002 is the
    // only one we expect here since (name, callsign, logoUrl) have no
    // unique constraints — only icao and iata do. We don't differentiate
    // which field collided because the user can see it in the form.
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: string }).code === 'P2002'
    ) {
      const target = (e as { meta?: { target?: string[] } }).meta?.target ?? [];
      const field = target.includes('icao')
        ? 'ICAO'
        : target.includes('iata')
          ? 'IATA'
          : 'Code';
      throw new Error(
        `${field} ist bereits von einer anderen Airline vergeben`,
      );
    }
    throw e;
  }

  revalidatePath('/airline');
  revalidatePath('/dashboard');
  revalidatePath('/'); // header shows ICAO too
  // Welle 8 public pages. revalidatePath uses the OLD icao if it changed
  // — we accept a one-render staleness on the new path because we don't
  // know the previous value here without an extra query. The directory
  // page covers the visibility toggle anyway.
  revalidatePath(`/a/${newIcao}`);
  revalidatePath('/airlines');
}
