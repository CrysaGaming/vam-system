'use server';

import {
  prisma,
  createScenery as dbCreateScenery,
  updateScenery as dbUpdateScenery,
  deleteScenery as dbDeleteScenery,
  type CreateSceneryInput,
  type UpdateSceneryInput,
} from '@vam/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/roles';

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Server actions für admin-
 * side scenery-management. CRUD auf Scenery-rows.
 *
 * Auth-pattern: zentralen `requireAdmin()` aus lib/roles. Throws bei
 * non-admin. Track 3 #11.2.5 M2: ehemals lokal dupliziert, jetzt
 * konsolidiert.
 *
 * # Validation
 *
 * Form-validation per zod-schemas. ICAO ist 3-4 chars (3 für ICAOs wie
 * "JFK"... wait, JFK ist eigentlich KJFK. ICAOs sind streng 4 chars.
 * Aber manche sceneries decken regionen ab und haben evtl 3-char-codes
 * oder gar keinen → optional + 4-char-strict-regex wenn gesetzt).
 *
 * URL: zod's url() schema validiert format. Muss http:// oder https://
 * sein — auch sinnvoll für ein store-link. Optional aber wenn gesetzt
 * dann valid.
 *
 * # Trim & null-mapping
 *
 * Whitespace im input wird getrimt. Leere strings werden zu null
 * (semantisch "feld nicht gesetzt"). Das matched DB-layer erwartung
 * (CreateSceneryInput nutzt explizit `string | null` für optionals).
 */

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const SceneryCreateSchema = z.object({
  name: z
    .string()
    .min(2, 'Name muss mindestens 2 Zeichen haben')
    .max(150, 'Name darf höchstens 150 Zeichen haben')
    .trim(),
  airportIcao: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,4}$/, 'ICAO muss 3-4 Zeichen sein (Buchstaben/Ziffern)')
    .optional()
    .or(z.literal('')),
  provider: z.string().max(100).trim().optional().or(z.literal('')),
  url: z
    .string()
    .url('Ungültige URL — muss http:// oder https:// enthalten')
    .max(500)
    .optional()
    .or(z.literal('')),
  free: z.boolean().optional(),
  // airlineId: empty string = "global", sonst muss eine valide id sein.
  // Wir validieren existence im action-body via prisma-lookup damit der
  // schema einfach bleibt.
  airlineId: z.string().optional().or(z.literal('')),
});

const SceneryUpdateSchema = SceneryCreateSchema.extend({
  id: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────
// Action results
// ─────────────────────────────────────────────────────────────────────

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────
// Helper: parse + normalize formdata für create/update
// ─────────────────────────────────────────────────────────────────────

/**
 * Konvertiert FormData-felder in das DB-input-shape. Trim-empty-string
 * → null mapping passiert hier zentral (DRY zwischen create/update).
 *
 * `free`-checkbox: HTML-forms senden "on" wenn checked, sonst nichts.
 * Der schema akzeptiert boolean — wir konvertieren formData.get vor
 * dem parse.
 *
 * `airlineId`: empty/leer-string → null (= globale scenery).
 */
async function normalizeSceneryInput(
  formData: FormData,
): Promise<
  | { ok: true; data: Omit<CreateSceneryInput, 'airlineId'> & { airlineId: string | null } }
  | { ok: false; error: string }
> {
  const raw = {
    name: formData.get('name'),
    airportIcao: formData.get('airportIcao'),
    provider: formData.get('provider'),
    url: formData.get('url'),
    free: formData.get('free') === 'on',
    airlineId: formData.get('airlineId'),
  };

  const parsed = SceneryCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }

  // Airline-id existence-check (wenn nicht-empty). Schützt gegen forged
  // form-submissions mit invalid ids → würde sonst beim prisma-create
  // einen P2003 (foreign-key constraint) werfen, schöneren error hier.
  let airlineId: string | null = null;
  if (parsed.data.airlineId && parsed.data.airlineId.trim() !== '') {
    const airline = await prisma.airline.findUnique({
      where: { id: parsed.data.airlineId },
      select: { id: true },
    });
    if (!airline) {
      return { ok: false, error: 'Airline-id existiert nicht' };
    }
    airlineId = airline.id;
  }

  return {
    ok: true,
    data: {
      name: parsed.data.name,
      airportIcao: parsed.data.airportIcao?.trim() || null,
      provider: parsed.data.provider?.trim() || null,
      url: parsed.data.url?.trim() || null,
      free: parsed.data.free ?? true,
      airlineId,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// createSceneryAction
// ─────────────────────────────────────────────────────────────────────

export async function createSceneryAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const normalized = await normalizeSceneryInput(formData);
    if (!normalized.ok) return normalized;

    const created = await dbCreateScenery(normalized.data);

    revalidatePath('/admin/sceneries');
    revalidatePath('/sceneries');
    return {
      ok: true,
      message: `Scenery "${created.name}" angelegt.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// updateSceneryAction
// ─────────────────────────────────────────────────────────────────────

export async function updateSceneryAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const id = formData.get('id');
    const idParsed = z.string().min(1).safeParse(id);
    if (!idParsed.success) {
      return { ok: false, error: 'ID fehlt oder ungültig' };
    }

    const normalized = await normalizeSceneryInput(formData);
    if (!normalized.ok) return normalized;

    const input: UpdateSceneryInput = {
      id: idParsed.data,
      ...normalized.data,
    };

    await dbUpdateScenery(input);

    revalidatePath('/admin/sceneries');
    revalidatePath(`/admin/sceneries/${idParsed.data}`);
    revalidatePath('/sceneries');
    revalidatePath(`/sceneries/${idParsed.data}`);
    return { ok: true, message: 'Scenery aktualisiert.' };
  } catch (err) {
    // P2025 = record not found
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2025'
    ) {
      return { ok: false, error: 'Scenery existiert nicht (mehr).' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// deleteSceneryAction (redirect-style, kein useFormState)
// ─────────────────────────────────────────────────────────────────────

/**
 * Löscht eine scenery und navigiert zurück zur admin-list. Anders als
 * create/update kein useFormState/ActionResult — delete-from-detail ist
 * ein "fire-and-redirect"-flow, kein "validate-and-show-feedback".
 *
 * Nicht-existent ist idempotent silent (DB-layer return { deleted: false }).
 */
export async function deleteSceneryAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = formData.get('id');
  if (typeof id !== 'string' || !id) {
    throw new Error('ID fehlt');
  }

  await dbDeleteScenery(id);

  revalidatePath('/admin/sceneries');
  revalidatePath('/sceneries');
  redirect('/admin/sceneries');
}
