'use server';

import { prisma, AircraftStatus } from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
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
const requireAirlineAdmin = requireAirlineManagerWithAirline;

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
  // Track 4 #85 (Section Q) — Aircraft-Photo. URL-validation analog
  // Airline.logoUrl. Max 2000 chars weil signed-CDN-URLs (S3, R2) lange
  // tokens enthalten können. Empty-string wird zu null bei save (clear-
  // photo-flow).
  photoUrl: z.string().url().max(2000).optional().or(z.literal('')),
});

export async function updateAircraft(formData: FormData) {
  const { airlineId } = await requireAirlineAdmin();

  const rawHome = String(formData.get('homeIcao') ?? '').trim();
  const rawPhoto = String(formData.get('photoUrl') ?? '').trim();
  const parsed = UpdateAircraftSchema.safeParse({
    aircraftId: String(formData.get('aircraftId') ?? ''),
    registration: String(formData.get('registration') ?? '').trim(),
    aircraftTypeId: String(formData.get('aircraftTypeId') ?? '').trim() || undefined,
    type: String(formData.get('type') ?? '').trim() || undefined,
    homeIcao: rawHome || undefined,
    photoUrl: rawPhoto || undefined,
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
      // Track 4 #85: photoUrl-update. Empty-string → null (admin hat das
      // URL-feld geleert, was "photo entfernen" bedeutet).
      photoUrl: parsed.data.photoUrl || null,
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

// ─────────────────────────────────────────────────────────────────────────
// CSV Bulk-Import (Welle 6 commit 6A-3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * CSV-row-schema. Alle felder sind strings (raw vom parser), validation +
 * type-coercion passieren pro row in bulkImportAircraft. Bewusst NICHT
 * mit AddAircraftSchema verkettet weil:
 *   1. CSV input ist permissiver (boolean/enum strings können in mehreren
 *      schreibweisen kommen — "ACTIVE"/"active"/"aktiv"/"1"/"true").
 *   2. Per-row error-aggregation statt fail-fast — eine kaputte row darf
 *      nicht 499 valide rows blocken.
 *   3. Catalog-resolve passiert in-memory aus pre-loaded list, nicht per
 *      query pro row (perf).
 */
const AircraftCsvRowSchema = z.object({
  registration: z.string().trim().min(1, 'registration fehlt'),
  type: z.string().trim().min(1, 'type fehlt'),
  home_icao: z.string().trim().optional().default(''),
  status: z.string().trim().optional().default(''),
});

export type AircraftImportRowResult = {
  rowIndex: number; // 1-based, header ist row 0
  status: 'created' | 'skipped' | 'error';
  registration?: string;
  message: string;
};

export type AircraftBulkImportResult = {
  ok: boolean;
  message: string;
  rows: AircraftImportRowResult[];
  summary: { created: number; skipped: number; errors: number };
};

/**
 * Permissive status-parser. Akzeptiert die canonical enum-werte (ACTIVE,
 * MAINTENANCE, STORED, RETIRED) plus deutsche/englische lowercase-aliasses.
 * Empty-string → ACTIVE als default (konsistent mit add-form).
 */
function parseAircraftStatus(v: string): AircraftStatus | null {
  const s = v.trim().toLowerCase();
  if (!s) return 'ACTIVE';
  const map: Record<string, AircraftStatus> = {
    active: 'ACTIVE',
    aktiv: 'ACTIVE',
    in_service: 'ACTIVE',
    'in service': 'ACTIVE',
    maintenance: 'MAINTENANCE',
    wartung: 'MAINTENANCE',
    maint: 'MAINTENANCE',
    stored: 'STORED',
    eingelagert: 'STORED',
    storage: 'STORED',
    retired: 'RETIRED',
    'außer dienst': 'RETIRED',
    'ausser dienst': 'RETIRED',
    inactive: 'RETIRED',
  };
  return map[s] ?? null;
}

const CSV_MAX_AIRCRAFT_ROWS = 500;

/**
 * Bulk-import von aircraft aus geparstem CSV (vom client als JS-array
 * geschickt). Server-action verifiziert auth, validiert per-row und
 * insertet alles was valide ist.
 *
 * Format (siehe /templates/aircraft-import-template.csv):
 *   registration,type,home_icao,status
 *   D-AIBC,B738,EDDF,ACTIVE
 *   D-AIBD,B738,EDDF,ACTIVE
 *   N12345,A20N,KJFK,MAINTENANCE
 *
 * Catalog-resolve: type wird als ICAO-exact-match gegen AircraftType-
 * catalog gemacht. Wenn match → aircraftTypeId wird gesetzt + type
 * normalized auf catalog-icaoType. Wenn kein match → free-text-fallback
 * (aircraftTypeId null, type bleibt was im CSV stand). Selbe semantik
 * wie das hybrid AircraftTypeAutocomplete-form.
 *
 * Skip-policy: registration existiert bereits irgendwo (egal ob in
 * eigener oder fremder airline) → skip mit hinweis. Re-imports eines
 * bereits importierten CSV sind idempotent (kein duplicate-error,
 * keine update-on-conflict).
 *
 * Bewusst KEINE transaction: wenn 480 von 500 valide sind, wollen wir die
 * 480 inserten. Admin korrigiert die 20 fehlerhaften und re-importiert.
 *
 * Performance:
 * - Existing registrations werden ALLE in einer query vorgeladen (statt
 *   pro row 1 lookup-query).
 * - Airports werden für die unique home_icaos im CSV in einer query
 *   gebatcht.
 * - AircraftTypes werden für die unique types im CSV in einer query
 *   gebatcht (case-insensitive über icaoType-uppercase).
 */
export async function bulkImportAircraft(
  rows: Array<Record<string, string>>,
): Promise<AircraftBulkImportResult> {
  const { airlineId } = await requireAirlineAdmin();

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: false,
      message: 'Keine zeilen im CSV gefunden.',
      rows: [],
      summary: { created: 0, skipped: 0, errors: 0 },
    };
  }

  if (rows.length > CSV_MAX_AIRCRAFT_ROWS) {
    return {
      ok: false,
      message: `Maximal ${CSV_MAX_AIRCRAFT_ROWS} aircraft pro CSV-import erlaubt (du hast ${rows.length} hochgeladen). Splitte die datei auf.`,
      rows: [],
      summary: { created: 0, skipped: 0, errors: 0 },
    };
  }

  // ─── Pre-fetch lookup-data (perf) ───
  // 1. Alle existing registrations (für skip-detection). Cross-airline weil
  //    Aircraft.registration ist global @unique — wir können fremde regs
  //    nicht überschreiben.
  const allRegs = await prisma.aircraft.findMany({
    select: { registration: true, airlineId: true },
  });
  const existingRegs = new Map<string, string>(
    allRegs.map((a) => [a.registration, a.airlineId]),
  );

  // 2. Unique home-icaos aus CSV → airport-lookup batchen.
  const homeIcaosInCsv = new Set<string>();
  for (const r of rows) {
    const code = String(r.home_icao ?? '').trim().toUpperCase();
    if (code) homeIcaosInCsv.add(code);
  }
  const airports =
    homeIcaosInCsv.size > 0
      ? await prisma.airport.findMany({
          where: { icao: { in: Array.from(homeIcaosInCsv) } },
          select: { icao: true, active: true, name: true },
        })
      : [];
  const airportByIcao = new Map(airports.map((a) => [a.icao, a]));

  // 3. Unique aircraft-types aus CSV → catalog-lookup batchen.
  const typesInCsv = new Set<string>();
  for (const r of rows) {
    const t = String(r.type ?? '').trim().toUpperCase();
    if (t) typesInCsv.add(t);
  }
  const catalogTypes =
    typesInCsv.size > 0
      ? await prisma.aircraftType.findMany({
          where: {
            icaoType: { in: Array.from(typesInCsv) },
            active: true,
          },
          select: { id: true, icaoType: true },
        })
      : [];
  const typeByIcao = new Map(catalogTypes.map((t) => [t.icaoType, t.id]));

  // ─── Per-row processing ───
  const results: AircraftImportRowResult[] = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1; // 1-based für user-display
    const raw = rows[i];

    // Schritt 1: shape-validation
    const parsed = AircraftCsvRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors++;
      const firstError = parsed.error.issues[0];
      results.push({
        rowIndex,
        status: 'error',
        message: `Zeile ${rowIndex}: ${firstError.message}`,
      });
      continue;
    }

    const row = parsed.data;
    const registration = row.registration.toUpperCase();

    // Schritt 2: registration-format
    if (!/^[A-Z0-9-]{2,10}$/.test(registration)) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        registration,
        message: `Zeile ${rowIndex}: Registration "${registration}" ungültig (2-10 zeichen, A-Z 0-9 und -).`,
      });
      continue;
    }

    // Schritt 3: skip wenn registration bereits existiert (egal welche
    // airline — global @unique).
    const existingOwner = existingRegs.get(registration);
    if (existingOwner) {
      skipped++;
      const ownerNote =
        existingOwner === airlineId
          ? 'in deiner Flotte'
          : 'bei anderer Airline';
      results.push({
        rowIndex,
        status: 'skipped',
        registration,
        message: `Zeile ${rowIndex}: ${registration} existiert bereits ${ownerNote} — übersprungen.`,
      });
      continue;
    }

    // Schritt 4: type-resolve (catalog-match oder free-text)
    const typeUpper = row.type.toUpperCase();
    if (typeUpper.length > 20) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        registration,
        message: `Zeile ${rowIndex}: Type "${typeUpper}" zu lang (max 20 zeichen).`,
      });
      continue;
    }
    const aircraftTypeId = typeByIcao.get(typeUpper) ?? null;
    // resolvedType: catalog-icaoType wenn match, sonst free-text uppercased
    const resolvedType = typeUpper;

    // Schritt 5: home_icao validieren wenn angegeben
    let homeIcao: string | null = null;
    if (row.home_icao.trim()) {
      const code = row.home_icao.trim().toUpperCase();
      if (!/^[A-Z0-9]{3,4}$/.test(code)) {
        errors++;
        results.push({
          rowIndex,
          status: 'error',
          registration,
          message: `Zeile ${rowIndex}: home_icao "${code}" hat ungültiges format (3-4 zeichen).`,
        });
        continue;
      }
      const ap = airportByIcao.get(code);
      if (!ap) {
        errors++;
        results.push({
          rowIndex,
          status: 'error',
          registration,
          message: `Zeile ${rowIndex}: Airport "${code}" nicht im Catalog.`,
        });
        continue;
      }
      if (!ap.active) {
        errors++;
        results.push({
          rowIndex,
          status: 'error',
          registration,
          message: `Zeile ${rowIndex}: Airport ${code} ist inaktiv (${ap.name}).`,
        });
        continue;
      }
      homeIcao = code;
    }

    // Schritt 6: status
    const status = parseAircraftStatus(row.status);
    if (status === null) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        registration,
        message: `Zeile ${rowIndex}: Status "${row.status}" ungültig (ACTIVE | MAINTENANCE | STORED | RETIRED).`,
      });
      continue;
    }

    // Schritt 7: insert
    try {
      await prisma.aircraft.create({
        data: {
          airlineId,
          registration,
          type: resolvedType,
          aircraftTypeId,
          homeIcao,
          status,
          // active-flag synchron mit status (siehe addAircraft).
          active: status === 'ACTIVE',
        },
      });
      // Zur dedup-map hinzufügen damit duplicate-rows IM SELBEN CSV gefangen
      // werden (zwei rows mit derselben registration → 1 created, 1 skipped).
      existingRegs.set(registration, airlineId);
      created++;
      results.push({
        rowIndex,
        status: 'created',
        registration,
        message: `Zeile ${rowIndex}: ${registration} (${resolvedType}${homeIcao ? `, ${homeIcao}` : ''}, ${status}) angelegt${aircraftTypeId ? ' [Catalog-verlinkt]' : ' [Free-Text]'}.`,
      });
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : 'unbekannter fehler';
      results.push({
        rowIndex,
        status: 'error',
        registration,
        message: `Zeile ${rowIndex}: DB-fehler — ${msg}`,
      });
    }
  }

  if (created > 0) {
    revalidatePath('/airline/aircraft');
    revalidatePath('/airline/fleet');
  }

  return {
    ok: created > 0 || (errors === 0 && skipped === 0),
    message:
      created > 0
        ? `${created} aircraft importiert${skipped > 0 ? `, ${skipped} übersprungen` : ''}${errors > 0 ? `, ${errors} fehler` : ''}.`
        : errors > 0
          ? `Keine aircraft importiert — ${errors} fehler${skipped > 0 ? `, ${skipped} übersprungen` : ''}.`
          : `Alle ${skipped} zeilen übersprungen (bereits vorhanden).`,
    rows: results,
    summary: { created, skipped, errors },
  };
}
