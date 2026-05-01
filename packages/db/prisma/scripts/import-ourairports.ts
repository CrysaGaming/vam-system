/**
 * OurAirports.com Bulk Import Script
 * ===================================
 *
 * Importiert den vollständigen OurAirports.com CSV-datensatz (~85k airports)
 * in die VAM-DB. Idempotent — kann beliebig oft laufen, upsertet auf icao.
 *
 * Datenquelle: https://davidmegginson.github.io/ourairports-data/airports.csv
 * (täglich aktualisierter mirror des offiziellen ourairports.com CSV-feeds.
 * License: public domain / CC0.)
 *
 * Verwendung:
 *   pnpm --filter @vam/db exec dotenv -e ../../.env -- tsx prisma/scripts/import-ourairports.ts
 *
 * CSV-zu-DB-mapping:
 *   ourairports.ident       → Airport.icao   (primary identifier; manche
 *                                              "ICAO"-werte sind faktisch local
 *                                              codes wie "00A" für US small
 *                                              airports — wir respektieren das
 *                                              schema-feldnamen aber nehmen den
 *                                              ident als unique key)
 *   ourairports.iata_code   → Airport.iata
 *   ourairports.name        → Airport.name
 *   ourairports.municipality→ Airport.city
 *   ourairports.iso_country → Airport.country  (ISO 2-letter, z.B. "DE")
 *   ourairports.latitude_deg→ Airport.latitude
 *   ourairports.longitude_deg→Airport.longitude
 *   ourairports.elevation_ft→ Airport.elevation
 *   ourairports.type        → Airport.type
 *   ourairports.continent   → Airport.continent
 *   ourairports.scheduled_service ('yes'/'no') → Airport.scheduledService (bool)
 *   ourairports.gps_code    → Airport.gpsCode
 *   ourairports.wikipedia_link→Airport.wikipediaLink
 *
 * Verified-flag: Alle importierten airports werden als verified=true
 * markiert (system-curated quelle), verifiedById=null (kein spezifischer
 * user-verifier — system).
 */

import { PrismaClient } from '@prisma/client';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

const OURAIRPORTS_URL =
  'https://davidmegginson.github.io/ourairports-data/airports.csv';
const BATCH_SIZE = 500;

const prisma = new PrismaClient();

interface OurAirportsRow {
  id: string;
  ident: string;
  type: string;
  name: string;
  latitude_deg: string;
  longitude_deg: string;
  elevation_ft: string;
  continent: string;
  iso_country: string;
  iso_region: string;
  municipality: string;
  scheduled_service: string;
  icao_code: string;
  iata_code: string;
  gps_code: string;
  local_code: string;
  home_link: string;
  wikipedia_link: string;
  keywords: string;
}

/**
 * Wandelt eine CSV-row in das Prisma-upsert-shape um. Filter-logik:
 * - ident ist required & unique (skip falls leer)
 * - lat/lon parsing: floats, fallback NaN-detection
 * - elevation_ft: int oder null wenn leer/invalid
 * - scheduled_service: 'yes' → true, alles andere → false
 */
function rowToAirportData(row: OurAirportsRow): {
  icao: string;
  data: {
    icao: string;
    iata: string | null;
    name: string;
    city: string | null;
    country: string;
    latitude: number;
    longitude: number;
    elevation: number | null;
    type: string;
    continent: string | null;
    scheduledService: boolean;
    gpsCode: string | null;
    wikipediaLink: string | null;
    verified: boolean;
    active: boolean;
  };
} | null {
  const icao = row.ident?.trim();
  if (!icao) return null;

  const lat = Number.parseFloat(row.latitude_deg);
  const lon = Number.parseFloat(row.longitude_deg);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const elevationParsed = row.elevation_ft
    ? Number.parseInt(row.elevation_ft, 10)
    : null;
  const elevation =
    elevationParsed !== null && !Number.isNaN(elevationParsed)
      ? elevationParsed
      : null;

  return {
    icao,
    data: {
      icao,
      iata: row.iata_code?.trim() || null,
      name: row.name?.trim() || icao,
      city: row.municipality?.trim() || null,
      country: row.iso_country?.trim() || 'XX',
      latitude: lat,
      longitude: lon,
      elevation,
      type: row.type?.trim() || 'unknown',
      continent: row.continent?.trim() || null,
      scheduledService: row.scheduled_service?.trim() === 'yes',
      gpsCode: row.gps_code?.trim() || null,
      wikipediaLink: row.wikipedia_link?.trim() || null,
      verified: true, // system-curated quelle
      active: true,
    },
  };
}

async function downloadCsv(): Promise<string> {
  console.log(`📥 Lade CSV von ${OURAIRPORTS_URL}...`);
  const start = Date.now();
  const response = await fetch(OURAIRPORTS_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} beim CSV-download`);
  }
  const text = await response.text();
  const sizeMb = (text.length / 1024 / 1024).toFixed(1);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ ${sizeMb} MB in ${elapsed}s heruntergeladen`);
  return text;
}

async function parseCsv(csvText: string): Promise<OurAirportsRow[]> {
  return new Promise((resolve, reject) => {
    const rows: OurAirportsRow[] = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });

    parser.on('readable', () => {
      let record: OurAirportsRow | null;
      while ((record = parser.read() as OurAirportsRow | null) !== null) {
        rows.push(record);
      }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(rows));

    Readable.from([csvText]).pipe(parser);
  });
}

async function importBatch(
  airports: ReturnType<typeof rowToAirportData>[],
): Promise<{ ok: number; skipped: number }> {
  const valid = airports.filter(
    (a): a is NonNullable<typeof a> => a !== null,
  );
  // Wir können wegen unique-icao kein createMany mit skipDuplicates nutzen
  // wenn wir auch existing rows updaten wollen — also einzeln upsert. Für
  // performance batchen wir in einer transaction.
  await prisma.$transaction(
    valid.map((a) =>
      prisma.airport.upsert({
        where: { icao: a.icao },
        create: a.data,
        update: {
          // Bei existing rows nur die OurAirports-felder aktualisieren —
          // verified/proposedFromRequest/createdAt etc. nicht überschreiben
          iata: a.data.iata,
          name: a.data.name,
          city: a.data.city,
          country: a.data.country,
          latitude: a.data.latitude,
          longitude: a.data.longitude,
          elevation: a.data.elevation,
          type: a.data.type,
          continent: a.data.continent,
          scheduledService: a.data.scheduledService,
          gpsCode: a.data.gpsCode,
          wikipediaLink: a.data.wikipediaLink,
          // verified bleibt wie vorher gesetzt — falls jemand schon manuell
          // verified=true gesetzt hat (z.B. die alten 15 seed-airports),
          // ändert sich das nicht; falls neu hinzugefügt, ist verified=true
          // aus dem create-branch
        },
      }),
    ),
    { timeout: 30000 },
  );
  return {
    ok: valid.length,
    skipped: airports.length - valid.length,
  };
}

async function main() {
  console.log('🛫 OurAirports.com Bulk Import\n');

  const csvText = await downloadCsv();

  console.log('🔍 Parse CSV...');
  const parseStart = Date.now();
  const rows = await parseCsv(csvText);
  console.log(
    `✓ ${rows.length.toLocaleString('de')} rows in ${((Date.now() - parseStart) / 1000).toFixed(1)}s geparst\n`,
  );

  console.log(`💾 Importiere in Batches von ${BATCH_SIZE}...`);
  const importStart = Date.now();
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
  let totalOk = 0;
  let totalSkipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batchRows = rows.slice(i, i + BATCH_SIZE);
    const batchData = batchRows.map(rowToAirportData);
    const { ok, skipped } = await importBatch(batchData);
    totalOk += ok;
    totalSkipped += skipped;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      const pct = ((batchNum / totalBatches) * 100).toFixed(0);
      const elapsed = ((Date.now() - importStart) / 1000).toFixed(0);
      console.log(
        `  Batch ${batchNum}/${totalBatches} (${pct}%) — ${totalOk} ok, ${totalSkipped} skipped — ${elapsed}s elapsed`,
      );
    }
  }

  const totalElapsed = ((Date.now() - importStart) / 1000).toFixed(1);
  console.log(`\n✅ Import fertig in ${totalElapsed}s`);
  console.log(`   ${totalOk.toLocaleString('de')} airports imported`);
  console.log(
    `   ${totalSkipped.toLocaleString('de')} skipped (invalid coordinates oder leeres ident)`,
  );

  // Zähle final state
  const totalInDb = await prisma.airport.count();
  const verifiedInDb = await prisma.airport.count({ where: { verified: true } });
  console.log(
    `\n📊 DB final: ${totalInDb.toLocaleString('de')} airports total, ${verifiedInDb.toLocaleString('de')} verified`,
  );
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
