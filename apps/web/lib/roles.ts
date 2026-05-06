/**
 * Zentrale role-konstanten + auth-gates die in mehreren files verwendet
 * werden. Liegt bewusst NICHT in einem `'use server'`-modul (actions.ts)
 * weil Next.js dort nur async-functions als exports erlaubt — eine const
 * hier würde den build crashen. Async-functions hier sind OK weil dies
 * KEIN 'use server'-modul ist — die helpers werden von actions.ts files
 * importiert, dort gilt die server-action-restriction nicht für imports.
 */

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { redirect } from 'next/navigation';

/**
 * Rollen die PIREPs approven/rejecten dürfen.
 *
 * Wird verwendet in:
 *   - apps/web/app/pireps/actions.ts assertCanApprove() — server-side guard
 *   - apps/web/app/pireps/pending/page.tsx — page-level gate
 *   - apps/web/app/pireps/[id]/page.tsx — approver-button-rendering
 *   - apps/web/app/layout.tsx — isApprover-flag für Sidebar-rendering
 *
 * airline-admin ist seit 2026-05-02 dabei: die rolle hat 'pirep:review'
 * in ihren seed-permissions, aber das wurde nie ge-enforced (gating ist
 * string-name-checks). Heute hier nachgezogen damit die seed-deklaration
 * tatsächlich was bedeutet.
 */
export const APPROVER_ROLES = ['admin', 'airline-admin', 'instructor'] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export function isApproverRole(roleName: string | null | undefined): boolean {
  return roleName !== null && roleName !== undefined && APPROVER_ROLES.includes(roleName as ApproverRole);
}

// ─────────────────────────────────────────────────────────────────────
// Auth-gates für admin-routes
// ─────────────────────────────────────────────────────────────────────
//
// Track 3 #11.2.5 M2: Konsolidiert die ~10 file-lokalen requireAdmin /
// requireSystemAdmin / requireAirlineAdmin duplikate in /admin/*/actions.ts
// + verwandte files. Verhalten ist semantic-equivalent zu den lokalen
// helpers — nur der string-check `role.name === 'admin'` wird zentral.
//
// Eine echte semantic-migration auf hasPermission(ctx, PERMISSIONS.X)
// folgt in einem separaten ticket weil pro file/domain entschieden werden
// muss welche permission den gate ersetzt (admin-only? domain-specific?).
// Diese konsolidierung ist die zwischenstufe: alle gates an EINEM ort,
// later refactor an dieser stelle alleine möglich.

/**
 * Server-action gate: throws wenn nicht authentifiziert oder nicht admin.
 * Returnt das authentifizierte admin-user-record (mit role).
 *
 * Wirft `Error('unauthorized')` wenn keine session, `Error('forbidden')`
 * wenn role.name !== 'admin'. Diese werden von Next.js als action-error
 * gerendert — kein silent fail.
 *
 * Verwendung: nur in server-actions (`'use server'`-files). Pages sollten
 * `requireAdminPage()` nutzen weil das redirect statt throw ist (besseres
 * UX für direkte URL-aufrufe vs. server-action-fail).
 *
 * @example
 *   'use server';
 *   import { requireAdmin } from '@/lib/roles';
 *
 *   export async function deleteAward(id: string) {
 *     const admin = await requireAdmin();
 *     // ... admin.id für audit-trail-zwecke
 *   }
 *
 * @returns User-record mit id und role (für audit-trail).
 */
export async function requireAdmin() {
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

/**
 * Page-gate: redirected wenn nicht authentifiziert oder nicht admin.
 * Returnt das authentifizierte admin-user-record (mit role).
 *
 * Spiegelt `requireAdmin()` für server-components, aber redirect statt
 * throw weil pages müssen unter normalen umständen rendern — ein 500-error
 * wäre schlechtes UX. Default-redirect zu `/dashboard` (das hat eigene
 * auth-fallbacks), customizable über `redirectTo`.
 *
 * Verwendung: in admin-page.tsx server-components am anfang.
 *
 * @example
 *   import { requireAdminPage } from '@/lib/roles';
 *
 *   export default async function AdminAwardsPage() {
 *     const user = await requireAdminPage();
 *     // ... render admin UI
 *   }
 */
export async function requireAdminPage(redirectTo: string = '/dashboard') {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    redirect(redirectTo);
  }
  return user;
}

/**
 * Server-action gate: throws wenn nicht authentifiziert, nicht admin,
 * oder nicht einer airline zugeordnet. Returnt `{ user, airlineId }`.
 *
 * Verwendet wenn eine action ZUSÄTZLICH zur admin-rolle eine airline-
 * membership erfordert. Beispiele: airport-/aircraft-type-requests
 * (werden im namen einer airline submitted) und airline-invites
 * (admin verwaltet invites SEINER airline).
 *
 * Hinweis: Trotz historischem namen `requireAirlineAdmin` in den lokalen
 * duplikaten checkt diese gate `role.name === 'admin'`, NICHT
 * `'airline-admin'`. Der zentrale name `requireAdminWithAirline` ist
 * klarer — das hier ist "system-admin der einer airline angehört".
 *
 * Wirft `Error('unauthorized')`, `Error('forbidden')`, oder
 * `Error('no-airline')` je nach grund.
 *
 * @returns `{ user, airlineId }` — destructure am call-site.
 */
export async function requireAdminWithAirline() {
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

/**
 * Page-gate: redirected wenn nicht authentifiziert, nicht admin, oder
 * nicht einer airline zugeordnet. Returnt das user-record INKLUSIVE
 * airline (non-nullable typed).
 *
 * Page-pendant zu `requireAdminWithAirline()`. Für admin-pages die
 * den airline-context fürs rendering brauchen (z.B. catalog-request-
 * pages die im namen der user-airline submitten). Default-redirect
 * `/dashboard`, customizable.
 *
 * @returns user mit garantiert non-null `user.airline` + `user.role`.
 */
export async function requireAdminWithAirlinePage(redirectTo: string = '/dashboard') {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    redirect(redirectTo);
  }
  if (!user.airline) {
    redirect(redirectTo);
  }
  return user as typeof user & {
    role: NonNullable<typeof user.role>;
    airline: NonNullable<typeof user.airline>;
    airlineId: string;
  };
}
// ─────────────────────────────────────────────────────────────────────
// Airline-Manager-gates (admin | airline-admin | instructor)
// ─────────────────────────────────────────────────────────────────────
//
// Track 3 #11.2.5 M2: zentralisiert das pattern
//   `AIRLINE_MANAGER_ROLES.includes(user.role.name)` und das lokale
//   `allowedRoles.includes(user.role.name)` (semantic-identisch) das in
//   ~25 /airline/*/* files dupliziert ist.
//
// "Airline-Manager" = jemand der die airline operativ verwaltet:
//   - admin: system-admin (full access)
//   - airline-admin: airline-spezifischer admin
//   - instructor: PIREP-reviewer + pilot-coaching
// pilot-only-rolle ist explizit AUSGESCHLOSSEN von airline-management.

/**
 * Rollen die airline-management-aktionen ausführen dürfen (settings,
 * member, fleet, ranks, routes, schedule, aircraft, etc.). Bewusst
 * INKLUSIVE instructor — instructors haben write-access auf airline-
 * member-records (rank-promotions, license-vergabe, type-rating-test).
 *
 * Synchron mit der historischen `AIRLINE_MANAGER_ROLES`-konstante in
 * mehreren files + dem `allowedRoles`-pattern. Single-source-of-truth.
 */
export const AIRLINE_MANAGER_ROLES = ['admin', 'airline-admin', 'instructor'] as const;
export type AirlineManagerRole = (typeof AIRLINE_MANAGER_ROLES)[number];

export function isAirlineManagerRole(roleName: string | null | undefined): boolean {
  return roleName !== null && roleName !== undefined && AIRLINE_MANAGER_ROLES.includes(roleName as AirlineManagerRole);
}

/**
 * Server-action gate: throws wenn nicht authentifiziert oder kein
 * airline-manager. Returnt das authentifizierte user-record (mit role).
 *
 * Wirft `Error('unauthorized')` wenn keine session, `Error('forbidden')`
 * wenn role-name NICHT in AIRLINE_MANAGER_ROLES.
 *
 * NICHT für actions die ZUSÄTZLICH eine airline-membership erfordern
 * — dafür `requireAirlineManagerWithAirline()` nutzen (returnt airlineId).
 */
export async function requireAirlineManager() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || !isAirlineManagerRole(user.role.name)) {
    throw new Error('forbidden');
  }
  return user;
}

/**
 * Page-gate: redirected wenn nicht authentifiziert oder kein airline-
 * manager. Returnt das authentifizierte user-record (mit role + airline).
 *
 * Spiegelt `requireAirlineManager()` für server-components, redirect
 * statt throw. Default-redirect zu `/dashboard`. Inkludiert das
 * airline-record by default weil airline-pages das fast immer brauchen
 * (page-header, scope-checks). Wenn nicht gewünscht, einfach ignorieren
 * — TypeScript zwingt nichts ab.
 */
export async function requireAirlineManagerPage(redirectTo: string = '/dashboard') {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });

  if (!user?.role || !isAirlineManagerRole(user.role.name)) {
    redirect(redirectTo);
  }
  return user;
}

/**
 * Server-action gate: throws wenn nicht authentifiziert, kein airline-
 * manager, oder nicht einer airline zugeordnet. Returnt
 * `{ user, airlineId }`.
 *
 * Verwendet wenn eine airline-management-action zwingend einen
 * airlineId-context braucht (member-CRUD, fleet-CRUD, route-CRUD, etc.).
 * Das ist 95% aller `/airline/<route>/actions.ts`-files.
 *
 * Wirft `Error('unauthorized')`, `Error('forbidden')`, oder
 * `Error('no-airline')` je nach grund.
 *
 * @returns `{ user, airlineId }` — destructure am call-site.
 */
export async function requireAirlineManagerWithAirline() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || !isAirlineManagerRole(user.role.name)) {
    throw new Error('forbidden');
  }
  if (!user.airlineId) {
    throw new Error('no-airline');
  }

  return { user, airlineId: user.airlineId };
}

/**
 * Page-gate: redirected wenn nicht authentifiziert, kein airline-
 * manager, oder nicht einer airline zugeordnet. Returnt das user-record
 * INKLUSIVE airline (non-nullable typed).
 *
 * Verwendet in /airline/*-pages die einen airline-context brauchen für
 * page-header, links, scope-checks. Default-redirect zu `/dashboard`.
 *
 * @returns `user` mit garantiert non-null `user.airline` + `user.role`.
 */
export async function requireAirlineManagerWithAirlinePage(redirectTo: string = '/dashboard') {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });

  if (!user?.role || !isAirlineManagerRole(user.role.name)) {
    redirect(redirectTo);
  }
  if (!user.airline) {
    redirect(redirectTo);
  }
  return user as typeof user & {
    role: NonNullable<typeof user.role>;
    airline: NonNullable<typeof user.airline>;
    airlineId: string;
  };
}