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

/* ---------------------------------------------------------------- *
 * AIRCRAFT-LEVEL OVERLAY (Ebene 3 in der Override-Hierarchie)      *
 * ---------------------------------------------------------------- *
 * Aircraft rows exist independently of overlays (created via       *
 * fleet management / seed). Overlay is an optional JSON column on  *
 * the existing Aircraft row, so we list+edit but never create or   *
 * delete from this UI — that would interfere with the airline's    *
 * actual fleet roster.                                             *
 * ---------------------------------------------------------------- */

interface AircraftSummary {
  id: string;
  registration: string;
  type: string;
  overlay: SimBriefOverlay;
  populatedCount: number;
}

export async function listAirlineAircraft(): Promise<AircraftSummary[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!user?.airlineId) return [];

  const aircraft = await prisma.aircraft.findMany({
    where: { airlineId: user.airlineId },
    orderBy: { registration: 'asc' },
    select: {
      id: true,
      registration: true,
      type: true,
      simBriefOverlay: true,
    },
  });

  return aircraft.map((a) => {
    const overlay = parseSimBriefOverlay(a.simBriefOverlay);
    return {
      id: a.id,
      registration: a.registration,
      type: a.type,
      overlay,
      populatedCount: Object.keys(overlay).length,
    };
  });
}

/**
 * Updates the simBriefOverlay JSON column on an Aircraft row,
 * scoped to the user's airline. The aircraft row itself is not
 * created or deleted by this action.
 *
 * Empty overlay (`{}`) is a valid "clear all overrides" signal —
 * persisted as `{}` rather than null to distinguish "user cleared"
 * from "never set" in the audit trail.
 */
export async function updateAircraftSimBriefOverlay(
  aircraftId: string,
  input: SimBriefOverlay,
): Promise<
  | { success: true }
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

  // Cross-airline scope-guard before write — same pattern as
  // deleteFleetSimBriefOverlay. Without this, knowing an aircraft
  // id from another airline would let a user write its overlay.
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: aircraftId },
    select: { airlineId: true },
  });
  if (!aircraft) return { success: false, error: 'not_found' };
  if (aircraft.airlineId !== user.airlineId) {
    return { success: false, error: 'forbidden' };
  }

  const parsed = SimBriefOverlaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'invalid_input',
      issues: parsed.error.issues,
    };
  }

  await prisma.aircraft.update({
    where: { id: aircraftId },
    data: { simBriefOverlay: parsed.data },
  });

  revalidatePath('/bookings');
  revalidatePath('/settings');

  return { success: true };
}

/* ---------------------------------------------------------------- *
 * ROUTE-LEVEL OVERLAY (Ebene 4, höchste precedence)                *
 * ---------------------------------------------------------------- *
 * Same edit-only model as Aircraft — Route rows exist for the      *
 * airline's schedule and are not managed via this UI.              *
 * ---------------------------------------------------------------- */

interface RouteSummary {
  id: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  overlay: SimBriefOverlay;
  populatedCount: number;
}

export async function listAirlineRoutes(): Promise<RouteSummary[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!user?.airlineId) return [];

  const routes = await prisma.route.findMany({
    where: { airlineId: user.airlineId },
    orderBy: { flightNumber: 'asc' },
    select: {
      id: true,
      flightNumber: true,
      simBriefOverlay: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
    },
  });

  return routes.map((r) => {
    const overlay = parseSimBriefOverlay(r.simBriefOverlay);
    return {
      id: r.id,
      flightNumber: r.flightNumber,
      departureIcao: r.departure.icao,
      arrivalIcao: r.arrival.icao,
      overlay,
      populatedCount: Object.keys(overlay).length,
    };
  });
}

export async function updateRouteSimBriefOverlay(
  routeId: string,
  input: SimBriefOverlay,
): Promise<
  | { success: true }
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

  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: { airlineId: true },
  });
  if (!route) return { success: false, error: 'not_found' };
  if (route.airlineId !== user.airlineId) {
    return { success: false, error: 'forbidden' };
  }

  const parsed = SimBriefOverlaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'invalid_input',
      issues: parsed.error.issues,
    };
  }

  await prisma.route.update({
    where: { id: routeId },
    data: { simBriefOverlay: parsed.data },
  });

  revalidatePath('/bookings');
  revalidatePath('/settings');

  return { success: true };
}

/**
 * Welle 13D-1: User-level economy opt-in.
 *
 * Toggelt User.economyEnabled. Default ist false (alle existing user
 * additive-migrated). Erst wenn DIESER flag UND airline.economyEnabled
 * beide true sind, läuft processFlightEconomy beim PIREP-approval und
 * bucht wallet-transactions. Solange einer der beiden flags false ist,
 * skippt der orchestrator mit reason="airline-economy-disabled" oder
 * "user-economy-disabled" — stille no-ops, kein UI-impact.
 *
 * Side-effects beim TOGGLE:
 *   - Disable: keine retroaktive löschung. Existing wallets + transactions
 *     bleiben in DB (audit-trail). Künftige PIREPs werden nicht mehr
 *     gebucht. Re-enable wirkt nur prospektiv.
 *   - Enable: kein wallet wird hier eager erstellt. Lazy creation passiert
 *     beim ersten PIREP-approval (siehe processFlightEconomy → getOrCreate-
 *     Wallet). Wenn user noch nie geflogen ist, gibt's noch nichts zu sehen.
 *
 * Bewusst KEINE prüfung ob airline.economyEnabled hier — der user-toggle
 * ist orthogonal. Wenn die airline-flag noch off ist, sieht der user
 * im UI einen hint, aber der toggle selbst ist set-bar.
 */
export async function setUserEconomyEnabled(enabled: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  await prisma.user.update({
    where: { id: session.user.id },
    data: { economyEnabled: enabled },
  });

  // Dashboard zeigt seit 13D-2 die WalletCard wenn beide flags true sind
  // — also auch revalidaten damit der toggle sofort wirkt.
  revalidatePath('/settings');
  revalidatePath('/dashboard');

  return { success: true, economyEnabled: enabled };
}

/**
 * Welle 13E-3: User-level career opt-in.
 *
 * Toggelt User.careerEnabled. Default ist false (alle existing user
 * additive-migrated). Erst wenn DIESER flag UND airline.careerEnabled
 * beide true sind, greifen die career-features:
 *   - Booking-gate (13E-7) blockiert flüge ohne ausreichende lizenzen
 *   - Auto-rank-promotion (13E-9) prüft license-requirements für nächsten rang
 *   - PIREP-approval-hook (13E-9) inkrementiert TypeRating.hoursOnType
 *   - Salary-multiplier per rank (13E-10) skaliert pilot-bezahlung
 *
 * Solange einer der beiden flags false ist, sind alle dieser features
 * stille no-ops — kein UI-impact für nicht-teilnehmer.
 *
 * Side-effects beim TOGGLE:
 *   - Disable: keine retroaktive löschung. Existing licenses + type-
 *     ratings bleiben in DB (audit-trail). Künftige PIREPs werden nicht
 *     mehr für rank-progression gewertet. Re-enable wirkt nur prospektiv —
 *     der pilot ist mit current-licenses + current-rank wieder dabei,
 *     keine retro-rechnung der missing-flights.
 *   - Enable: kein license wird hier eager erstellt. User mit careerEnabled=
 *     true ohne licenses sehen im /licenses-tab eine "noch keine lizenzen"-
 *     hint und können entweder admin-grants oder flight-school-enrollments
 *     (13E-12) nutzen.
 *
 * Bewusst KEINE prüfung ob airline.careerEnabled hier — der user-toggle
 * ist orthogonal. Wenn die airline-flag noch off ist, sieht der user
 * im UI einen hint, aber der toggle selbst ist set-bar.
 */
export async function setUserCareerEnabled(enabled: boolean) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  await prisma.user.update({
    where: { id: session.user.id },
    data: { careerEnabled: enabled },
  });

  // /licenses page (13E-5) und sidebar-link werden vom layout/AppShell
  // basierend auf hasCareer gerendert — revalidate damit der toggle
  // sofort die navigation neu malt.
  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/licenses');

  return { success: true, careerEnabled: enabled };
}

/**
 * Track 4 #61 (Section L): Pilot-Bio setter.
 *
 * Setzt User.bio. Akzeptiert string (1..500 chars nach sanitize) oder null
 * (= clear, bio entfernen → UI zeigt placeholder "Keine bio gesetzt").
 *
 * Sanitization pipeline:
 *   1. Trim leading/trailing whitespace
 *   2. Strip control-chars (NULL, BEL, etc) ausser \n und \t
 *   3. Kollabiere 3+ consecutive newlines auf max 2 (verhindert
 *      "wall of empty lines"-trolling)
 *   4. Wenn nach sanitize length=0 → behandle als null (= clear)
 *   5. Wenn nach sanitize length>500 → reject mit error
 *
 * Length-cap 500 chars: lang genug für 2-3 sätze pilot-bio, kurz genug
 * dass pilot-profile-cards nicht zu walls-of-text werden.
 *
 * Bewusst kein markdown/HTML-rendering — plain-text mit newline-preservation.
 * Verhindert XSS-vektor + komplexe content-moderation-anforderungen.
 *
 * Revalidates /settings + alle pilot-profile-pfade weil bio dort sichtbar
 * ist. /pilots/[id] kann ich nicht spezifisch revalidieren ohne den
 * eigenen userId zu kennen — generic /pilots covered alles.
 */
export async function setUserBio(rawBio: string | null) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  let normalized: string | null = null;
  if (rawBio !== null) {
    // 1. Trim
    let cleaned = rawBio.trim();

    // 2. Strip control-chars ausser \n und \t. Regex matched:
    //    \x00-\x08 (alle vor \t), \x0B-\x0C (nach \n vor \r), \x0E-\x1F,
    //    \x7F (DEL). \r wird zu \n normalisiert vorher.
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    cleaned = cleaned.replace(
      /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g,
      '',
    );

    // 3. Kollabiere 3+ newlines auf 2 (= eine leere zeile zwischen
    //    absätzen erlaubt, aber kein vertikales scrollen-spam).
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // 4. Empty-nach-sanitize = treat als clear
    if (cleaned.length === 0) {
      normalized = null;
    } else if (cleaned.length > 500) {
      // 5. Hard-cap, reject
      throw new Error('Bio darf max. 500 zeichen lang sein');
    } else {
      normalized = cleaned;
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { bio: normalized },
  });

  revalidatePath('/settings');
  revalidatePath('/pilots');
  revalidatePath(`/pilots/${session.user.id}`);

  return { success: true, bio: normalized };
}
