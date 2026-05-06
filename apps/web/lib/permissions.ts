/**
 * Permission-Resolver — Track 3 #11.2.5 Foundation-Slice.
 *
 * Foundation-only: stellt die typed-permission-string-infrastruktur bereit,
 * die langfristig die `role.name === 'admin'`-string-checks in den
 * 25 gegateten Files ablösen wird.
 *
 * # Status & Scope
 *
 * Heute (2026-05-06) sind alle 25 gating-files NAME-basiert
 * (`role.name === 'admin'`, `APPROVER_ROLES.includes(name)`, etc.). Die
 * Schema-spalte `Role.permissions: String[]` wird zwar geseedt aber
 * nirgendwo gelesen. Dieses Modul macht das Lesen+Checken type-safe und
 * drop-in-ready, ohne die bestehenden Gates anzufassen.
 *
 * TODO(11.2.5-permissions-refactor): Die 25 `role.name`-checks per File
 * auf `hasPermission(ctx, ...)` umstellen. Das ist ein eigenes Ticket weil
 * jeder einzelne Gate inhaltlich neu entschieden werden muss
 * (welche Permission deckt welchen Endpoint? was ist mit instructor-vs-
 * admin-grenzgängern?). Dieses Foundation-Modul macht den Refactor
 * mechanisch — semantisch bleibt's eine Per-Gate-Entscheidung.
 *
 * # Design-Entscheidungen
 *
 * - **Wildcard `*`** wird hier explizit unterstützt: das `admin`-role-seed
 *   hat genau dieses pattern. Jeder permission-check returned `true` wenn
 *   der user `*` hat. Das ist konsistent mit dem seed (siehe
 *   `packages/db/prisma/seed.ts` Z.35).
 *
 * - **Permission-Namespaces** spiegeln die im seed verwendeten + die in
 *   `docs/vision/admin-dashboards-vision.md` Section 3.2 vorgeschlagenen.
 *   Neue strings werden hier zentral hinzugefügt — niemals im consumer-
 *   code als bare-string. Der consumer importiert die Konstante.
 *
 * - **Kein RBAC-engine, kein scope-resolver**: airline-scoped permissions
 *   wie `airline.{id}.manage` sind v2-thema (siehe vision-doc Section 3.2
 *   Hierarchical Scope-Pattern). v1 nutzt flache strings; airline-scoping
 *   wird heute noch über die separate airline-zugehörigkeit der user
 *   erzwungen (User.airlineId-checks in den server-actions).
 *
 * # Verwendung (geplant, noch nicht aktiv)
 *
 *   import { hasPermission, PERMISSIONS } from '@/lib/permissions';
 *
 *   const ctx = { permissions: user.role?.permissions ?? [] };
 *   if (!hasPermission(ctx, PERMISSIONS.PIREP_REVIEW)) {
 *     redirect('/dashboard');
 *   }
 */

/**
 * Canonical permission-strings. Diese Konstanten sind die Single-Source-
 * of-Truth — der seed in `packages/db/prisma/seed.ts` muss bei jeder
 * neuen permission gleichzeitig aktualisiert werden, sonst weichen
 * geseedete und referenzierte strings auseinander.
 */
export const PERMISSIONS = {
  /**
   * Wildcard. Ein user mit dieser permission besteht JEDEN
   * permission-check. Für die `admin`-rolle gedacht, sollte sparsam
   * verwendet werden. Pattern stammt aus dem seed (Z.35).
   */
  ALL: '*',

  // ───── Airline-Management ─────
  /** Airline verwalten (members, settings, fleet, ranks, etc.). */
  AIRLINE_MANAGE: 'airline:manage',

  // ───── PIREP-Workflow ─────
  /** PIREP einreichen. */
  PIREP_SUBMIT: 'pirep:submit',
  /** Eigene PIREPs lesen. */
  PIREP_VIEW_OWN: 'pirep:view_own',
  /** PIREPs approve/reject (instructor + admin + airline-admin). */
  PIREP_REVIEW: 'pirep:review',

  // ───── User/Coaching ─────
  /** Pilot coachen (instructor-rolle). */
  USER_COACH: 'user:coach',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Permission-Context. Minimaler shape — enthält nur die permission-strings
 * die ein user durch seine rolle hat. Resolver-functions accepten dies
 * statt einen kompletten User-record damit caller nicht alle felder
 * fetchen müssen wenn sie nur permissions checken wollen.
 */
export interface PermissionContext {
  permissions: readonly string[];
}

/**
 * Baut einen PermissionContext aus einem (potentiell partial gefetchten)
 * user-record. Nullable-graceful: ein user ohne rolle hat einen leeren
 * permissions-array → alle checks failen sauber.
 *
 * Erwartet das shape `user.role?.permissions` — passt zum prisma-include
 * `{ role: { select: { permissions: true } } }`.
 */
export function permissionContextFromUser(
  user: { role: { permissions: readonly string[] } | null } | null | undefined,
): PermissionContext {
  return {
    permissions: user?.role?.permissions ?? [],
  };
}

/**
 * Prüft ob der context die genannte permission hat. Wildcard `*` wins.
 *
 * Akzeptiert auch beliebige strings (nicht nur Permission-typed) damit
 * call-sites die noch nicht migriert sind ad-hoc strings übergeben können
 * — die werden wie jede andere permission verglichen. Für neue
 * call-sites die typed Permission-Konstante verwenden.
 */
export function hasPermission(ctx: PermissionContext, required: Permission | string): boolean {
  if (ctx.permissions.includes(PERMISSIONS.ALL)) return true;
  return ctx.permissions.includes(required);
}

/**
 * Prüft ob der context MINDESTENS EINE der genannten permissions hat.
 * Praktisch für gates die mehrere äquivalente permissions akzeptieren
 * (z.B. "PIREP_REVIEW oder AIRLINE_MANAGE").
 */
export function hasAnyPermission(
  ctx: PermissionContext,
  required: ReadonlyArray<Permission | string>,
): boolean {
  if (ctx.permissions.includes(PERMISSIONS.ALL)) return true;
  return required.some((perm) => ctx.permissions.includes(perm));
}

/**
 * Prüft ob der context ALLE genannten permissions hat. Für strikte gates
 * die mehrere eigenschaften gleichzeitig erfordern.
 */
export function hasAllPermissions(
  ctx: PermissionContext,
  required: ReadonlyArray<Permission | string>,
): boolean {
  if (ctx.permissions.includes(PERMISSIONS.ALL)) return true;
  return required.every((perm) => ctx.permissions.includes(perm));
}
