/**
 * Track 5 #5 — PIREP Logbook PDF endpoint.
 *
 * GET /api/pireps/[id]/logbook
 *
 * Returns: application/pdf stream. Content-Disposition=attachment mit
 * generierten filename "logbook-{flightNumber}-{date}.pdf".
 *
 * # Why a route handler and not server-action
 *
 * Server-actions können nicht binär-streams returnen (sind JSON-serialized
 * im RPC-protocol). Browser-downloads brauchen ein echtes HTTP-response
 * mit application/pdf + Content-Disposition. → Route-handler ist der
 * richtige primitive.
 *
 * # Render-strategy
 *
 * @react-pdf/renderer hat zwei serverside-modi:
 *   - renderToStream(): liefert nodeJS Readable stream, ideal für direkte
 *     response-pipe ohne in-memory buffer
 *   - renderToBuffer(): liefert komplettes Buffer am ende
 *
 * Wir nutzen Buffer (renderToBuffer): das PDF ist single-page und in der
 * regel <50KB, der memory-overhead ist trivial. Stream wäre overkill und
 * der Web-streams-adapter in Next.js 16 ist noch janky bei node-streams.
 *
 * # Performance
 *
 * Erste request kostet ~500ms wegen @react-pdf/renderer cold-start. Folge-
 * requests sind ~100-200ms. Bei häufigen downloads könnte man die PDFs
 * cachen (S3 + content-hash) — V1 keine cache, fresh-render pro request.
 *
 * # Auth
 *
 * Selbe policy wie /pireps/[id] detail-page:
 *   - eigene PIREPs: immer ok
 *   - approver same-airline: ok
 *   - alles andere: 403
 *
 * # Audit
 *
 * Kein audit-log entry per download — PDF-export ist read-only und
 * für rein persönliche/admin-zwecke. Wenn data-leak-protection ein
 * thema wird, kann das später ergänzt werden.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  prisma,
  getPirepApproachAnalysis,
  getPirepLandingAnalysis,
} from '@vam/db';
import { isApproverRole } from '@/lib/roles';
import {
  computeSmoothnessScore,
  computeSuggestions,
} from '@/lib/pirep-metrics';
import { PirepLogbookPdf, type LogbookData } from '@/lib/pirep-logbook-pdf';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  const { id } = await params;

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!currentUser) {
    return NextResponse.json({ error: 'User nicht gefunden.' }, { status: 404 });
  }

  const pirep = await prisma.pirep.findUnique({
    where: { id },
    include: {
      route: { select: { flightNumber: true, distanceNm: true } },
      departure: { select: { icao: true, name: true, city: true } },
      arrival: { select: { icao: true, name: true, city: true } },
      aircraft: { select: { registration: true, type: true } },
      airline: { select: { name: true, icao: true } },
      user: {
        select: {
          name: true,
          rank: { select: { name: true } },
        },
      },
    },
  });
  if (!pirep) {
    return NextResponse.json({ error: 'PIREP nicht gefunden.' }, { status: 404 });
  }

  // Auth: own OR (approver AND same-airline)
  const isOwn = pirep.userId === currentUser.id;
  const sameAirline = pirep.airlineId === currentUser.airlineId;
  const isApprover = isApproverRole(currentUser.role?.name);
  if (!isOwn && !(isApprover && sameAirline)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }

  // Fetch metrics for the PDF. Both can return null wenn keine session-
  // match — PDF rendert dann die jeweiligen sections nicht. Parallel
  // damit kein zusätzlicher serial-latency.
  const [approachAnalysis, landingAnalysis] = await Promise.all([
    getPirepApproachAnalysis(pirep.id),
    getPirepLandingAnalysis(pirep.id),
  ]);

  const smoothnessScore = computeSmoothnessScore(
    landingAnalysis?.verticalFpmAtTouchdown,
    approachAnalysis?.stabilizationScorePercent,
    approachAnalysis?.glideslopeQualityPercent,
  );

  const suggestions = computeSuggestions({
    landingAnalysis: landingAnalysis
      ? { verticalFpmAtTouchdown: landingAnalysis.verticalFpmAtTouchdown }
      : null,
    approachAnalysis: approachAnalysis
      ? {
          glideslopeQualityPercent: approachAnalysis.glideslopeQualityPercent,
          stabilizationScorePercent:
            approachAnalysis.stabilizationScorePercent,
        }
      : null,
    routeAverages: null,
    pirep: {
      fuelUsedKg: pirep.fuelUsedKg,
      flightTimeMin: pirep.flightTimeMin,
      landingRateFpm: pirep.landingRateFpm,
    },
    smoothnessScore,
  });

  const data: LogbookData = {
    pirep: {
      id: pirep.id,
      submittedAt: pirep.submittedAt,
      status: pirep.status,
      flightTimeMin: pirep.flightTimeMin,
      fuelUsedKg: pirep.fuelUsedKg,
      landingRateFpm: pirep.landingRateFpm,
      passengerCount: pirep.passengerCount,
      cargoKg: pirep.cargoKg,
      remarks: pirep.remarks,
    },
    airline: { name: pirep.airline.name, icao: pirep.airline.icao },
    route: {
      flightNumber: pirep.route?.flightNumber ?? null,
      distanceNm: pirep.route?.distanceNm ?? null,
    },
    departure: pirep.departure,
    arrival: pirep.arrival,
    pilot: {
      name: pirep.user.name,
      rankName: pirep.user.rank?.name ?? null,
    },
    aircraft: pirep.aircraft,
    approach: approachAnalysis
      ? {
          iasAt1000ft: approachAnalysis.iasAt1000ft,
          glideslopeQualityPercent: approachAnalysis.glideslopeQualityPercent,
          stabilizationScorePercent:
            approachAnalysis.stabilizationScorePercent,
        }
      : null,
    landing: landingAnalysis
      ? {
          verticalFpmAtTouchdown: landingAnalysis.verticalFpmAtTouchdown,
          groundSpeedKtsAtTouchdown:
            landingAnalysis.groundSpeedKtsAtTouchdown,
          altitudeAglAtTouchdown: landingAnalysis.altitudeAglAtTouchdown,
          atIcao: landingAnalysis.atIcao,
        }
      : null,
    smoothnessScore,
    suggestions,
  };

  // @react-pdf/renderer wird dynamisch importiert damit der server-route
  // beim cold-start nicht den ganzen PDF-renderer in den initial-chunk
  // zieht. Spart memory + startup-time wenn die route gar nicht aufgerufen
  // wird. Erst beim ersten request wird die lib geladen — Next.js cached
  // den import danach.
  const { renderToBuffer } = await import('@react-pdf/renderer');
  // PirepLogbookPdf ist ein normaler react-component der das Document
  // returnt — renderToBuffer akzeptiert das React-Element.
  const pdfBuffer = await renderToBuffer(<PirepLogbookPdf data={data} />);

  // Filename: logbook-<flightnum>-<date>.pdf. Sanitize damit keine
  // problematische chars (spaces, slashes) reinkommen. Default zu "PIREP"
  // wenn flightnum fehlt; date als YYYY-MM-DD.
  const flightSlug = (pirep.route?.flightNumber ?? 'PIREP').replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  );
  const dateSlug = pirep.submittedAt.toISOString().split('T')[0];
  const filename = `logbook-${flightSlug}-${dateSlug}.pdf`;

  return new NextResponse(pdfBuffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBuffer.byteLength),
      // No-cache: PDFs sind cheap genug zu regenerieren, und wenn der
      // pilot die PIREP nachträglich editiert (z.B. remarks), soll
      // der re-download die aktuellen daten haben.
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  });
}
