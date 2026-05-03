'use server';

import { auth } from '@/auth';
import { prisma, AircraftStatus } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Aircraft-Management server-actions. Welle 5 commit 5c.
 *
 * Mirrors auth-pattern aus airline/hubs/actions.ts:
 * - AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor)
 * - requireAirlineAdmin() guard
 * - Multi-tenant gates: airline-id-check vor jeder mutation
 *
 * Architektur-decisions:
 *
 * 1. AircraftType-resolution: form gibt EITHER aircraftTypeId (vom catalog-
 *    picker) OR type-string (free-text fallback). Wir resolven aircraftTypeId
 *    → type-string via AircraftType.icaoType lookup, damit Aircraft.type
 *    immer den ICAO-designator hat. Type-string ohne typeId bleibt erlaubt
 *    (legacy compatibility) — z.B. wenn airline einen exotischen type hat
 *    der nicht im catalog ist.
 *
 * 2. Delete-policy: hard-delete NUR wenn aircraft KEINE pireps + routes hat.
 *    Sonst muss user explizit auf RETIRED setzen (soft-delete via status).
 *    Begründung: Pirep.aircraftId und Route.aircraftId sind nullable, also
 *    würden cascading SetNull-deletes funktionieren — aber das würde
 *    historische daten orphan-machen. Besser: zeige fehler "X PIREPs
 *    referenzieren dieses Aircraft, bitte erst RETIRED setzen oder PIREPs
 *    cleanen".
 *
 * 3. Status-changes propagieren NICHT auf Aircraft.active. Ich habe drüber
 *    nachgedacht ob status==ACTIVE → active=true sync gemacht werden soll,
 *    aber:
 *    - active ist legacy-flag, depreciated in Phase 2
 *    - keine app-code-stelle nutzt die kombination "active=true && status!=ACTIVE"
 *    - sync würde subtle bugs erzeugen wenn jemand active manuell ändert
 *    Stattdessen: bei add-time setzen wir active=(status==ACTIVE), aber
 *    spätere status-changes lassen active unverändert. Welle 6+ migration
 *    droppt active komplett.
 *
 * 4. Updated-Position bei status=RETIRED: bewusst NICHT clearen. Der letzte
 *    bekannte standort bleibt nützlich für audit ("wo war D-AIBC als wir
 *    sie ausgemustert haben?").
 *
 * Out-of-scope (5d/Welle 6+):
 * - Auto-position-update bei PIREP-approval → 5d
 * - Bulk-import via CSV → Welle 6+
 * - Per-aircraft SimBrief-overlay-edit → Welle 6+
 * - Maintenance-history mit grund/dauer → Welle 7+ (operational depth)
 */
const AIRLINE_MANAGER_ROLES = ['admin', 'airline-admin', 'instructor'];

async function requireAirlineAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || !AIRLINE_MANAGER_ROLES.includes(user.role.name)) {
    throw new Error('forbidden');
  }
  if (!user.airlineId) {
    throw new Error('no-airline');
  }

  return { user, airlineId: user.airlineId };
}

// ─────────────────────────────────────────────────────────────────────────
// Add Aircraft
// ─────────────────────────────────────────────────────────────────────────

const AddAircraftSchema = z.object({
  // Registration normalisiert auf uppercase (D-AIBC, N123AB, G-XBJB).
  // 2-10 chars cover ICAO standard registrations weltweit. Regex erlaubt
  // alphanumeric + bindestriche.
  registration: z
    .string()
    .min(2, 'Registration zu kurz')
    .max(10, 'Registration zu lang')
    .regex(/^[A-Z0-9-]+$/, 'Nur A-Z, 0-9 und - erlaubt')
    .transform((s) => s.toUpperCase()),

  // Aircraft-type entweder als FK auf AircraftType-catalog oder free-text.
  // Beim submit muss eines von beiden gesetzt sein. typeId hat priority —
  // wenn beide gesetzt, type-string wird vom catalog-entry überschrieben.
  aircraftTypeId: z.string().optional(),
  type: z.string().max(20).optional(),

  // Home-ICAO optional. Wenn gesetzt, MUSS verifizierter airport sein.
  // App-validation gegen catalog passiert nach zod-parse.
  homeIcao: z
    .string()
    .min(3)
    .max(4)
    .regex(/^[A-Z0-9]+$/, 'ICAO darf nur A-Z und 0-9 enthalten')
    .transform((s) => s.toUpperCase())
    .optional()
    .or(z.literal('')),

  // Status optional, default ACTIVE. Beim add ist das fast immer ACTIVE,
  // aber UI kann auch direkt auf MAINTENANCE/STORED legen wenn das
  // aircraft z.B. importiert wird im wartungs-zustand.
  status: z
    .enum(['ACTIVE', 'MAINTENANCE', 'STORED', 'RETIRED'])
    .default('ACTIVE'),
});

export async function addAircraft(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const rawHome = String(formData.get('homeIcao') ?? '').trim();
  const parsed = AddAircraftSchema.safeParse({
    registration: String(formData.get('registration') ?? '').trim(),
    aircraftTypeId: String(formData.get('aircraftTypeId') ?? '').trim() || undefined,
    type: String(formData.get('type') ?? '').trim() || undefined,
    homeIcao: rawHome || undefined,
    status: String(formData.get('status') ?? 'ACTIVE'),
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe',
    };
  }

  // Either aircraftTypeId OR type-string must be set.
  if (!parsed.data.aircraftTypeId && !parsed.data.type) {
    return {
      ok: false as const,
      error: 'Aircraft-Type ist Pflichtfeld (Catalog-Eintrag oder Free-Text).',
    };
  }

  // Resolve typeId → type-string via catalog-lookup. Wenn typeId angegeben
  // aber nicht im catalog gefunden, fail mit error (typeId aus tampered
  // formData possible).
  let resolvedType: string;
  let resolvedTypeId: string | null = null;

  if (parsed.data.aircraftTypeId) {
    const catalogEntry = await prisma.aircraftType.findUnique({
      where: { id: parsed.data.aircraftTypeId },
      select: { id: true, icaoType: true, active: true },
    });

    if (!catalogEntry) {
      return {
        ok: false as const,
        error: 'Aircraft-Type aus Catalog nicht gefunden.',
      };
    }

    if (!catalogEntry.active) {
      return {
        ok: false as const,
        error: `Aircraft-Type ${catalogEntry.icaoType} ist als inaktiv markiert.`,
      };
    }

    resolvedType = catalogEntry.icaoType;
    resolvedTypeId = catalogEntry.id;
  } else {
    // Free-text fallback. Uppercased für konsistenz mit catalog-entries.
    resolvedType = parsed.data.type!.toUpperCase();
  }

  // Validate home-icao gegen catalog (wenn gesetzt). Nicht-existing oder
  // inactive airports werden geblockt.
  if (parsed.data.homeIcao) {
    const airport = await prisma.airport.findUnique({
      where: { icao: parsed.data.homeIcao },
      select: { icao: true, active: true, name: true },
    });

    if (!airport) {
      return {
        ok: false as const,
        error: `Airport ${parsed.data.homeIcao} nicht im Catalog.`,
      };
    }

    if (!airport.active) {
      return {
        ok: false as const,
        error: `Airport ${parsed.data.homeIcao} ist inaktiv (${airport.name}).`,
      };
    }
  }

  // Check duplicate registration (DB-constraint würde es auch fangen, aber
  // wir wollen schöne fehlermeldung statt "Unique constraint violation").
  const existing = await prisma.aircraft.findUnique({
    where: { registration: parsed.data.registration },
    select: { id: true, airlineId: true },
  });

  if (existing) {
    // Wenn die registration bei dieser airline existiert: einfach "schon da".
    // Wenn bei anderer airline: NICHT die info preisgeben (privacy), nur
    // generic error. Multi-tenant info-leak vermeiden.
    if (existing.airlineId === airlineId) {
      return {
        ok: false as const,
        error: `${parsed.data.registration} ist bereits in deiner Flotte.`,
      };
    }
    return {
      ok: false as const,
      error: `Registration ${parsed.data.registration} ist bereits vergeben.`,
    };
  }

  await prisma.aircraft.create({
    data: {
      airlineId,
      registration: parsed.data.registration,
      type: resolvedType,
      aircraftTypeId: resolvedTypeId,
      homeIcao: parsed.data.homeIcao || null,
      status: parsed.data.status,
      // active-flag synchron mit status (siehe architektur-decision oben).
      active: parsed.data.status === 'ACTIVE',
    },
  });

  revalidatePath('/airline/aircraft');
  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────────────────
// Update Aircraft (edit)
// ─────────────────────────────────────────────────────────────────────────

const UpdateAircraftSchema = z.object({
  aircraftId: z.string().min(1),
  // Registration kann geändert werden, aber das ist riskant (printet auf
  // alle historischen PIREPs). UI sollte warning zeigen. Schema akzeptiert
  // es trotzdem — admin-flexibility.
  registration: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9-]+$/, 'Nur A-Z, 0-9 und - erlaubt')
    .transform((s) => s.toUpperCase()),
  aircraftTypeId: z.string().optional(),
  type: z.string().max(20).optional(),
  homeIcao: z
    .string()
    .min(3)
    .max(4)
    .regex(/^[A-Z0-9]+$/)
    .transform((s) => s.toUpperCase())
    .optional()
    .or(z.literal('')),
});

export async function updateAircraft(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const rawHome = String(formData.get('homeIcao') ?? '').trim();
  const parsed = UpdateAircraftSchema.safeParse({
    aircraftId: String(formData.get('aircraftId') ?? ''),
    registration: String(formData.get('registration') ?? '').trim(),
    aircraftTypeId: String(formData.get('aircraftTypeId') ?? '').trim() || undefined,
    type: String(formData.get('type') ?? '').trim() || undefined,
    homeIcao: rawHome || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe',
    };
  }

  if (!parsed.data.aircraftTypeId && !parsed.data.type) {
    return {
      ok: false as const,
      error: 'Aircraft-Type ist Pflichtfeld.',
    };
  }

  // Multi-tenant gate: aircraft muss zur eigenen airline gehören.
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: parsed.data.aircraftId },
    select: { id: true, airlineId: true, registration: true },
  });

  if (!aircraft || aircraft.airlineId !== airlineId) {
    return { ok: false as const, error: 'Aircraft nicht gefunden.' };
  }

  // Type-resolution analog addAircraft.
  let resolvedType: string;
  let resolvedTypeId: string | null = null;

  if (parsed.data.aircraftTypeId) {
    const catalogEntry = await prisma.aircraftType.findUnique({
      where: { id: parsed.data.aircraftTypeId },
      select: { id: true, icaoType: true, active: true },
    });

    if (!catalogEntry) {
      return { ok: false as const, error: 'Aircraft-Type nicht gefunden.' };
    }
    if (!catalogEntry.active) {
      return {
        ok: false as const,
        error: `Aircraft-Type ${catalogEntry.icaoType} ist inaktiv.`,
      };
    }

    resolvedType = catalogEntry.icaoType;
    resolvedTypeId = catalogEntry.id;
  } else {
    resolvedType = parsed.data.type!.toUpperCase();
  }

  // Home-icao validation (analog add).
  if (parsed.data.homeIcao) {
    const airport = await prisma.airport.findUnique({
      where: { icao: parsed.data.homeIcao },
      select: { icao: true, active: true },
    });
    if (!airport || !airport.active) {
      return {
        ok: false as const,
        error: `Airport ${parsed.data.homeIcao} nicht im Catalog oder inaktiv.`,
      };
    }
  }

  // Wenn registration geändert: prüfen dass sie nicht schon vergeben ist.
  if (parsed.data.registration !== aircraft.registration) {
    const conflict = await prisma.aircraft.findUnique({
      where: { registration: parsed.data.registration },
      select: { id: true },
    });
    if (conflict) {
      return {
        ok: false as const,
        error: `Registration ${parsed.data.registration} ist bereits vergeben.`,
      };
    }
  }

  await prisma.aircraft.update({
    where: { id: aircraft.id },
    data: {
      registration: parsed.data.registration,
      type: resolvedType,
      aircraftTypeId: resolvedTypeId,
      homeIcao: parsed.data.homeIcao || null,
    },
  });

  revalidatePath('/airline/aircraft');
  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────────────────
// Set Aircraft Status
// ─────────────────────────────────────────────────────────────────────────

const SetAircraftStatusSchema = z.object({
  aircraftId: z.string().min(1),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'STORED', 'RETIRED']),
});

export async function setAircraftStatus(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const parsed = SetAircraftStatusSchema.safeParse({
    aircraftId: String(formData.get('aircraftId') ?? ''),
    status: String(formData.get('status') ?? ''),
  });

  if (!parsed.success) {
    return { ok: false as const, error: 'Ungültige Eingabe' };
  }

  // Multi-tenant gate.
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: parsed.data.aircraftId },
    select: { id: true, airlineId: true, status: true, registration: true },
  });

  if (!aircraft || aircraft.airlineId !== airlineId) {
    return { ok: false as const, error: 'Aircraft nicht gefunden.' };
  }

  if (aircraft.status === parsed.data.status) {
    // No-op, bereits in dem status.
    return { ok: true as const };
  }

  await prisma.aircraft.update({
    where: { id: aircraft.id },
    data: {
      status: parsed.data.status as AircraftStatus,
    },
  });

  revalidatePath('/airline/aircraft');
  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────────────────
// Delete Aircraft
// ─────────────────────────────────────────────────────────────────────────

const DeleteAircraftSchema = z.object({
  aircraftId: z.string().min(1),
});

export async function deleteAircraft(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const parsed = DeleteAircraftSchema.safeParse({
    aircraftId: String(formData.get('aircraftId') ?? ''),
  });

  if (!parsed.success) {
    return { ok: false as const, error: 'Ungültige Eingabe' };
  }

  const aircraft = await prisma.aircraft.findUnique({
    where: { id: parsed.data.aircraftId },
    select: {
      id: true,
      airlineId: true,
      registration: true,
      _count: {
        select: { pireps: true, routes: true },
      },
    },
  });

  if (!aircraft || aircraft.airlineId !== airlineId) {
    return { ok: false as const, error: 'Aircraft nicht gefunden.' };
  }

  // Hard-delete-policy: keine pireps und keine routes referenzieren das
  // aircraft. Sonst zeigt UI dem user "RETIRED setzen" als alternative.
  if (aircraft._count.pireps > 0 || aircraft._count.routes > 0) {
    return {
      ok: false as const,
      error: `${aircraft.registration} hat ${aircraft._count.pireps} PIREPs und ${aircraft._count.routes} Routes — kann nicht gelöscht werden. Setze stattdessen den Status auf "Außer Dienst".`,
    };
  }

  await prisma.aircraft.delete({
    where: { id: aircraft.id },
  });

  revalidatePath('/airline/aircraft');
  return { ok: true as const };
}

// ─────────────────────────────────────────────────────────────────────────
// Search AircraftTypes (autocomplete)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Server-action für AircraftTypeAutocomplete component (Welle 6A).
 *
 * Hybrid-mode autocomplete: liefert catalog-suggestions, aber das form
 * akzeptiert AUCH free-text wenn keine selection gemacht wird (siehe
 * AircraftTypeAutocomplete + addAircraft/updateAircraft logic).
 *
 * Search-strategie:
 * - icaoType (z.B. "B738") prefix-match — primary use-case: admin tippt
 *   die ICAO-bezeichnung
 * - manufacturer + name contains — fallback wenn admin "Boeing" oder
 *   "A320" tippt statt "B738"
 * - Limit 12 results pro query, dedup nach id
 * - Nur active=true entries (inactive types sollen nicht in neuen
 *   aircraft landen)
 *
 * Auth: gleiche AIRLINE_MANAGER_ROLES wie alle anderen actions hier.
 * Kein multi-tenant filter — AircraftType-catalog ist global shared,
 * nicht airline-spezifisch.
 *
 * Performance: 2 parallel queries, return shape ist bewusst minimal
 * (nur id, icaoType, name, manufacturer, category, verified) damit
 * die response klein bleibt und nicht über jede tastendruck megabytes
 * fließen.
 */
export async function searchAircraftTypes(query: string) {
  await requireAirlineAdmin();

  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const upper = trimmed.toUpperCase();

  // 2 parallel queries: prefix-match auf icaoType (primary) + contains-
  // match auf manufacturer/name (fallback). Mergen + dedup client-side.
  const [byIcao, byNameOrManu] = await Promise.all([
    prisma.aircraftType.findMany({
      where: {
        active: true,
        icaoType: { startsWith: upper },
      },
      orderBy: [{ verified: 'desc' }, { icaoType: 'asc' }],
      take: 12,
      select: {
        id: true,
        icaoType: true,
        name: true,
        manufacturer: true,
        category: true,
        verified: true,
      },
    }),
    prisma.aircraftType.findMany({
      where: {
        active: true,
        OR: [
          { manufacturer: { contains: trimmed, mode: 'insensitive' } },
          { name: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ verified: 'desc' }, { icaoType: 'asc' }],
      take: 12,
      select: {
        id: true,
        icaoType: true,
        name: true,
        manufacturer: true,
        category: true,
        verified: true,
      },
    }),
  ]);

  // Dedup nach id, primary-results (byIcao) zuerst.
  const seen = new Set<string>();
  const merged: typeof byIcao = [];
  for (const t of [...byIcao, ...byNameOrManu]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    merged.push(t);
    if (merged.length >= 12) break;
  }

  return merged;
}
