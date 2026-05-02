/**
 * Zentrale role-konstanten für gates die in mehreren files verwendet
 * werden. Liegt bewusst NICHT in einem `'use server'`-modul (actions.ts)
 * weil Next.js dort nur async-functions als exports erlaubt — eine const
 * hier würde den build crashen.
 *
 * Wenn eine neue role-liste mehrfach verwendet wird, kommt sie hier rein.
 * Aktuell bewusst klein gehalten — wir konsolidieren erst weiter (siehe
 * roadmap #5 permission-system-refactor) wenn die richtung klar ist.
 */

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
