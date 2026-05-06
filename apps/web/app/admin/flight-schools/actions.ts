'use server';

import { prisma, type LicenseType } from '@vam/db';
import { requireAdmin } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

/**
 * System-admin gate für Flight-School-CRUD (Welle 13E-11).
 *
 * FlightSchools sind airport-scoped, NICHT airline-scoped — sie
 * repräsentieren NPC-organisationen an einem airport (DLR Bremen am
 * EDDW, Lufthansa Aviation Training am EDDF, etc.) und sind cross-
 * airline sichtbar. Daher ist das CRUD strikt system-admin only,
 * NICHT airline-admin.
 *
 * Spiegelt requireSystemAdmin() in admin/pilots/actions.ts und
 * admin/roles/actions.ts — duplizierte gates statt shared helper aus
 * gleichem grund (unabhängige signatur-evolution).
 */
async function requireSystemAdmin() {
  const user = await requireAdmin();
  return user;
}

// ──────────────────────────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────────────────────────

/**
 * License-typen die FlightSchools anbieten können. Spiegelt das
 * LicenseType-enum in @vam/db (siehe schema.prisma) — wir listen sie
 * hier explicit damit zod sie validieren kann (z.nativeEnum würde nur
 * auf compiled-prisma-objekt funktionieren, aber das ist im 'use server'-
 * file fragil).
 */
const LICENSE_TYPE_VALUES = [
  'SPL',
  'PPL',
  'NIGHT_RATING',
  'INSTRUMENT_RATING',
  'MULTI_ENGINE_RATING',
  'CPL',
  'MCC',
  'ATPL',
  'TRI',
  'TRE',
] as const satisfies readonly LicenseType[];

/**
 * Shared zod-schema für create + update. Kommt aus dem FlightSchool-
 * model in schema.prisma:
 *   - name, airportIcao: required strings
 *   - rating: 0.0–5.0 (stars)
 *   - offeredLicenses: nicht-leeres array von LicenseType
 *   - hourlyRateGround/Air: positive Decimals (in VAM$)
 *   - hourlyRateSim: optional positive Decimal (manche schools haben kein sim)
 *   - description, logoUrl: optional
 *
 * Decimal-felder kommen als string (HTML-form-input) und werden durch
 * Prisma serialisiert — wir validieren mit numerischer regex damit
 * "1500" und "1500.50" beide akzeptiert werden, "abc" nicht.
 */
const FlightSchoolFormSchema = z.object({
  name: z.string().trim().min(2).max(120),
  airportIcao: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}$/, 'ICAO muss 4 Großbuchstaben sein (z.B. EDDF)'),
  rating: z.coerce.number().min(0).max(5).default(4.0),
  offeredLicenses: z
    .array(z.enum(LICENSE_TYPE_VALUES))
    .min(1, 'Mindestens eine Lizenz muss angeboten werden'),
  hourlyRateGround: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Format: 150 oder 150.50')
    .refine((s) => parseFloat(s) > 0, 'Muss > 0 sein'),
  hourlyRateAir: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Format: 350 oder 350.50')
    .refine((s) => parseFloat(s) > 0, 'Muss > 0 sein'),
  hourlyRateSim: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Format: 200 oder 200.50')
    .optional()
    .nullable()
    .or(z.literal('')),
  description: z.string().trim().max(2000).optional().nullable(),
  logoUrl: z.string().trim().url().max(500).optional().nullable().or(z.literal('')),
});

export type FlightSchoolFormInput = z.input<typeof FlightSchoolFormSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Create
// ──────────────────────────────────────────────────────────────────────────

/**
 * Neue FlightSchool anlegen. System-admin only.
 *
 * Validiert dass der referenzierte airport existiert (FK ist eh strict,
 * aber wir wollen einen lesbaren error-message statt P2003-prisma-error).
 *
 * Rate=4.0 default kommt aus schema. Active=true (default in schema).
 */
export async function createFlightSchool(input: FlightSchoolFormInput) {
  await requireSystemAdmin();
  const parsed = FlightSchoolFormSchema.parse(input);

  // FK-precheck mit lesbarer fehlermeldung. Ohne das würde Prisma einen
  // P2003-error werfen ("foreign key constraint failed"), was im UI
  // unschön rüberkommt.
  const airport = await prisma.airport.findUnique({
    where: { icao: parsed.airportIcao },
    select: { icao: true },
  });
  if (!airport) {
    throw new Error(
      `Airport ${parsed.airportIcao} existiert nicht im System. Erst über Airport-Verwaltung anlegen.`,
    );
  }

  await prisma.flightSchool.create({
    data: {
      airportIcao: parsed.airportIcao,
      name: parsed.name,
      rating: parsed.rating,
      offeredLicenses: parsed.offeredLicenses,
      hourlyRateGround: parsed.hourlyRateGround,
      hourlyRateAir: parsed.hourlyRateAir,
      hourlyRateSim:
        parsed.hourlyRateSim && parsed.hourlyRateSim !== ''
          ? parsed.hourlyRateSim
          : null,
      description: parsed.description?.trim() || null,
      logoUrl: parsed.logoUrl && parsed.logoUrl !== '' ? parsed.logoUrl : null,
      active: true,
    },
  });

  revalidatePath('/admin/flight-schools');
  // Pilot-side discovery-page (kommt in 13E-12) wird auch gecacht
  // invalidated falls sie vor dieser action gerendert wurde.
  revalidatePath('/flight-schools');
}

// ──────────────────────────────────────────────────────────────────────────
// Update
// ──────────────────────────────────────────────────────────────────────────

const UpdateFlightSchoolSchema = FlightSchoolFormSchema.extend({
  id: z.string().min(1),
});

/**
 * Bestehende FlightSchool updaten. System-admin only.
 *
 * AirportIcao ist editierbar — eine schule könnte theoretisch umziehen
 * (in der praxis selten, aber kein zwingender grund das zu blockieren).
 * FK-recheck wie in create.
 */
export async function updateFlightSchool(
  input: z.input<typeof UpdateFlightSchoolSchema>,
) {
  await requireSystemAdmin();
  const parsed = UpdateFlightSchoolSchema.parse(input);

  const existing = await prisma.flightSchool.findUnique({
    where: { id: parsed.id },
    select: { id: true, airportIcao: true },
  });
  if (!existing) {
    throw new Error('FlightSchool nicht gefunden');
  }

  if (existing.airportIcao !== parsed.airportIcao) {
    const airport = await prisma.airport.findUnique({
      where: { icao: parsed.airportIcao },
      select: { icao: true },
    });
    if (!airport) {
      throw new Error(
        `Airport ${parsed.airportIcao} existiert nicht im System.`,
      );
    }
  }

  await prisma.flightSchool.update({
    where: { id: parsed.id },
    data: {
      airportIcao: parsed.airportIcao,
      name: parsed.name,
      rating: parsed.rating,
      offeredLicenses: parsed.offeredLicenses,
      hourlyRateGround: parsed.hourlyRateGround,
      hourlyRateAir: parsed.hourlyRateAir,
      hourlyRateSim:
        parsed.hourlyRateSim && parsed.hourlyRateSim !== ''
          ? parsed.hourlyRateSim
          : null,
      description: parsed.description?.trim() || null,
      logoUrl: parsed.logoUrl && parsed.logoUrl !== '' ? parsed.logoUrl : null,
    },
  });

  revalidatePath('/admin/flight-schools');
  revalidatePath(`/admin/flight-schools/${parsed.id}`);
  revalidatePath('/flight-schools');
}

// ──────────────────────────────────────────────────────────────────────────
// Soft-Delete (Deactivate)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete einer FlightSchool. System-admin only.
 *
 * Schema-policy: active=false statt hard-delete. Bei deactivate werden
 * existing in-progress enrollments NICHT gecanceled (siehe schema-comment) —
 * pilot kann seinen aktuellen training-block fertig fliegen, aber neue
 * enrollments werden im pilot-flow ausgefiltert (active-only listing).
 *
 * Re-activate ist möglich via setFlightSchoolActive(id, true) — separate
 * action damit das toggle-pattern explizit ist und nicht aus versehen
 * via "delete" erfolgt.
 */
export async function setFlightSchoolActive(id: string, active: boolean) {
  await requireSystemAdmin();
  if (!id) throw new Error('id required');

  await prisma.flightSchool.update({
    where: { id },
    data: { active },
  });

  revalidatePath('/admin/flight-schools');
  revalidatePath(`/admin/flight-schools/${id}`);
  revalidatePath('/flight-schools');
}

// ──────────────────────────────────────────────────────────────────────────
// Redirect-helper für form-submit
// ──────────────────────────────────────────────────────────────────────────

/**
 * Wrapper für create-action der nach erfolg auf die list-page redirected.
 * Wird vom create-form auf der list-page verwendet — der Form-action
 * eines server-actions kann nicht selbst redirecten via revalidate, das
 * muss explizit erfolgen.
 */
export async function createFlightSchoolAndRedirect(
  input: FlightSchoolFormInput,
) {
  await createFlightSchool(input);
  redirect('/admin/flight-schools');
}
