import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

/**
 * Track 4 #101 (Section T) — Admin-Audit-Log helper.
 *
 * # Usage
 *
 * Wird von admin-actions aufgerufen NACHDEM die mutation erfolgreich war.
 * Append-only — never updates oder deletes audit-records.
 *
 * @example
 *   import { logAdminAction } from "@vam/db";
 *
 *   await prisma.user.update({ where: { id }, data: { roleId: newRoleId } });
 *   await logAdminAction({
 *     actorId: admin.id,
 *     action: "user.role.changed",
 *     targetType: "User",
 *     targetId: id,
 *     metadata: { from: oldRoleName, to: newRoleName },
 *   });
 *
 * # Error-handling
 *
 * Logging-failures werden GESWALLOWED (try/catch + console.error). Wir
 * wollen nie dass ein audit-log-fehler eine erfolgreiche admin-action
 * dem user als "failed" anzeigt. Falls audit-log konsistent failed (z.B.
 * disk-full), wird das via /admin/status sichtbar (db-health-check) oder
 * via /admin/audit (last-entry timestamp older als erwartet).
 *
 * # Action-naming-konvention
 *
 * `noun.verb[.qualifier]` dot-separated lowercase:
 *   user.role.changed
 *   user.employment.suspended
 *   event.published
 *   event.cancelled
 *   award.granted
 *   award.revoked
 *   pirep.approved
 *   pirep.rejected
 *   template.deleted
 *
 * Neue actions können frei hinzugefügt werden — kein enum-update nötig.
 */
export async function logAdminAction(input: {
  actorId: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    // Swallow — don't fail the parent action because of audit-log-issues.
    // Surface via stderr so dev/ops sehen es ggf. in logs.
    // eslint-disable-next-line no-console
    console.error("[audit] logAdminAction failed:", err);
  }
}

/**
 * Read-side helper für /admin/audit listing-page. Returns chronological
 * audit entries (desc) mit pagination via cursor.
 */
export async function listAuditEntries(options: {
  limit?: number;
  beforeId?: string | null;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
}) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  const where: Prisma.AdminAuditLogWhereInput = {};
  if (options.actorId) where.actorId = options.actorId;
  if (options.targetType) where.targetType = options.targetType;
  if (options.targetId) where.targetId = options.targetId;

  const entries = await prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(options.beforeId ? { cursor: { id: options.beforeId }, skip: 1 } : {}),
    include: {
      actor: { select: { id: true, name: true, image: true } },
    },
  });

  const hasMore = entries.length > limit;
  return {
    entries: entries.slice(0, limit),
    hasMore,
    nextCursor: hasMore ? entries[limit - 1]?.id ?? null : null,
  };
}

/**
 * Count entries — used for header-badge "23 audit-actions today".
 */
export async function countAuditEntriesSince(since: Date): Promise<number> {
  return prisma.adminAuditLog.count({
    where: { createdAt: { gte: since } },
  });
}
