'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * System-admin gate. Spiegelt `requireAdmin()` in admin/roles/actions.ts —
 * file-private weil zwei copies der gate-funktion einfacher zu reasonen
 * sind als ein shared helper an dem niemand gleichzeitig die signatur
 * ändern darf. Die definition bleibt schmal genug dass der duplicate
 * niedrige kosten hat.
 *
 * Anders als `requireAirlineAdmin` (airline/actions.ts) prüft DIESE
 * gate KEIN airlineId — system-admin agiert cross-airline und braucht
 * keine eigene airline-membership.
 */
async function requireSystemAdmin() {
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

const AdminBulkAssignRoleSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
  roleId: z.string().nullable(),
});

/**
 * Bulk-rolle-zuweisung an mehrere user (cross-airline). Pendant zu
 * `bulkAssignRoleToMembers` in airline/actions.ts, aber:
 *   - System-scope (kein airlineId-restriktion auf actor oder target)
 *   - Eigene safety-guards weil der airline-actor-pfad nicht greift
 *
 * Safety-guards:
 *   1) Self-demotion-protection: wenn der actor selbst in userIds ist
 *      und die neue rolle nicht 'admin' ist, refuse SOFERN actor der
 *      letzte system-admin ist. Sonst kann sich das system in einen
 *      no-admin zustand sperren der nur per DB-direktzugriff repariert
 *      werden kann.
 *   2) Last-admin-pro-airline: wenn target ein airline-admin ist UND
 *      der einzige admin der airline UND die neue rolle nicht 'admin'
 *      ist, refuse für DIESEN target — die airline würde ohne admin-
 *      verwaltung dastehen. Wir prüfen pro target weil cross-airline
 *      bulk mehrere airlines treffen kann.
 *
 * Privilege-escalation ist hier KEINE issue weil der actor selbst
 * schon 'admin' ist (höchste rolle) — er kann jedem die admin-rolle
 * geben. Im member-action-pfad (airline/actions.ts) ist das anders
 * weil airline-admin/instructor diese action auch aufrufen können.
 *
 * Errors-strategy: Promise.allSettled — pro-user collect, nicht fail-
 * fast. Wenn 8 von 10 erfolgreich sind und 2 die last-admin-protection
 * triggern, werden die 8 trotzdem updated. Result enthält per-user
 * status. UI kann dann eine summary zeigen.
 *
 * Performance: N+1 queries (pro user mehrere DB-roundtrips für die
 * pro-airline-checks). Bei den max 50 users pro batch ist das ok.
 * Wenn jemand mal 500 user gleichzeitig bulk-updaten will, muss
 * das per batched-transaction redesigned werden — aber das ist
 * weit weg von realen workflows.
 */
export async function adminBulkAssignRole(
  input: z.infer<typeof AdminBulkAssignRoleSchema>,
) {
  const actingAdmin = await requireSystemAdmin();
  const parsed = AdminBulkAssignRoleSchema.parse(input);

  // Resolve newRole einmal — wird in den per-user-checks wiederverwendet
  const newRole = parsed.roleId
    ? await prisma.role.findUnique({ where: { id: parsed.roleId } })
    : null;

  // Self-demotion-guard. Wenn der actor selbst in userIds ist und nicht
  // mehr admin werden soll, prüfe ob es noch andere system-admins gibt.
  // Das schützt vor "ich demote mich selbst und niemand kann mehr roles
  // verwalten".
  if (parsed.userIds.includes(actingAdmin.id)) {
    const becomingNonAdmin = !newRole || newRole.name !== 'admin';
    if (becomingNonAdmin) {
      const otherSystemAdmins = await prisma.user.count({
        where: {
          NOT: { id: actingAdmin.id },
          role: { name: 'admin' },
        },
      });
      if (otherSystemAdmins === 0) {
        throw new Error(
          'Du kannst dich nicht selbst demoten — du bist der letzte System-Admin.',
        );
      }
    }
  }

  // Per-user durchlaufen mit per-airline last-admin-checks
  const results = await Promise.allSettled(
    parsed.userIds.map(async (userId) => {
      const target = await prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });
      if (!target) throw new Error('User nicht gefunden');

      // Last-admin-pro-airline: wenn target ein admin ist UND in einer
      // airline UND wir machen ihn zum non-admin, prüfe ob die airline
      // noch andere admins hat. (Wenn target in keiner airline ist —
      // airlineId === null — ist das egal, die rolle ist dann nur
      // system-relevant und vom self-demotion-guard oben abgedeckt.)
      if (target.role?.name === 'admin' && target.airlineId) {
        const becomingNonAdmin = !newRole || newRole.name !== 'admin';
        if (becomingNonAdmin) {
          const otherAdmins = await prisma.user.count({
            where: {
              airlineId: target.airlineId,
              NOT: { id: target.id },
              role: { name: 'admin' },
            },
          });
          if (otherAdmins === 0) {
            throw new Error(
              `${target.name ?? 'User'} ist letzter Admin der Airline und kann nicht demotet werden`,
            );
          }
        }
      }

      await prisma.user.update({
        where: { id: userId },
        data: { roleId: parsed.roleId },
      });
    }),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => ({ userId: parsed.userIds[i], result: r }))
    .filter(
      (x): x is { userId: string; result: PromiseRejectedResult } =>
        x.result.status === 'rejected',
    )
    .map((x) => ({
      userId: x.userId,
      error:
        x.result.reason instanceof Error
          ? x.result.reason.message
          : String(x.result.reason),
    }));

  // Audit-log placeholder — wenn invite-tracking-system landet wird hier
  // ein echter eintrag geschrieben. Vorerst nur server-side log.
  console.log(
    `[admin/pilots] ${actingAdmin.name} bulk-assigned role ${parsed.roleId} ` +
      `to ${parsed.userIds.length} users (${succeeded} ok, ${failed.length} failed)`,
  );

  revalidatePath('/admin/pilots');
  revalidatePath('/airline');
  revalidatePath('/pilots');

  return { succeeded, failed };
}

const AdminBulkRemoveFromAirlineSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * Bulk-remove-from-airline: setzt für jeden user airlineId, rankId,
 * roleId und joinedAirlineAt alle auf null. Der user-account selbst
 * bleibt bestehen — nur die airline-membership wird aufgelöst. Das ist
 * exakt der gleiche side-effect wie removeMemberFromAirline in
 * airline/actions.ts, aber cross-airline scoped (system-admin kann
 * users aus jeder airline entfernen).
 *
 * Safety-guards:
 *   1) Skip if !target.airlineId — der user ist schon ohne airline,
 *      no-op statt error
 *   2) Last-admin-pro-airline: wenn target ein admin der airline ist
 *      und der einzige, refuse für DIESEN target. Verhindert dass eine
 *      airline ohne admin-verwaltung zurückbleibt.
 *
 * Side-effects auf zugehörige daten (analog removeMemberFromAirline):
 *   - PIREPs bleiben (history-erhaltung) mit ihrer airlineId, zeigen
 *     weiterhin im /admin/stats der ehemaligen airline
 *   - Bookings bleiben mit ihrer airlineId — der user sieht sie nicht
 *     mehr in /bookings (filter auf user.airlineId)
 *   - Aircraft haben keine direkte user-FK → unaffected
 *
 * Anders als delete-account (welches FK-cascade-design braucht und
 * deshalb explizit AUSGESCHLOSSEN ist von diesem batch) ist remove-
 * from-airline reversibel: der user kann später per invite-flow
 * wieder einer airline (auch der gleichen) hinzugefügt werden.
 */
export async function adminBulkRemoveFromAirline(
  input: z.infer<typeof AdminBulkRemoveFromAirlineSchema>,
) {
  const actingAdmin = await requireSystemAdmin();
  const parsed = AdminBulkRemoveFromAirlineSchema.parse(input);

  const results = await Promise.allSettled(
    parsed.userIds.map(async (userId) => {
      const target = await prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });
      if (!target) throw new Error('User nicht gefunden');
      if (!target.airlineId) {
        throw new Error('User ist keiner Airline zugeordnet');
      }

      // Last-admin-pro-airline-protection
      if (target.role?.name === 'admin') {
        const otherAdmins = await prisma.user.count({
          where: {
            airlineId: target.airlineId,
            NOT: { id: target.id },
            role: { name: 'admin' },
          },
        });
        if (otherAdmins === 0) {
          throw new Error(
            `${target.name ?? 'User'} ist letzter Admin der Airline und kann nicht entfernt werden`,
          );
        }
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          airlineId: null,
          rankId: null,
          roleId: null,
          joinedAirlineAt: null,
        },
      });
    }),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => ({ userId: parsed.userIds[i], result: r }))
    .filter(
      (x): x is { userId: string; result: PromiseRejectedResult } =>
        x.result.status === 'rejected',
    )
    .map((x) => ({
      userId: x.userId,
      error:
        x.result.reason instanceof Error
          ? x.result.reason.message
          : String(x.result.reason),
    }));

  console.log(
    `[admin/pilots] ${actingAdmin.name} bulk-removed ${parsed.userIds.length} users ` +
      `from airlines (${succeeded} ok, ${failed.length} failed)`,
  );

  revalidatePath('/admin/pilots');
  revalidatePath('/airline');
  revalidatePath('/pilots');

  return { succeeded, failed };
}
