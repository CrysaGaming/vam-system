'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import {
  SimBriefOverlaySchema,
  parseSimBriefOverlay,
  type SimBriefOverlay,
} from '@/lib/simbrief/overlay';

/**
 * Generiert einen kryptographisch sicheren Token für OBS-Overlays.
 * Format: 32 Zeichen, hex (16 Bytes Random Entropie).
 */
function generateOverlayToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Holt den OBS-Overlay-Token des aktuellen Users.
 * Generiert einen neuen, falls noch keiner existiert (lazy creation).
 */
export async function getOrCreateOverlayToken(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { overlayToken: true },
  });

  if (!user) {
    throw new Error('User nicht gefunden');
  }

  if (user.overlayToken) {
    return user.overlayToken;
  }

  // Lazy creation: Token erst beim ersten Aufruf generieren
  const newToken = generateOverlayToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { overlayToken: newToken },
  });

  return newToken;
}

/**
 * Rotiert den OBS-Overlay-Token (z.B. wenn er geleakt wurde).
 * Alter Token wird ungültig, neuer wird generiert.
 */
export async function rotateOverlayToken(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const newToken = generateOverlayToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { overlayToken: newToken },
  });

  revalidatePath('/settings');

  return newToken;
}

const SetSimBriefUsernameSchema = z.object({
  username: z.string().nullable(),
});

export async function setSimBriefUsername(
  input: z.infer<typeof SetSimBriefUsernameSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  const parsed = SetSimBriefUsernameSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }

  const raw = parsed.data.username;
  const trimmed = raw === null ? null : raw.trim();
  const normalized =
    trimmed === null || trimmed.length === 0 ? null : trimmed;

  if (normalized !== null) {
    if (normalized.length > 50) {
      return { success: false, error: 'too_long' };
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(normalized)) {
      return { success: false, error: 'invalid_format' };
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { simBriefUsername: normalized },
  });

  revalidatePath('/settings');

  return { success: true };
}

/**
 * Updates the airline-level SimBrief overlay (Ebene 1 in the
 * Override-Hierarchie — see apps/web/lib/simbrief/overlay.ts for the
 * 4-layer resolution model).
 *
 * Authorization (MVP — single-tenant single-user dev): any user with
 * a non-null `airlineId` may write their airline's overlay. This is
 * acceptable while the system has 1 user per airline; once additional
 * users join an airline, this should require an explicit admin role
 * (Airline.ownerId or User.role) so non-admin pilots cannot redefine
 * dispatch policy. Tracked in TOMORROW.md → "Airline roles" follow-up.
 *
 * The submitted JSON is validated against `SimBriefOverlaySchema`
 * (Zod). On parse failure we return the issue list so the UI can
 * highlight which field broke. Empty-string field values are stripped
 * client-side so they don't reach this action — every value here is
 * a real override.
 *
 * Empty overlay (no fields submitted) is persisted as `{}` rather
 * than null. That distinguishes "user explicitly cleared all
 * overrides" from "never configured" — semantically these are the
 * same at dispatch time (parseSimBriefOverlay returns `{}` for null),
 * but a saved-empty row signals user intent in the audit trail.
 */
export async function updateAirlineSimBriefOverlay(
  input: SimBriefOverlay,
): Promise<
  | { success: true }
  | { success: false; error: string; issues?: z.ZodIssue[] }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  // Resolve the user's airline. Non-airline-affiliated users can't
  // edit any airline's overlay (would need admin role for foreign
  // airlines, doesn't apply at MVP).
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!user?.airlineId) {
    return { success: false, error: 'no_airline' };
  }

  const parsed = SimBriefOverlaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'invalid_input',
      issues: parsed.error.issues,
    };
  }

  await prisma.airline.update({
    where: { id: user.airlineId },
    data: { simBriefOverlay: parsed.data },
  });

  // Booking-detail pages render the resolved overlay into Pattern α/Z
  // form-fields, so they cache against the airline-overlay value. A
  // changed overlay must invalidate any rendered booking page.
  revalidatePath('/bookings');
  revalidatePath('/settings');

  return { success: true };
}

/**
 * Reads the current airline-level SimBrief overlay for the
 * authenticated user's airline. Returns `null` if the user has no
 * airline (so the UI can hide the editor entirely), or a
 * SimBriefOverlay (possibly empty `{}`) otherwise.
 *
 * Validates on read via `parseSimBriefOverlay` — if the stored JSON
 * is corrupt for any reason, returns `{}` rather than failing,
 * matching the dispatch-pipeline's forgiving-on-read posture.
 */
export async function getAirlineSimBriefOverlay(): Promise<SimBriefOverlay | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!user?.airlineId) return null;

  const airline = await prisma.airline.findUnique({
    where: { id: user.airlineId },
    select: { simBriefOverlay: true },
  });
  if (!airline) return null;

  return parseSimBriefOverlay(airline.simBriefOverlay);
}

/* ---------------------------------------------------------------- *
 * FLEET-LEVEL OVERLAY (Ebene 2 in der Override-Hierarchie)         *
 * ---------------------------------------------------------------- *
 * Fleet entries scope an overlay to (airlineId, ICAO type) pairs.  *
 * Same auth model as airline-overlay actions: any user with a non- *
 * null airlineId may write fleet overlays for their airline.       *
 * Upgrade path to role-gating tracked alongside airline-overlay.   *
 * ---------------------------------------------------------------- */

interface FleetSummary {
  id: string;
  type: string;
  overlay: SimBriefOverlay;
  populatedCount: number;
}

/**
 * Lists all fleet-overlay entries for the authenticated user's
 * airline. Returns an empty array if the user has no airline (so
 * the UI can hide the section without a separate auth-error path).
 *
 * `populatedCount` is computed server-side rather than in the
 * client to keep the listing render cheap and consistent with the
 * count semantics used elsewhere (Airline overlay header badge).
 */
export async function listAirlineFleets(): Promise<FleetSummary[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!user?.airlineId) return [];

  const fleets = await prisma.fleet.findMany({
    where: { airlineId: user.airlineId },
    orderBy: { type: 'asc' },
    select: { id: true, type: true, simBriefOverlay: true },
  });

  return fleets.map((f) => {
    const overlay = parseSimBriefOverlay(f.simBriefOverlay);
    const populatedCount = Object.keys(overlay).length;
    return { id: f.id, type: f.type, overlay, populatedCount };
  });
}

/**
 * Upserts a fleet-overlay entry for the user's airline keyed by
 * ICAO type designator. Creates the row if absent, updates the
 * overlay JSON if present.
 *
 * The type string is uppercased for canonical storage — SimBrief
 * uses uppercase ICAO designators ("A320" not "a320") and the
 * dispatch-pipeline lookup will be uppercase-driven, so we
 * normalize here to avoid case-skew lookups.
 */
export async function upsertFleetSimBriefOverlay(
  type: string,
  input: SimBriefOverlay,
): Promise<
  | { success: true; fleetId: string }
  | { success: false; error: string; issues?: z.ZodIssue[] }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!user?.airlineId) {
    return { success: false, error: 'no_airline' };
  }

  const cleanType = type.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(cleanType)) {
    return { success: false, error: 'invalid_type' };
  }

  const parsed = SimBriefOverlaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'invalid_input',
      issues: parsed.error.issues,
    };
  }

  const fleet = await prisma.fleet.upsert({
    where: { airlineId_type: { airlineId: user.airlineId, type: cleanType } },
    create: {
      airlineId: user.airlineId,
      type: cleanType,
      simBriefOverlay: parsed.data,
    },
    update: { simBriefOverlay: parsed.data },
    select: { id: true },
  });

  revalidatePath('/bookings');
  revalidatePath('/settings');

  return { success: true, fleetId: fleet.id };
}

/**
 * Deletes a fleet-overlay entry by id. Caller's airlineId must
 * match the fleet's airlineId — prevents cross-airline deletion
 * even if the user knows the target fleet id.
 */
export async function deleteFleetSimBriefOverlay(
  fleetId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!user?.airlineId) {
    return { success: false, error: 'no_airline' };
  }

  // Verify scope before delete: this fleet must belong to the
  // user's airline. Without this guard, a user could delete any
  // fleet by id, which would leak across the airlineId boundary.
  const fleet = await prisma.fleet.findUnique({
    where: { id: fleetId },
    select: { airlineId: true },
  });
  if (!fleet) return { success: false, error: 'not_found' };
  if (fleet.airlineId !== user.airlineId) {
    return { success: false, error: 'forbidden' };
  }

  await prisma.fleet.delete({ where: { id: fleetId } });

  revalidatePath('/bookings');
  revalidatePath('/settings');

  return { success: true };
}
