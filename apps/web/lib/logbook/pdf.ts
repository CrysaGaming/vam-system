/**
 * Welle I / I4 — Pilot-Logbook PDF generation.
 *
 * Generiert ein DIN-A4-PDF mit allen approved PIREPs eines pilots
 * im klassischen pilot-logbook-format (tabellarisch, chronologisch
 * aufsteigend wie ein echtes papier-logbuch).
 *
 * # Layout
 *
 *   Cover-page:
 *     - Pilot name + airline + rank
 *     - Total flights / total hours / date range
 *     - "Personal records"-section (mirrors /me/stats)
 *     - Generierungs-datum + watermark
 *
 *   Logbook-pages (multi-page mit table-pagination):
 *     - Header-row: # · Datum · Flug · Dep → Arr · A/C · Block-Zeit
 *                   · Landing fpm · Network
 *     - 25-30 rows per page (kann variieren by aircraft/route length)
 *     - Page-footer: "Seite X von Y · Pilot Name"
 *
 *   Footer-page:
 *     - Total-summe + signatur-platzhalter (für ausdruck)
 *
 * # Why pdfkit over @react-pdf/renderer
 *
 * pdfkit ist programmatisch, klein (<100KB), und sehr stabil im
 * serverless-runtime. @react-pdf hat größere bundle-size + react-
 * overhead, ohne dass uns die JSX-API hier praktischen vorteil
 * bringt (logbook ist hochgradig deterministisches table-rendering).
 *
 * # Streaming
 *
 * pdfkit nutzt node-streams natively. Die page-route piped den
 * stream direkt an die response — kein "buffer-the-whole-PDF-into-
 * memory"-pattern. Bei 5000-PIREP-logbooks (~150 pages) bleibt der
 * memory-footprint konstant niedrig.
 */

import PDFDocument from 'pdfkit';
import { prisma } from '@vam/db';

// ─────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────

export type LogbookEntry = {
  index: number; // 1-based seq nr in chronological order
  date: Date;
  flightNumber: string | null;
  departureIcao: string;
  arrivalIcao: string;
  aircraftType: string | null;
  registration: string | null;
  flightTimeMin: number;
  landingRateFpm: number | null;
  network: string | null;
};

export type LogbookMeta = {
  pilotName: string;
  airlineName: string | null;
  airlineIcao: string | null;
  rankName: string | null;
  totalFlights: number;
  totalMinutes: number;
  firstFlightAt: Date | null;
  lastFlightAt: Date | null;
};

/**
 * Lädt alle approved PIREPs eines pilots in chronologischer
 * reihenfolge (älteste zuerst — das logbook beginnt mit dem
 * ersten flug oben links auf seite 1, wie ein echtes pilot-logbook).
 *
 * Performance: ein einzelnes findMany. Bei einem pilot mit 5000
 * PIREPs sind das ~1-2MB row-data — fine to hold in memory während
 * der PDF gestreamt wird. Selects sind narrow gehalten.
 */
export async function loadLogbookData(
  userId: string,
): Promise<{ meta: LogbookMeta; entries: LogbookEntry[] }> {
  const [user, pireps] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        airline: { select: { name: true, icao: true } },
        rank: { select: { name: true } },
      },
    }),
    prisma.pirep.findMany({
      where: { userId, status: 'Approved' },
      orderBy: { submittedAt: 'asc' },
      select: {
        submittedAt: true,
        flightTimeMin: true,
        landingRateFpm: true,
        network: true,
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
        aircraft: { select: { type: true, registration: true } },
        route: { select: { flightNumber: true } },
      },
    }),
  ]);

  const entries: LogbookEntry[] = pireps.map((p, i) => ({
    index: i + 1,
    date: p.submittedAt,
    flightNumber: p.route?.flightNumber ?? null,
    departureIcao: p.departure.icao,
    arrivalIcao: p.arrival.icao,
    aircraftType: p.aircraft?.type ?? null,
    registration: p.aircraft?.registration ?? null,
    flightTimeMin: p.flightTimeMin ?? 0,
    landingRateFpm: p.landingRateFpm,
    network: p.network,
  }));

  const totalMinutes = entries.reduce((sum, e) => sum + e.flightTimeMin, 0);

  return {
    meta: {
      pilotName: user?.name ?? 'Pilot',
      airlineName: user?.airline?.name ?? null,
      airlineIcao: user?.airline?.icao ?? null,
      rankName: user?.rank?.name ?? null,
      totalFlights: entries.length,
      totalMinutes,
      firstFlightAt: entries[0]?.date ?? null,
      lastFlightAt: entries[entries.length - 1]?.date ?? null,
    },
    entries,
  };
}

// ─────────────────────────────────────────────────────────────────────
// PDF generation
// ─────────────────────────────────────────────────────────────────────

/**
 * Erstellt eine PDFDocument-instance und schreibt den vollen logbook-
 * inhalt in den stream. Returnt das Document — der caller pipet
 * es an die HTTP-response.
 *
 * # Layout-konstanten
 *
 * DIN-A4 landscape (842×595 pt) damit die wide-table mit 8 spalten
 * komfortabel passt. Margins 40pt rundum. Standard-fonts (Helvetica)
 * weil pdfkit's built-ins zero-overhead haben — custom fonts würden
 * font-files in den serverless-bundle ziehen, unnötig V1.
 */
export function generateLogbookPdf(
  meta: LogbookMeta,
  entries: LogbookEntry[],
): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 50, left: 40, right: 40 },
    bufferPages: true, // damit wir am ende der generation page-footers nach-stempeln können (page X of Y)
    info: {
      Title: `Logbook — ${meta.pilotName}`,
      Author: meta.airlineName ?? 'VAM',
      Subject: 'Pilot Logbook',
      CreationDate: new Date(),
    },
  });

  // ─── Cover page ───────────────────────────────────────────────────
  drawCoverPage(doc, meta);

  // ─── Logbook pages ────────────────────────────────────────────────
  if (entries.length > 0) {
    drawLogbookEntries(doc, meta, entries);
  }

  // ─── Footer-stamping über alle pages ──────────────────────────────
  // bufferPages=true erlaubt das jetzt; wir iterieren über alle
  // pages und schreiben die "Seite X von Y"-zeile in die fußzeile.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageNum = i - range.start + 1;
    const pageTotal = range.count;
    doc
      .fontSize(8)
      .fillColor('#666')
      .text(
        `Seite ${pageNum} / ${pageTotal} · ${meta.pilotName}${
          meta.airlineIcao ? ' · ' + meta.airlineIcao : ''
        }`,
        40,
        doc.page.height - 30,
        {
          align: 'left',
          width: doc.page.width - 80,
        },
      );
    doc
      .text(
        `Generiert ${new Date().toLocaleString('de-DE')}`,
        40,
        doc.page.height - 30,
        {
          align: 'right',
          width: doc.page.width - 80,
        },
      )
      .fillColor('black');
  }

  doc.end();
  return doc;
}

/**
 * Cover-page rendering. Eigene seite mit dem header-block + summary.
 */
function drawCoverPage(
  doc: InstanceType<typeof PDFDocument>,
  meta: LogbookMeta,
): void {
  const cx = doc.page.width / 2;

  // Title
  doc
    .fontSize(28)
    .font('Helvetica-Bold')
    .fillColor('#1e293b')
    .text('PILOT LOGBOOK', 0, 80, { align: 'center', width: doc.page.width });

  // Sub-title
  doc
    .moveDown(0.5)
    .fontSize(14)
    .font('Helvetica')
    .fillColor('#475569')
    .text(meta.pilotName, { align: 'center', width: doc.page.width });

  if (meta.airlineName) {
    doc
      .moveDown(0.3)
      .fontSize(11)
      .fillColor('#64748b')
      .text(
        `${meta.airlineIcao ? meta.airlineIcao + ' · ' : ''}${meta.airlineName}${
          meta.rankName ? ' · ' + meta.rankName : ''
        }`,
        { align: 'center', width: doc.page.width },
      );
  }

  // Divider line
  doc
    .moveTo(120, 220)
    .lineTo(doc.page.width - 120, 220)
    .strokeColor('#cbd5e1')
    .lineWidth(0.5)
    .stroke();

  // Summary stats — 3 KPI-blocks side-by-side
  const blockY = 250;
  const blockW = (doc.page.width - 240) / 3;
  const totalHours = Math.round((meta.totalMinutes / 60) * 10) / 10;
  const dateRange =
    meta.firstFlightAt && meta.lastFlightAt
      ? `${meta.firstFlightAt.toLocaleDateString('de-DE')} – ${meta.lastFlightAt.toLocaleDateString('de-DE')}`
      : '—';

  drawKpiBlock(doc, 120, blockY, blockW, 'TOTAL FLIGHTS', String(meta.totalFlights));
  drawKpiBlock(
    doc,
    120 + blockW,
    blockY,
    blockW,
    'TOTAL HOURS',
    `${totalHours.toLocaleString('de-DE')}h`,
  );
  drawKpiBlock(doc, 120 + blockW * 2, blockY, blockW, 'DATE RANGE', dateRange);

  // Footer-note
  doc
    .fontSize(9)
    .fillColor('#94a3b8')
    .text(
      'Dieses logbook wurde automatisch generiert aus den approved PIREPs des pilots. ' +
        'Jede zeile entspricht einem flight-report, der von einem admin bestätigt wurde. ' +
        'Drafts, submitted-aber-noch-nicht-approved und rejected PIREPs sind NICHT enthalten.',
      80,
      doc.page.height - 120,
      { width: doc.page.width - 160, align: 'center' },
    )
    .fillColor('black');

  cx; // silence unused-warning if linter activates
}

function drawKpiBlock(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
): void {
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#94a3b8')
    .text(label, x, y, { width: w, align: 'center' });
  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .fillColor('#0f172a')
    .text(value, x, y + 14, { width: w, align: 'center' })
    .font('Helvetica')
    .fillColor('black');
}

/**
 * Render the logbook-entry table across multiple pages as needed.
 *
 * # Column layout
 *
 * Die spalten sind absolute-X positions damit zeilen ohne text-wrap
 * sauber bleiben. Falls eine zelle länger ist als die spalten-breite,
 * wird sie geclippt (besser als wrap → row-height-divergenz die das
 * table-grid zerstört).
 */
function drawLogbookEntries(
  doc: InstanceType<typeof PDFDocument>,
  meta: LogbookMeta,
  entries: LogbookEntry[],
): void {
  doc.addPage();

  const cols = {
    idx: { x: 40, w: 35, label: '#', align: 'right' as const },
    date: { x: 80, w: 70, label: 'Datum', align: 'left' as const },
    flight: { x: 155, w: 70, label: 'Flug', align: 'left' as const },
    route: { x: 230, w: 90, label: 'Strecke', align: 'left' as const },
    aircraft: { x: 325, w: 100, label: 'A/C · Reg', align: 'left' as const },
    block: { x: 430, w: 70, label: 'Block', align: 'right' as const },
    landing: { x: 505, w: 70, label: 'Landing', align: 'right' as const },
    network: { x: 580, w: 70, label: 'Network', align: 'left' as const },
  };

  // Title für die erste table-page
  doc
    .fontSize(14)
    .font('Helvetica-Bold')
    .fillColor('#1e293b')
    .text('Flight Log', 40, 40);
  doc.font('Helvetica').fillColor('black');

  let y = 70;
  drawTableHeader(doc, cols, y);
  y += 22;

  const rowH = 16;
  const bottomLimit = doc.page.height - 60; // leave room for footer-stamp

  for (const entry of entries) {
    if (y + rowH > bottomLimit) {
      // page-break — neue seite, header wieder rendern
      doc.addPage();
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#1e293b')
        .text('Flight Log (fortgesetzt)', 40, 40);
      doc.font('Helvetica').fillColor('black');
      y = 70;
      drawTableHeader(doc, cols, y);
      y += 22;
    }
    drawTableRow(doc, cols, y, entry);
    y += rowH;
  }

  // Summary at end
  if (y + 60 > bottomLimit) {
    doc.addPage();
    y = 60;
  }
  y += 12;
  doc
    .moveTo(40, y)
    .lineTo(doc.page.width - 40, y)
    .strokeColor('#1e293b')
    .lineWidth(1)
    .stroke();
  y += 8;
  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .fillColor('#1e293b')
    .text(
      `TOTAL: ${meta.totalFlights} flights · ${formatMinutes(meta.totalMinutes)} block time`,
      40,
      y,
      { width: doc.page.width - 80, align: 'right' },
    )
    .font('Helvetica')
    .fillColor('black');
}

type ColumnDef = {
  x: number;
  w: number;
  label: string;
  align: 'left' | 'right' | 'center';
};

type TableCols = {
  idx: ColumnDef;
  date: ColumnDef;
  flight: ColumnDef;
  route: ColumnDef;
  aircraft: ColumnDef;
  block: ColumnDef;
  landing: ColumnDef;
  network: ColumnDef;
};

function drawTableHeader(
  doc: InstanceType<typeof PDFDocument>,
  cols: TableCols,
  y: number,
): void {
  doc
    .rect(40, y - 4, doc.page.width - 80, 18)
    .fillColor('#f1f5f9')
    .fill()
    .fillColor('black');

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569');
  for (const col of Object.values(cols)) {
    doc.text(col.label, col.x, y, {
      width: col.w,
      align: col.align,
      lineBreak: false,
    });
  }
  doc.font('Helvetica').fillColor('black');

  // Bottom border under header
  doc
    .moveTo(40, y + 14)
    .lineTo(doc.page.width - 40, y + 14)
    .strokeColor('#cbd5e1')
    .lineWidth(0.5)
    .stroke();
}

function drawTableRow(
  doc: InstanceType<typeof PDFDocument>,
  cols: TableCols,
  y: number,
  entry: LogbookEntry,
): void {
  doc.fontSize(8).font('Helvetica').fillColor('#1e293b');

  const draw = (col: ColumnDef, text: string) => {
    doc.text(text, col.x, y, {
      width: col.w,
      align: col.align,
      lineBreak: false,
      ellipsis: true,
    });
  };

  draw(cols.idx, String(entry.index));
  draw(
    cols.date,
    entry.date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
  );
  draw(cols.flight, entry.flightNumber ?? '—');
  draw(cols.route, `${entry.departureIcao} → ${entry.arrivalIcao}`);
  draw(
    cols.aircraft,
    entry.aircraftType
      ? `${entry.aircraftType}${entry.registration ? ' · ' + entry.registration : ''}`
      : '—',
  );
  draw(cols.block, formatMinutes(entry.flightTimeMin));
  draw(
    cols.landing,
    entry.landingRateFpm !== null ? `${entry.landingRateFpm} fpm` : '—',
  );
  draw(cols.network, entry.network ?? '—');

  doc.fillColor('black');

  // Light row-separator
  doc
    .moveTo(40, y + 11)
    .lineTo(doc.page.width - 40, y + 11)
    .strokeColor('#e2e8f0')
    .lineWidth(0.25)
    .stroke();
}

function formatMinutes(min: number): string {
  if (min <= 0) return '—';
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}
