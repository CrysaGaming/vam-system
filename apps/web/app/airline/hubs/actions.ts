'use server';

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Hub-Management server-actions. Mirrors auth-pattern aus airline/routes/
 * actions.ts: gleiche AIRLINE_MANAGER_ROLES, gleiches require-airline-admin.
 *
 * Hub-system architectural notes:
 * - Eine airline kann 1..N hubs haben (multi-hub von anfang an, FRA+MUC-style).
 * - Genau ein hub hat isPrimary=true. Enforce in app-logik (nicht DB-constraint
 *   weil postgres partial-unique-indexes nicht direkt in prisma schema
 *   ausdrückbar sind ohne raw migration).
 * - Erster hub einer airline ist automatisch primary.
 * - Set-primary-action setzt alle anderen hubs derselben airline auf
 *   isPrimary=false in einer transaction.
 * - Remove-action ist NUR erlaubt wenn der hub NICHT primary ist (UI gate)
 *   ODER der primary-hub als letzter (also einziger) hub gelöscht wird.
 *   Begründung: nie airline ohne primary-hub haben außer "0 hubs total".
 *
 * Out-of-scope für Welle 4 (kommt später):
 * - Pilot-rebalance bei hub-removal (was passiert mit baseIcao=removed-hub?)
 *   v1 strategy: pilot-baseIcao bleibt orphan-string, app-fallback auf
 *   primary-hub. Welle 5+ kriegt explizites pilot-rebalance-flow.
 * - Hub-spezifische scheduling-rules, ATC-stunden, gates → Welle 7+.
 */
const requireAirlineAdmin = requireAirlineManagerWithAirline;

// ─────────────────────────────────────────────────────────────────────────
// Add Hub
// ─────────────────────────────────────────────────────────────────────────

const AddHubSchema = z.object({
  // ICAO normalisiert auf uppercase, 4 chars für regular ICAO,
  // 3-4 chars für edge-cases (KJFK, EDDF, vs einige unique 3-letter).
  // Gleiches pattern wie Aircraft.homeIcao validation.
  icao: z
    .string()
    .min(3)
    .max(4)
    .regex(/^[A-Z0-9]+$/, 'ICAO darf nur A-Z und 0-9 enthalten')
    .transform((s) => s.toUpperCase()),
});

export async function addHub(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const parsed = AddHubSchema.safeParse({
    icao: String(formData.get('icao') ?? '').trim().toUpperCase(),
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe',
    };
  }

  // Validate: airport existiert im catalog. Hubs MÜSSEN einen verifizierten
  // catalog-entry haben — kein "free-text"-hub. Falls airline einen exotic
  // airport braucht, muss erst AirportRequest durch sein.
  const airport = await prisma.airport.findUnique({
    where: { icao: parsed.data.icao },
    select: { icao: true, name: true, active: true },
  });

  if (!airport) {
    return {
      ok: false as const,
      error: `Airport ${parsed.data.icao} nicht im Catalog. Bitte erst über /airports/request einreichen.`,
    };
  }

  if (!airport.active) {
    return {
      ok: false as const,
      error: `Airport ${parsed.data.icao} ist inaktiv (${airport.name}).`,
    };
  }

  // Check duplicate (DB-constraint würde es auch abfangen, aber wir wollen
  // eine schöne fehlermeldung statt "Unique constraint violation").
  const existing = await prisma.airlineHub.findUnique({
    where: {
      airlineId_airportIcao: {
        airlineId,
        airportIcao: parsed.data.icao,
      },
    },
  });

  if (existing) {
    return {
      ok: false as const,
      error: `${parsed.data.icao} ist bereits als Hub angelegt.`,
    };
  }

  // Erster hub einer airline = auto-primary. Sonst false-default.
  const hubCount = await prisma.airlineHub.count({ where: { airlineId } });
  const isFirstHub = hubCount === 0;

  await prisma.airlineHub.create({
    data: {
      airlineId,
      airportIcao: parsed.data.icao,
      isPrimary: isFirstHub,
    },
  });

  revalidatePath('/airline/hubs');
  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────────────────
// Set Primary Hub
// ─────────────────────────────────────────────────────────────────────────

const SetPrimaryHubSchema = z.object({
  hubId: z.string().min(1),
});

export async function setPrimaryHub(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const parsed = SetPrimaryHubSchema.safeParse({
    hubId: String(formData.get('hubId') ?? ''),
  });

  if (!parsed.success) {
    return { ok: false as const, error: 'Ungültige Eingabe' };
  }

  // Verify hub gehört zu dieser airline (multi-tenant gate — verhindert
  // dass airline A einen hub von airline B umflagged via tampered formData).
  const hub = await prisma.airlineHub.findUnique({
    where: { id: parsed.data.hubId },
    select: { id: true, airlineId: true, isPrimary: true },
  });

  if (!hub || hub.airlineId !== airlineId) {
    return { ok: false as const, error: 'Hub nicht gefunden.' };
  }

  if (hub.isPrimary) {
    // No-op — bereits primary.
    return { ok: true as const };
  }

  // Transaction: alle anderen hubs der airline auf isPrimary=false,
  // den ausgewählten auf true. Atomicity ist wichtig damit niemals
  // 2 hubs gleichzeitig primary sind oder 0 hubs primary sind.
  await prisma.$transaction([
    prisma.airlineHub.updateMany({
      where: { airlineId, isPrimary: true },
      data: { isPrimary: false },
    }),
    prisma.airlineHub.update({
      where: { id: parsed.data.hubId },
      data: { isPrimary: true },
    }),
  ]);

  revalidatePath('/airline/hubs');
  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────────────────
// Remove Hub
// ─────────────────────────────────────────────────────────────────────────

const RemoveHubSchema = z.object({
  hubId: z.string().min(1),
});

export async function removeHub(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const parsed = RemoveHubSchema.safeParse({
    hubId: String(formData.get('hubId') ?? ''),
  });

  if (!parsed.success) {
    return { ok: false as const, error: 'Ungültige Eingabe' };
  }

  const hub = await prisma.airlineHub.findUnique({
    where: { id: parsed.data.hubId },
    select: { id: true, airlineId: true, isPrimary: true, airportIcao: true },
  });

  if (!hub || hub.airlineId !== airlineId) {
    return { ok: false as const, error: 'Hub nicht gefunden.' };
  }

  // Policy: primary-hub kann nur gelöscht werden wenn er der einzige hub
  // ist (airline-shutdown-szenario). Sonst muss erst ein anderer hub
  // primary gemacht werden. Verhindert "airline ohne primary-hub" state
  // wenn noch andere hubs existieren.
  if (hub.isPrimary) {
    const otherCount = await prisma.airlineHub.count({
      where: { airlineId, id: { not: hub.id } },
    });
    if (otherCount > 0) {
      return {
        ok: false as const,
        error: `${hub.airportIcao} ist Primary-Hub. Setze erst einen anderen Hub als Primary, dann kann dieser entfernt werden.`,
      };
    }
  }

  await prisma.airlineHub.delete({
    where: { id: hub.id },
  });

  revalidatePath('/airline/hubs');
  return { ok: true as const };
}
