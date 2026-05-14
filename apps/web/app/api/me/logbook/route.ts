/**
 * Welle I / I4 — Pilot-Logbook PDF download endpoint.
 *
 * GET /api/me/logbook → returns the eingeloggten pilot's full logbook
 * als PDF stream. Force-download via Content-Disposition: attachment.
 *
 * # Auth
 *
 * Session-required. Wenn nicht eingeloggt → 401. Logbook ist /me/*,
 * also nur der pilot selbst kann sein eigenes logbook ziehen — kein
 * admin-override, kein cross-user-access. V2 könnte airline-admin
 * read für audit-purposes erlauben aber das wäre eine separate route
 * mit eigenen permissions.
 *
 * # Streaming
 *
 * Die generateLogbookPdf-helper returnt eine PDFDocument-instance
 * die selbst ein Readable-stream ist. Wir wandeln das via web-stream
 * adapter in ein ReadableStream<Uint8Array> für die NextResponse.
 *
 * # Caching
 *
 * Logbook ist user-spezifisch + ändert sich bei jedem approved PIREP.
 * Wir setzen Cache-Control: no-store explizit damit kein intermediate-
 * proxy (cloudflare, CDN) das caching versucht. User kann den
 * download bei bedarf wiederholen — V2 könnte ein TTL-cache mit
 * invalidation-on-pirep-approve sein.
 */

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { loadLogbookData, generateLogbookPdf } from '@/lib/logbook/pdf';

// pdfkit benutzt native Node-streams + buffer; nicht-edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const { meta, entries } = await loadLogbookData(userId);

  // Generate the PDF — pdfkit writes async into its stream. Wir collecten
  // alle chunks in einen array und buffern sie zusammen statt direkt zu
  // streamen, weil NextResponse den buffer-pages-trick (page X of Y)
  // braucht — der wird erst beim doc.end() finalisiert, und vorher
  // schon zu streamen würde die finalen page-stamps abschneiden.
  //
  // Für realistische pilot-logbooks (~150 pages = ~3MB PDF) ist das
  // memory-tradeoff trivial. Bei extremen 50k-PIREP-monster-logbooks
  // (~30MB) würde man auf chunked-stream wechseln — out of scope V1.
  const pdf = generateLogbookPdf(meta, entries);

  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve, reject) => {
    pdf.on('end', () => resolve());
    pdf.on('error', (err) => reject(err));
  });

  const buffer = Buffer.concat(chunks);
  const filename = buildFilename(meta.pilotName);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store, private',
    },
  });
}

/**
 * Bau einen safe filename aus dem pilot-namen + ISO-datum. Spaces
 * werden zu underscores, special chars werden gestrippt, der ISO-
 * datestring sorgt für sortable filenames wenn jemand mehrere
 * downloads sammelt.
 *
 * Beispiel: "Kevin Drack" + 2026-05-14 → "logbook_Kevin_Drack_2026-05-14.pdf"
 */
function buildFilename(pilotName: string): string {
  const safeName = pilotName
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  const today = new Date().toISOString().slice(0, 10);
  return `logbook_${safeName || 'pilot'}_${today}.pdf`;
}
