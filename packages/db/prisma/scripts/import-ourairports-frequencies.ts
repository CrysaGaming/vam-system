/**
 * OurAirports.com Frequencies Bulk Import
 * ========================================
 *
 * Importiert ~30k airport-frequencies (TWR, GND, APP, ATIS, etc) aus
 * airport-frequencies.csv. Idempotent via AirportFrequency.ourAirportsId.
 *
 * Datenquelle: https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv
 * License: public domain / CC0.
 *
 * Voraussetzung: Airports müssen schon importiert sein.
 *
 * Verwendung:
 *   pnpm --filter @vam/db exec dotenv -e ../../.env -- tsx \
 *     prisma/scripts/import-ourairports-frequencies.ts
 */

import { PrismaClient } from '@prisma/client';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

const FREQUENCIES_URL =
  'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv';
const BATCH_SIZE = 500;

const prisma = new PrismaClient();

interface FrequenciesRow {
  id: string;
  airport_ref: string;
  airport_ident: string;
  type: string;
  description: string;
  frequency_mhz: string;
}

function rowToFrequencyData(
  row: FrequenciesRow,
  validIcaos: Set<string>,
): {
  ourAirportsId: number;
  data: {
    airportIcao: string;
    type: string;
    description: string | null;
    frequencyMhz: number;
  };
} | null {
  const ourAirportsId = Number.parseInt(row.id, 10);
  if (Number.isNaN(ourAirportsId)) return null;

  const airportIcao = row.airport_ident?.trim();
  if (!airportIcao) return null;
  if (!validIcaos.has(airportIcao)) return null;

  const type = row.type?.trim();
  if (!type) return null;

  const freqMhz = Number.parseFloat(row.frequency_mhz);
  if (Number.isNaN(freqMhz)) return null;

  return {
    ourAirportsId,
    data: {
      airportIcao,
      type,
      description: row.description?.trim() || null,
      frequencyMhz: freqMhz,
    },
  };
}

async function downloadCsv(): Promise<string> {
  console.log(`📥 Lade CSV von ${FREQUENCIES_URL}...`);
  const start = Date.now();
  const response = await fetch(FREQUENCIES_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const sizeMb = (text.length / 1024 / 1024).toFixed(1);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ ${sizeMb} MB in ${elapsed}s heruntergeladen`);
  return text;
}

async function parseCsv(csvText: string): Promise<FrequenciesRow[]> {
  return new Promise((resolve, reject) => {
    const rows: FrequenciesRow[] = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    parser.on('readable', () => {
      let r: FrequenciesRow | null;
      while ((r = parser.read() as FrequenciesRow | null) !== null) rows.push(r);
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));
    Readable.from([csvText]).pipe(parser);
  });
}

async function importBatch(
  freqs: ReturnType<typeof rowToFrequencyData>[],
): Promise<number> {
  const valid = freqs.filter((f): f is NonNullable<typeof f> => f !== null);
  await prisma.$transaction(
    valid.map((f) =>
      prisma.airportFrequency.upsert({
        where: { ourAirportsId: f.ourAirportsId },
        create: { ourAirportsId: f.ourAirportsId, ...f.data },
        update: f.data,
      }),
    ),
    { timeout: 30000 },
  );
  return valid.length;
}

async function main() {
  console.log('📻 OurAirports.com Airport Frequencies Import\n');

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
    const batchData = batchRows.map((r) => rowToFrequencyData(r, validIcaos));
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
  console.log(`   ${totalOk.toLocaleString('de')} frequencies importiert`);
  console.log(`   ${totalSkipped.toLocaleString('de')} skipped`);

  const totalInDb = await prisma.airportFrequency.count();
  const byType = await prisma.airportFrequency.groupBy({
    by: ['type'],
    _count: true,
    orderBy: { _count: { type: 'desc' } },
    take: 10,
  });
  console.log(
    `\n📊 DB final: ${totalInDb.toLocaleString('de')} frequencies total`,
  );
  console.log('   Top 10 types:');
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
