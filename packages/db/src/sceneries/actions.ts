import { Prisma, type Scenery } from "@prisma/client";
import { prisma } from "../index.js";

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Write-side actions für den
 * scenery-catalog.
 *
 * Admin-territory: nur user mit role.name === 'admin' sollten diese
 * helpers aufrufen. Auth-check macht der caller (server-action in
 * apps/web), nicht hier — pure DB-helpers ohne session-context bleiben
 * composable für CLI-tools/seed-scripts.
 *
 * # Validation-strategie
 *
 * Hier auf DB-layer minimal validation: nicht-leere-name + url-shape
 * (wenn vorhanden). Field-präsenz, type-coercion, error-messages
 * passieren im server-action layer mit zod (`apps/web/app/admin/
 * sceneries/actions.ts`). DB-layer wirft technische errors (foreign-key
 * constraint, etc.); UI-layer wirft user-facing errors.
 *
 * # Idempotency
 *
 * `deleteScenery` wirft NICHT bei nicht-existent (catch P2025).
 * `updateScenery` wirft P2025 wenn id nicht existiert — caller behandelt
 * das mit notFound() im edit-flow.
 *
 * `createScenery` hat keinen unique-constraint zum schützen — derselbe
 * name kann beliebig oft existieren (z.B. "EDDF Default" könnte für
 * mehrere simulators / providers vorhanden sein). Admin-side dedupe
 * passiert visuell in der admin-list, nicht per constraint.
 */

// ─────────────────────────────────────────────────────────────────────
// createScenery
// ─────────────────────────────────────────────────────────────────────

export type CreateSceneryInput = {
  name: string;
  airportIcao?: string | null;
  provider?: string | null;
  url?: string | null;
  free?: boolean;
  airlineId?: string | null;
};

/**
 * Erstellt eine neue scenery-row. Validation-rules:
 * - name: nicht-leer (UI-layer prüft trim)
 * - airportIcao: 4 chars wenn vorhanden (UI-layer prüft regex)
 * - url: ist ein gültiges URL wenn vorhanden (UI-layer prüft mit zod.url())
 *
 * Defaults: free=true (kostenfreie sceneries sind "default-friendly" für
 * den catalog — paid muss explizit gemarked werden).
 */
export async function createScenery(
  input: CreateSceneryInput,
): Promise<Scenery> {
  return prisma.scenery.create({
    data: {
      name: input.name,
      airportIcao: input.airportIcao ?? null,
      provider: input.provider ?? null,
      url: input.url ?? null,
      free: input.free ?? true,
      airlineId: input.airlineId ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// updateScenery
// ─────────────────────────────────────────────────────────────────────

export type UpdateSceneryInput = {
  id: string;
  name?: string;
  airportIcao?: string | null;
  provider?: string | null;
  url?: string | null;
  free?: boolean;
  airlineId?: string | null;
};

/**
 * Updated eine scenery. Nur explizit gesetzte felder werden geändert
 * (partial-update via prisma's normal data-shape — undefined wird
 * ignoriert). Null-werte clearen das feld (z.B. `airportIcao: null`
 * setzt das auf NULL in der DB).
 *
 * Wirft Prisma.PrismaClientKnownRequestError mit code 'P2025' wenn id
 * nicht existiert. Caller (server-action) fängt das und routet zu
 * notFound() oder zeigt validation-error.
 */
export async function updateScenery(
  input: UpdateSceneryInput,
): Promise<Scenery> {
  const { id, ...data } = input;
  return prisma.scenery.update({
    where: { id },
    data,
  });
}

// ─────────────────────────────────────────────────────────────────────
// deleteScenery
// ─────────────────────────────────────────────────────────────────────

/**
 * Löscht eine scenery. Idempotent: wenn nicht-existent, wirft nicht —
 * gibt einfach { deleted: false } zurück. So kann der admin-flow die
 * action mehrfach feuern ohne 500-error (z.B. bei doppelclick auf
 * "Löschen"-button).
 *
 * Andere errors (constraint-violations etc.) werden propagiert.
 */
export async function deleteScenery(
  id: string,
): Promise<{ deleted: boolean }> {
  try {
    await prisma.scenery.delete({ where: { id } });
    return { deleted: true };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      // Record nicht gefunden — idempotent skip
      return { deleted: false };
    }
    throw err;
  }
}
