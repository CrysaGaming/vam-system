'use server';

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { haversineKm } from '@/lib/flight-phase';

/**
 * Airline-routes management server-actions. Mirror der policy aus
 * airline/actions.ts: gleiche AIRLINE_MANAGER_ROLES (admin, airline-admin,
 * instructor) und gleiches require-airline-admin-pattern. Bewusst KEINE
 * import-deduplizierung — der helper bleibt private pro file weil 'use
 * server' jede exportierte funktion zu einem RPC-endpoint macht. Wenn
 * requireAirlineAdmin aus airline/actions.ts geexportiert würde, wäre er
 * accidentally callable als action.
 */
const requireAirlineAdmin = requireAirlineManagerWithAirline;

// ─────────────────────────────────────────────────────────────────────────
// Distance helper — km → NM conversion
// ─────────────────────────────────────────────────────────────────────────

/**
 * Berechnet great-circle-distanz zwischen zwei airports in nautical miles.
 * Aviation-standard ist NM, weil flight-planning + speeds (knots = NM/h)
 * darauf basieren. haversineKm ist exact genug für route-distanzen
 * (innerhalb ~0.5% vs WGS84-ellipsoid). 1 NM = 1.852 km.
 *
 * Für 0-distanz (selber airport) returnt 0 — die downstream-validation
 * lehnt das eh ab (dep ≠ arr).
 */
function calculateDistanceNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const km = haversineKm(lat1, lon1, lat2, lon2);
  return Math.round(km * 0.539957);
}

/**
 * Schätzt flugzeit in minuten basierend auf distanz + cruise-speed.
 * 450 kt ist mittelwert für narrow-body cruise — schnell genug für
 * grobe schätzung, langsam genug dass die zeit bei kurzstrecke nicht
 * unrealistisch klein wird (climb + descent eat ~15-20 min). Plus
 * 25 min taxi-out + climb + descent + taxi-in als fixer overhead.
 *
 * Real-world wären die zeiten airline-/aircraft-/route-spezifisch
 * (LH918 fliegt ein A320 mit ~37 min block-time für FRA-MUC), aber
 * für admin-default reicht die heuristik. Admin kann den wert immer
 * manuell überschreiben.
 */
function estimateMinutes(distanceNm: number): number {
  const cruiseMinutes = (distanceNm / 450) * 60;
  return Math.round(cruiseMinutes + 25);
}

// ─────────────────────────────────────────────────────────────────────────
// Airport search (für autocomplete)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sucht airports per ICAO/IATA/name/city-fragment für die autocomplete-
 * component. Limited auf 20 results damit dropdown nicht overflowed.
 *
 * Sortier-strategie: ICAO-prefix-match wird zuerst gezeigt (ein admin
 * der "EDDF" tippt erwartet Frankfurt zuerst, nicht Edmonton), dann
 * IATA-match, dann name/city-match. Prisma kann das nicht ohne raw-sql
 * — daher 3 separate queries und in-memory merging mit dedup.
 *
 * Filter: scheduledService=true bevorzugt aber nicht erzwungen — manche
 * VAs fliegen auch zu kleinen airports (training-flights, GA-stops,
 * historical-routes). Wenn admin spezifisch nach einem closed/heliport
 * sucht, soll er das finden können.
 */
export async function searchAirports(query: string) {
  await requireAirlineAdmin();

  const trimmed = query.trim().toUpperCase();
  if (trimmed.length < 2) return [];

  // Wir machen 3 queries in parallel und mergen die results client-side.
  // Pro query limit 20, dann dedup + slice auf 20 final. Bei sehr
  // populären queries wie "FRA" könnte man die queries spezifischer
  // machen (icao-only first, fallback nur wenn <5 results) — das ist
  // future-optimization wenn die latenz tatsächlich problem wird.
  const [byIcao, byIata, byNameOrCity] = await Promise.all([
    prisma.airport.findMany({
      where: { icao: { startsWith: trimmed } },
      orderBy: [{ scheduledService: 'desc' }, { icao: 'asc' }],
      take: 20,
      select: {
        id: true,
        icao: true,
        iata: true,
        name: true,
        city: true,
        country: true,
        latitude: true,
        longitude: true,
      },
    }),
    prisma.airport.findMany({
      where: { iata: trimmed.length === 3 ? trimmed : { startsWith: trimmed } },
      orderBy: [{ scheduledService: 'desc' }, { iata: 'asc' }],
      take: 20,
      select: {
        id: true,
        icao: true,
        iata: true,
        name: true,
        city: true,
        country: true,
        latitude: true,
        longitude: true,
      },
    }),
    prisma.airport.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { city: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ scheduledService: 'desc' }, { name: 'asc' }],
      take: 20,
      select: {
        id: true,
        icao: true,
        iata: true,
        name: true,
        city: true,
        country: true,
        latitude: true,
        longitude: true,
      },
    }),
  ]);

  // Dedup per id, ICAO-matches first, dann IATA, dann name/city.
  const seen = new Set<string>();
  const merged: typeof byIcao = [];
  for (const list of [byIcao, byIata, byNameOrCity]) {
    for (const ap of list) {
      if (!seen.has(ap.id)) {
        seen.add(ap.id);
        merged.push(ap);
        if (merged.length >= 20) break;
      }
    }
    if (merged.length >= 20) break;
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────
// Create route
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validation-schema für create + update. flightNumber ist regex-validiert
 * (ICAO-format: 2-3 letter code + 1-4 digit + optional suffix-letter, z.B.
 * "LH918", "BA2761A", "AAL100"). Loose enough für VA-fantasy-numbers wie
 * "VAM999" but strict enough um obvious typos zu catchen.
 *
 * Aircraft-type ist optional + uppercase: ICAO doc-8643 designators sind
 * 3-4 char alphanumeric (B738, A20N, A359, CRJ9). Loose validation weil
 * wir nicht gegen den catalog erzwingen — admin soll auch unkatalogisierte
 * typen eintragen können.
 *
 * Distance + duration werden auto-berechnet wenn null — die schema
 * verlangt beide Int-required, aber das form lässt admin sie leer.
 */
const RouteInputSchema = z.object({
  flightNumber: z
    .string()
    .min(3, 'Flugnummer zu kurz')
    .max(8, 'Flugnummer zu lang')
    .regex(/^[A-Z]{2,3}\d{1,4}[A-Z]?$/, 'Format: 2-3 buchstaben + 1-4 zahlen + optional suffix'),
  departureId: z.string().min(1, 'Abflughafen erforderlich'),
  arrivalId: z.string().min(1, 'Zielflughafen erforderlich'),
  aircraftTypeIcao: z
    .string()
    .regex(/^[A-Z0-9]{3,4}$/, 'ICAO-type: 3-4 zeichen, A-Z + 0-9 (z.B. B738, A20N)')
    .optional()
    .or(z.literal('')),
  estimatedMinutes: z.coerce.number().int().min(1).max(2000).optional().or(z.nan()),
  distanceNm: z.coerce.number().int().min(1).max(15000).optional().or(z.nan()),
  active: z.coerce.boolean().default(true),
});

export type RouteFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export async function createRoute(
  _prev: RouteFormState | null,
  formData: FormData,
): Promise<RouteFormState> {
  const { airlineId } = await requireAirlineAdmin();

  const raw = {
    flightNumber: String(formData.get('flightNumber') ?? '').trim().toUpperCase(),
    departureId: String(formData.get('departureId') ?? ''),
    arrivalId: String(formData.get('arrivalId') ?? ''),
    aircraftTypeIcao: String(formData.get('aircraftTypeIcao') ?? '').trim().toUpperCase(),
    estimatedMinutes: formData.get('estimatedMinutes') || undefined,
    distanceNm: formData.get('distanceNm') || undefined,
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
  };

  const parsed = RouteInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: 'Bitte korrigiere die markierten felder.', fieldErrors };
  }

  const data = parsed.data;

  // Same-airport-validation. Schema kann das nicht ausdrücken (zwei FKs
  // auf dieselbe table), also app-level enforcement.
  if (data.departureId === data.arrivalId) {
    return {
      ok: false,
      message: 'Abflug- und Zielflughafen müssen unterschiedlich sein.',
      fieldErrors: { arrivalId: 'Muss ein anderer airport als der abflug sein' },
    };
  }

  // Airports laden für distance-calc + existence-check.
  const [departure, arrival] = await Promise.all([
    prisma.airport.findUnique({ where: { id: data.departureId } }),
    prisma.airport.findUnique({ where: { id: data.arrivalId } }),
  ]);

  if (!departure || !arrival) {
    return { ok: false, message: 'Einer der ausgewählten airports existiert nicht.' };
  }

  // Auto-calc wenn nicht gesetzt. NaN check weil zod's coerce.number()
  // bei leeren strings NaN zurückgibt (nicht undefined).
  const distanceNm =
    data.distanceNm && !isNaN(data.distanceNm)
      ? data.distanceNm
      : calculateDistanceNm(
          departure.latitude,
          departure.longitude,
          arrival.latitude,
          arrival.longitude,
        );

  const estimatedMinutes =
    data.estimatedMinutes && !isNaN(data.estimatedMinutes)
      ? data.estimatedMinutes
      : estimateMinutes(distanceNm);

  // Unique-constraint check vor insert für sauberere fehlermeldung.
  // Der DB-constraint @@unique([airlineId, flightNumber]) würde es eh
  // catchen, aber generic prisma-error ist schwer für UI.
  const existing = await prisma.route.findUnique({
    where: { airlineId_flightNumber: { airlineId, flightNumber: data.flightNumber } },
  });
  if (existing) {
    return {
      ok: false,
      message: `Flugnummer ${data.flightNumber} existiert bereits in deiner airline.`,
      fieldErrors: { flightNumber: 'Bereits vergeben' },
    };
  }

  await prisma.route.create({
    data: {
      airlineId,
      flightNumber: data.flightNumber,
      departureId: data.departureId,
      arrivalId: data.arrivalId,
      aircraftTypeIcao: data.aircraftTypeIcao || null,
      estimatedMinutes,
      distanceNm,
      active: data.active,
    },
  });

  revalidatePath('/airline/routes');
  revalidatePath('/routes');

  return { ok: true, message: `Route ${data.flightNumber} angelegt.` };
}

// ─────────────────────────────────────────────────────────────────────────
// Update route
// ─────────────────────────────────────────────────────────────────────────

export async function updateRoute(
  routeId: string,
  _prev: RouteFormState | null,
  formData: FormData,
): Promise<RouteFormState> {
  const { airlineId } = await requireAirlineAdmin();

  // Ownership-check: route muss zur airline des admins gehören. Verhindert
  // dass ein airline-admin von airline A versehentlich eine route von
  // airline B editiert (z.B. via direct-URL-manipulation /airline/routes/
  // <foreign-id>/edit).
  const existing = await prisma.route.findUnique({ where: { id: routeId } });
  if (!existing || existing.airlineId !== airlineId) {
    return { ok: false, message: 'Diese route gehört nicht zu deiner airline.' };
  }

  const raw = {
    flightNumber: String(formData.get('flightNumber') ?? '').trim().toUpperCase(),
    departureId: String(formData.get('departureId') ?? ''),
    arrivalId: String(formData.get('arrivalId') ?? ''),
    aircraftTypeIcao: String(formData.get('aircraftTypeIcao') ?? '').trim().toUpperCase(),
    estimatedMinutes: formData.get('estimatedMinutes') || undefined,
    distanceNm: formData.get('distanceNm') || undefined,
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
  };

  const parsed = RouteInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: 'Bitte korrigiere die markierten felder.', fieldErrors };
  }

  const data = parsed.data;

  if (data.departureId === data.arrivalId) {
    return {
      ok: false,
      message: 'Abflug- und Zielflughafen müssen unterschiedlich sein.',
      fieldErrors: { arrivalId: 'Muss ein anderer airport als der abflug sein' },
    };
  }

  const [departure, arrival] = await Promise.all([
    prisma.airport.findUnique({ where: { id: data.departureId } }),
    prisma.airport.findUnique({ where: { id: data.arrivalId } }),
  ]);

  if (!departure || !arrival) {
    return { ok: false, message: 'Einer der ausgewählten airports existiert nicht.' };
  }

  const distanceNm =
    data.distanceNm && !isNaN(data.distanceNm)
      ? data.distanceNm
      : calculateDistanceNm(
          departure.latitude,
          departure.longitude,
          arrival.latitude,
          arrival.longitude,
        );

  const estimatedMinutes =
    data.estimatedMinutes && !isNaN(data.estimatedMinutes)
      ? data.estimatedMinutes
      : estimateMinutes(distanceNm);

  // Wenn flightNumber geändert wurde, unique-check gegen neue nummer.
  if (data.flightNumber !== existing.flightNumber) {
    const conflict = await prisma.route.findUnique({
      where: { airlineId_flightNumber: { airlineId, flightNumber: data.flightNumber } },
    });
    if (conflict) {
      return {
        ok: false,
        message: `Flugnummer ${data.flightNumber} existiert bereits in deiner airline.`,
        fieldErrors: { flightNumber: 'Bereits vergeben' },
      };
    }
  }

  await prisma.route.update({
    where: { id: routeId },
    data: {
      flightNumber: data.flightNumber,
      departureId: data.departureId,
      arrivalId: data.arrivalId,
      aircraftTypeIcao: data.aircraftTypeIcao || null,
      estimatedMinutes,
      distanceNm,
      active: data.active,
    },
  });

  revalidatePath('/airline/routes');
  revalidatePath('/routes');

  return { ok: true, message: `Route ${data.flightNumber} aktualisiert.` };
}

// ─────────────────────────────────────────────────────────────────────────
// Delete route (soft via active=false oder hard wenn nicht referenziert)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Löscht route hart wenn keine PIREPs/bookings referenzieren, sonst
 * soft (active=false). Hard-delete + FK-restrict wäre die strikte
 * variante (Booking.routeId hat onDelete: Restrict default), aber das
 * würde aus user-sicht als "geht nicht" durchgehen ohne erklärung.
 *
 * Soft-delete ist hier UX-besser: route verschwindet aus der active-
 * liste, bleibt aber via PIREP/booking-history sichtbar. Reactivate
 * geht über das edit-form (active checkbox).
 */
export async function deleteRoute(routeId: string): Promise<RouteFormState> {
  const { airlineId } = await requireAirlineAdmin();

  const existing = await prisma.route.findUnique({
    where: { id: routeId },
    include: { _count: { select: { pireps: true, bookings: true } } },
  });

  if (!existing || existing.airlineId !== airlineId) {
    return { ok: false, message: 'Diese route gehört nicht zu deiner airline.' };
  }

  const hasReferences = existing._count.pireps > 0 || existing._count.bookings > 0;

  if (hasReferences) {
    // Soft-delete: route bleibt in der DB, aber inactive. PIREPs/bookings
    // behalten ihre referenz und der historische kontext bleibt intakt.
    await prisma.route.update({
      where: { id: routeId },
      data: { active: false },
    });
    revalidatePath('/airline/routes');
    revalidatePath('/routes');
    return {
      ok: true,
      message: `Route ${existing.flightNumber} deaktiviert (existing PIREPs/bookings — kein hard-delete).`,
    };
  }

  // Hard-delete safe — keine FKs. Booking-restrict-default greift hier
  // nicht weil _count.bookings === 0.
  await prisma.route.delete({ where: { id: routeId } });
  revalidatePath('/airline/routes');
  revalidatePath('/routes');
  return { ok: true, message: `Route ${existing.flightNumber} gelöscht.` };
}

// ============================================================================
// CSV-Bulk-Import
// ============================================================================

/**
 * CSV-row-schema (raw aus parser, alle felder strings). Wir validieren
 * NICHT mit RouteInputSchema direkt weil:
 *  1. Im CSV gibt der user ICAO-codes für airports (LSZH), nicht IDs.
 *     Wir müssen erst zur airport-ID resolven bevor wir RouteInputSchema
 *     anwenden können.
 *  2. Wir wollen permissive boolean-parsing ("ja"/"nein"/"yes"/"1"/"true"
 *     etc.) statt strikt — Excel exportiert je nach locale anders.
 *  3. Per-row error-aggregation statt fail-fast — eine kaputte row darf
 *     nicht 499 valide rows blocken.
 */
const CsvRowSchema = z.object({
  flight_number: z.string().trim().min(1, 'flight_number fehlt'),
  departure_icao: z.string().trim().min(1, 'departure_icao fehlt'),
  arrival_icao: z.string().trim().min(1, 'arrival_icao fehlt'),
  aircraft_type: z.string().trim().optional().default(''),
  estimated_minutes: z.string().trim().optional().default(''),
  distance_nm: z.string().trim().optional().default(''),
  active: z.string().trim().optional().default('true'),
});

export type ImportRowResult = {
  rowIndex: number; // 1-based, header ist row 0
  status: 'created' | 'skipped' | 'error';
  flightNumber?: string;
  message: string;
};

export type BulkImportResult = {
  ok: boolean;
  message: string;
  rows: ImportRowResult[];
  summary: { created: number; skipped: number; errors: number };
};

/**
 * Parse-helpers für CSV-felder die strings sind aber als zahlen/booleans
 * interpretiert werden müssen. Permissive — der airline-admin soll nicht
 * scheitern weil Excel "Wahr" statt "true" geschrieben hat.
 */
function parseCsvBoolean(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (!s) return true; // empty default → active
  return ['true', '1', 'ja', 'yes', 'y', 'wahr', 'aktiv', 'active'].includes(s);
}

function parseCsvInt(v: string): number | undefined {
  const s = v.trim();
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve airport via ICAO (primary, eindeutig) oder IATA (fallback,
 * falls ICAO leer war oder user IATA-code geschickt hat). ICAO-codes sind
 * 4 zeichen, IATA 3 — wir nutzen länge als hint für die suchreihenfolge,
 * aber probieren immer beide damit "LSZH" und "ZRH" beide funktionieren.
 */
async function resolveAirportFromCode(code: string) {
  const upper = code.trim().toUpperCase();
  if (!upper) return null;

  // Erst ICAO probieren (immer eindeutig). Dann IATA wenn nichts gefunden.
  const byIcao = await prisma.airport.findUnique({ where: { icao: upper } });
  if (byIcao) return byIcao;

  if (upper.length === 3) {
    // IATA ist nicht unique in der DB (historische codes können duplikate
    // haben), also nehmen wir den ersten match. In 99% der fälle eindeutig.
    return prisma.airport.findFirst({ where: { iata: upper } });
  }
  return null;
}

const CSV_MAX_ROWS = 500;

/**
 * Bulk-import von routes aus geparstem CSV (vom client als JS-array
 * geschickt). Server-action verifiziert auth, validiert per-row und
 * insertet alles was valide ist. Errors werden pro row aggregiert
 * statt fail-fast — der admin sieht eine vollständige report-tabelle.
 *
 * Bewusst KEINE transaction: wenn 480 von 500 routes valide sind, wollen
 * wir die 480 inserten. Der admin korrigiert die 20 fehlerhaften und
 * importiert sie in einem zweiten run.
 *
 * Skip statt error wenn flight-number bereits existiert — re-imports
 * eines bereits importierten CSV sollen idempotent sein, nicht
 * 500x "duplicate" werfen. Update-on-conflict wäre auch eine option,
 * ist aber riskanter (silent overwrite); skip ist konservativer.
 */
export async function bulkImportRoutes(
  rows: Array<Record<string, string>>,
): Promise<BulkImportResult> {
  const { airlineId } = await requireAirlineAdmin();

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: false,
      message: 'Keine zeilen im CSV gefunden.',
      rows: [],
      summary: { created: 0, skipped: 0, errors: 0 },
    };
  }

  if (rows.length > CSV_MAX_ROWS) {
    return {
      ok: false,
      message: `Maximal ${CSV_MAX_ROWS} routes pro CSV-import erlaubt (du hast ${rows.length} hochgeladen). Splitte die datei auf.`,
      rows: [],
      summary: { created: 0, skipped: 0, errors: 0 },
    };
  }

  const results: ImportRowResult[] = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;

  // Existing flight-numbers für skip-detection vor-laden (1 query statt
  // N queries). Performance: bei 500 rows × 1 query = 500 round-trips
  // sonst, was bei remote-DBs significant ist.
  const existingRoutes = await prisma.route.findMany({
    where: { airlineId },
    select: { flightNumber: true },
  });
  const existingFlightNumbers = new Set(existingRoutes.map((r) => r.flightNumber));

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1; // 1-based für user-display
    const raw = rows[i];

    // Schritt 1: shape-validation
    const parsed = CsvRowSchema.safeParse(raw);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        message: `Zeile ${rowIndex}: ${firstError.message}`,
      });
      continue;
    }

    const row = parsed.data;
    const flightNumber = row.flight_number.toUpperCase();

    // Schritt 2: flight-number-format
    if (!/^[A-Z]{2,3}\d{1,4}[A-Z]?$/.test(flightNumber)) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        flightNumber,
        message: `Zeile ${rowIndex}: Flugnummer "${flightNumber}" ungültig (format: 2-3 buchstaben + 1-4 zahlen, z.B. KK101).`,
      });
      continue;
    }

    // Schritt 3: skip wenn bereits existiert
    if (existingFlightNumbers.has(flightNumber)) {
      skipped++;
      results.push({
        rowIndex,
        status: 'skipped',
        flightNumber,
        message: `Zeile ${rowIndex}: ${flightNumber} existiert bereits — übersprungen.`,
      });
      continue;
    }

    // Schritt 4: airports resolven
    const [departure, arrival] = await Promise.all([
      resolveAirportFromCode(row.departure_icao),
      resolveAirportFromCode(row.arrival_icao),
    ]);

    if (!departure) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        flightNumber,
        message: `Zeile ${rowIndex}: Abflughafen "${row.departure_icao}" nicht gefunden (ICAO oder IATA).`,
      });
      continue;
    }
    if (!arrival) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        flightNumber,
        message: `Zeile ${rowIndex}: Zielflughafen "${row.arrival_icao}" nicht gefunden (ICAO oder IATA).`,
      });
      continue;
    }
    if (departure.id === arrival.id) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        flightNumber,
        message: `Zeile ${rowIndex}: Abflug- und Zielflughafen identisch (${departure.icao}).`,
      });
      continue;
    }

    // Schritt 5: aircraft-type validieren wenn angegeben
    const aircraftTypeIcao = row.aircraft_type.toUpperCase().trim();
    if (aircraftTypeIcao && !/^[A-Z0-9]{3,4}$/.test(aircraftTypeIcao)) {
      errors++;
      results.push({
        rowIndex,
        status: 'error',
        flightNumber,
        message: `Zeile ${rowIndex}: Aircraft-type "${aircraftTypeIcao}" ungültig (3-4 zeichen ICAO, z.B. B738, A20N).`,
      });
      continue;
    }

    // Schritt 6: distance + duration auto-calc wenn leer
    let distanceNm = parseCsvInt(row.distance_nm);
    let estimatedMinutes = parseCsvInt(row.estimated_minutes);

    if (distanceNm === undefined) {
      const km = haversineKm(
        departure.latitude,
        departure.longitude,
        arrival.latitude,
        arrival.longitude,
      );
      distanceNm = Math.round(km * 0.539957);
    }
    if (estimatedMinutes === undefined) {
      // 450kt cruise + 25min taxi/climb/descent overhead
      estimatedMinutes = Math.round((distanceNm / 450) * 60 + 25);
    }

    // Schritt 7: insert
    try {
      await prisma.route.create({
        data: {
          airlineId,
          flightNumber,
          departureId: departure.id,
          arrivalId: arrival.id,
          aircraftTypeIcao: aircraftTypeIcao || null,
          distanceNm,
          estimatedMinutes,
          active: parseCsvBoolean(row.active),
        },
      });
      existingFlightNumbers.add(flightNumber); // dedup im selben CSV
      created++;
      results.push({
        rowIndex,
        status: 'created',
        flightNumber,
        message: `Zeile ${rowIndex}: ${flightNumber} (${departure.icao}→${arrival.icao}) angelegt.`,
      });
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : 'unbekannter fehler';
      results.push({
        rowIndex,
        status: 'error',
        flightNumber,
        message: `Zeile ${rowIndex}: DB-fehler — ${msg}`,
      });
    }
  }

  if (created > 0) {
    revalidatePath('/airline/routes');
    revalidatePath('/routes');
  }

  return {
    ok: created > 0 || (errors === 0 && skipped === 0),
    message:
      created > 0
        ? `${created} routes importiert${skipped > 0 ? `, ${skipped} übersprungen` : ''}${errors > 0 ? `, ${errors} fehler` : ''}.`
        : errors > 0
          ? `Keine routes importiert — ${errors} fehler${skipped > 0 ? `, ${skipped} übersprungen` : ''}.`
          : `Alle ${skipped} zeilen übersprungen (bereits vorhanden).`,
    rows: results,
    summary: { created, skipped, errors },
  };
}
