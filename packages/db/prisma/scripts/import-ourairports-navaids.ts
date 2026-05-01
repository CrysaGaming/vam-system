/**
 * OurAirports.com Navaids Bulk Import
 * ====================================
 *
 * Importiert ~13k navaids (VOR, NDB, ILS, DME, etc) aus navaids.csv.
 * Idempotent via Navaid.ourAirportsId.
 *
 * Datenquelle: https://davidmegginson.github.io/ourairports-data/navaids.csv
 * License: public domain / CC0.
 *
 * FK-handling: associated_airport ist optional. Wenn der referenzierte ICAO
 * in DB nicht existiert → wird auf null gesetzt (statt skip), damit der
 * navaid trotzdem importiert wird (die meisten en-route navaids haben kein
 * associated airport).
 *
 * Verwendung:
 *   pnpm --filter @vam/db exec dotenv -e ../../.env -- tsx \
 *     prisma/scripts/import-ourairports-navaids.ts
 */

import { PrismaClient } from '@prisma/client';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

const NAVAIDS_URL =
  'https://davidmegginson.github.io/ourairports-data/navaids.csv';
const BATCH_SIZE = 500;

const prisma = new PrismaClient();

interface NavaidsRow {
  id: string;
  filename: string;
  ident: string;
  name: string;
  type: string;
  frequency_khz: string;
  latitude_deg: string;
  longitude_deg: string;
  elevation_ft: string;
  iso_country: string;
  dme_frequency_khz: string;
  dme_channel: string;
  dme_latitude_deg: string;
  dme_longitude_deg: string;
  dme_elevation_ft: string;
  slaved_variation_deg: string;
  magnetic_variation_deg: string;
  usageType: string;
  power: string;
  associated_airport: string;
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

function rowToNavaidData(
  row: NavaidsRow,
  validIcaos: Set<string>,
): {
  ourAirportsId: number;
  data: {
    ident: string;
    name: string;
    type: string;
    frequencyKhz: number | null;
    latitude: number;
    longitude: number;
    elevationFt: number | null;
    isoCountry: string;
    dmeFrequencyKhz: number | null;
    dmeChannel: string | null;
    dmeLatitude: number | null;
    dmeLongitude: number | null;
    dmeElevationFt: number | null;
    slavedVariationDeg: number | null;
    magneticVariationDeg: number | null;
    usageType: string | null;
    power: string | null;
    associatedAirportIcao: string | null;
  };
} | null {
  const ourAirportsId = Number.parseInt(row.id, 10);
  if (Number.isNaN(ourAirportsId)) return null;

  const ident = row.ident?.trim();
  const name = row.name?.trim();
  const type = row.type?.trim();
  if (!ident || !name || !type) return null;

  const lat = Number.parseFloat(row.latitude_deg);
  const lon = Number.parseFloat(row.longitude_deg);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const associated = row.associated_airport?.trim();
  // Wenn associated airport in DB nicht existiert → auf null setzen
  // (nicht skip — viele en-route navaids haben kein associated)
  const associatedAirportIcao =
    associated && validIcaos.has(associated) ? associated : null;

  return {
    ourAirportsId,
    data: {
      ident,
      name,
      type,
      frequencyKhz: parseIntOrNull(row.frequency_khz),
      latitude: lat,
      longitude: lon,
      elevationFt: parseIntOrNull(row.elevation_ft),
      isoCountry: row.iso_country?.trim() || 'XX',
      dmeFrequencyKhz: parseIntOrNull(row.dme_frequency_khz),
      dmeChannel: row.dme_channel?.trim() || null,
      dmeLatitude: parseFloatOrNull(row.dme_latitude_deg),
      dmeLongitude: parseFloatOrNull(row.dme_longitude_deg),
      dmeElevationFt: parseIntOrNull(row.dme_elevation_ft),
      slavedVariationDeg: parseFloatOrNull(row.slaved_variation_deg),
      magneticVariationDeg: parseFloatOrNull(row.magnetic_variation_deg),
      usageType: row.usageType?.trim() || null,
      power: row.power?.trim() || null,
      associatedAirportIcao,
    },
  };
}

async function downloadCsv(): Promise<string> {
  console.log(`📥 Lade CSV von ${NAVAIDS_URL}...`);
  const start = Date.now();
  const response = await fetch(NAVAIDS_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const sizeMb = (text.length / 1024 / 1024).toFixed(1);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ ${sizeMb} MB in ${elapsed}s heruntergeladen`);
  return text;
}

async function parseCsv(csvText: string): Promise<NavaidsRow[]> {
  return new Promise((resolve, reject) => {
    const rows: NavaidsRow[] = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    parser.on('readable', () => {
      let r: NavaidsRow | null;
      while ((r = parser.read() as NavaidsRow | null) !== null) rows.push(r);
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));
    Readable.from([csvText]).pipe(parser);
  });
}

async function importBatch(
  navaids: ReturnType<typeof rowToNavaidData>[],
): Promise<number> {
  const valid = navaids.filter((n): n is NonNullable<typeof n> => n !== null);
  await prisma.$transaction(
    valid.map((n) =>
      prisma.navaid.upsert({
        where: { ourAirportsId: n.ourAirportsId },
        create: { ourAirportsId: n.ourAirportsId, ...n.data },
        update: n.data,
      }),
    ),
    { timeout: 30000 },
  );
  return valid.length;
}

async function main() {
  console.log('📡 OurAirports.com Navaids Import\n');

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
    const batchData = batchRows.map((r) => rowToNavaidData(r, validIcaos));
    const ok = await importBatch(batchData);
    totalOk += ok;
    totalSkipped += batchRows.length - ok;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    if (batchNum % 5 === 0 || batchNum === totalBatches) {
      const pct = ((batchNum / totalBatches) * 100).toFixed(0);
      const elapsed = ((Date.now() - importStart) / 1000).toFixed(0);
      console.log(
        `  Batch ${batchNum}/${totalBatches} (${pct}%) — ${totalOk} ok, ${totalSkipped} skipped — ${elapsed}s`,
      );
    }
  }

  const totalElapsed = ((Date.now() - importStart) / 1000).toFixed(1);
  console.log(`\n✅ Import fertig in ${totalElapsed}s`);
  console.log(`   ${totalOk.toLocaleString('de')} navaids importiert`);
  console.log(`   ${totalSkipped.toLocaleString('de')} skipped`);

  const totalInDb = await prisma.navaid.count();
  const byType = await prisma.navaid.groupBy({
    by: ['type'],
    _count: true,
    orderBy: { _count: { type: 'desc' } },
  });
  console.log(`\n📊 DB final: ${totalInDb.toLocaleString('de')} navaids total`);
  console.log('   Type breakdown:');
  byType.forEach((t) => console.log(`   ${t.type.padEnd(12)} ${t._count}`));
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
