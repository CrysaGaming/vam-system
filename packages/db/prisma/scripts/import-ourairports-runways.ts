/**
 * OurAirports.com Runways Bulk Import
 * ====================================
 *
 * Importiert alle ~50k runways aus dem OurAirports.com runways.csv. Idempotent
 * via Runway.ourAirportsId (CSV `id` column).
 *
 * Datenquelle: https://davidmegginson.github.io/ourairports-data/runways.csv
 * License: public domain / CC0.
 *
 * Verwendung:
 *   pnpm --filter @vam/db exec dotenv -e ../../.env -- tsx \
 *     prisma/scripts/import-ourairports-runways.ts
 *
 * Voraussetzung: Airports müssen schon importiert sein (FK-validation).
 * Runways die airport_ident referenzieren der nicht existiert werden geskippt.
 *
 * Performance: ~50k rows in batches von 500. Typisch <1min auf lokaler DB.
 */

import { PrismaClient } from '@prisma/client';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

const RUNWAYS_URL =
  'https://davidmegginson.github.io/ourairports-data/runways.csv';
const BATCH_SIZE = 500;

const prisma = new PrismaClient();

interface RunwaysRow {
  id: string;
  airport_ref: string;
  airport_ident: string;
  length_ft: string;
  width_ft: string;
  surface: string;
  lighted: string;
  closed: string;
  le_ident: string;
  le_latitude_deg: string;
  le_longitude_deg: string;
  le_elevation_ft: string;
  le_heading_degT: string;
  le_displaced_threshold_ft: string;
  he_ident: string;
  he_latitude_deg: string;
  he_longitude_deg: string;
  he_elevation_ft: string;
  he_heading_degT: string;
  he_displaced_threshold_ft: string;
}

function parseIntOrNull(v: string): number | null {
  if (!v?.trim()) return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function parseFloatOrNull(v: string): number | null {
  if (!v?.trim()) return null;
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function rowToRunwayData(
  row: RunwaysRow,
  validIcaos: Set<string>,
): {
  ourAirportsId: number;
  airportIcao: string;
  data: {
    airportIcao: string;
    lengthFt: number | null;
    widthFt: number | null;
    surface: string | null;
    lighted: boolean;
    closed: boolean;
    leIdent: string | null;
    leLatitude: number | null;
    leLongitude: number | null;
    leElevationFt: number | null;
    leHeadingDegT: number | null;
    leDisplacedFt: number | null;
    heIdent: string | null;
    heLatitude: number | null;
    heLongitude: number | null;
    heElevationFt: number | null;
    heHeadingDegT: number | null;
    heDisplacedFt: number | null;
  };
} | null {
  const ourAirportsId = Number.parseInt(row.id, 10);
  if (Number.isNaN(ourAirportsId)) return null;

  const airportIcao = row.airport_ident?.trim();
  if (!airportIcao) return null;
  if (!validIcaos.has(airportIcao)) return null; // Skip orphan runways

  return {
    ourAirportsId,
    airportIcao,
    data: {
      airportIcao,
      lengthFt: parseIntOrNull(row.length_ft),
      widthFt: parseIntOrNull(row.width_ft),
      surface: row.surface?.trim() || null,
      lighted: row.lighted?.trim() === '1',
      closed: row.closed?.trim() === '1',
      leIdent: row.le_ident?.trim() || null,
      leLatitude: parseFloatOrNull(row.le_latitude_deg),
      leLongitude: parseFloatOrNull(row.le_longitude_deg),
      leElevationFt: parseIntOrNull(row.le_elevation_ft),
      leHeadingDegT: parseFloatOrNull(row.le_heading_degT),
      leDisplacedFt: parseIntOrNull(row.le_displaced_threshold_ft),
      heIdent: row.he_ident?.trim() || null,
      heLatitude: parseFloatOrNull(row.he_latitude_deg),
      heLongitude: parseFloatOrNull(row.he_longitude_deg),
      heElevationFt: parseIntOrNull(row.he_elevation_ft),
      heHeadingDegT: parseFloatOrNull(row.he_heading_degT),
      heDisplacedFt: parseIntOrNull(row.he_displaced_threshold_ft),
    },
  };
}

async function downloadCsv(): Promise<string> {
  console.log(`📥 Lade CSV von ${RUNWAYS_URL}...`);
  const start = Date.now();
  const response = await fetch(RUNWAYS_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const sizeMb = (text.length / 1024 / 1024).toFixed(1);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ ${sizeMb} MB in ${elapsed}s heruntergeladen`);
  return text;
}

async function parseCsv(csvText: string): Promise<RunwaysRow[]> {
  return new Promise((resolve, reject) => {
    const rows: RunwaysRow[] = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    parser.on('readable', () => {
      let r: RunwaysRow | null;
      while ((r = parser.read() as RunwaysRow | null) !== null) rows.push(r);
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));
    Readable.from([csvText]).pipe(parser);
  });
}

async function importBatch(
  runways: ReturnType<typeof rowToRunwayData>[],
): Promise<number> {
  const valid = runways.filter((r): r is NonNullable<typeof r> => r !== null);
  await prisma.$transaction(
    valid.map((r) =>
      prisma.runway.upsert({
        where: { ourAirportsId: r.ourAirportsId },
        create: { ourAirportsId: r.ourAirportsId, ...r.data },
        update: r.data,
      }),
    ),
    { timeout: 30000 },
  );
  return valid.length;
}

async function main() {
  console.log('🛫 OurAirports.com Runways Import\n');

  // Load valid airport ICAOs once for FK-pre-validation
  console.log('🔍 Lade airport ICAOs aus DB...');
  const airports = await prisma.airport.findMany({ select: { icao: true } });
  const validIcaos = new Set(airports.map((a) => a.icao));
  console.log(`✓ ${validIcaos.size.toLocaleString('de')} valide ICAOs\n`);

  const csvText = await downloadCsv();

  console.log('🔍 Parse CSV...');
  const parseStart = Date.now();
  const rows = await parseCsv(csvText);
  console.log(
    `✓ ${rows.length.toLocaleString('de')} rows in ${((Date.now() - parseStart) / 1000).toFixed(1)}s\n`,
  );

  console.log(`💾 Importiere in Batches von ${BATCH_SIZE}...`);
  const importStart = Date.now();
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
  let totalOk = 0;
  let totalSkipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batchRows = rows.slice(i, i + BATCH_SIZE);
    const batchData = batchRows.map((r) => rowToRunwayData(r, validIcaos));
    const ok = await importBatch(batchData);
    totalOk += ok;
    totalSkipped += batchRows.length - ok;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      const pct = ((batchNum / totalBatches) * 100).toFixed(0);
      const elapsed = ((Date.now() - importStart) / 1000).toFixed(0);
      console.log(
        `  Batch ${batchNum}/${totalBatches} (${pct}%) — ${totalOk} ok, ${totalSkipped} skipped — ${elapsed}s`,
      );
    }
  }

  const totalElapsed = ((Date.now() - importStart) / 1000).toFixed(1);
  console.log(`\n✅ Import fertig in ${totalElapsed}s`);
  console.log(`   ${totalOk.toLocaleString('de')} runways importiert`);
  console.log(
    `   ${totalSkipped.toLocaleString('de')} skipped (orphan FK oder invalid id)`,
  );

  const totalInDb = await prisma.runway.count();
  console.log(`\n📊 DB final: ${totalInDb.toLocaleString('de')} runways total`);
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
