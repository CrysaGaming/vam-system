/**
 * Track 1 #5 (Replay-Mode, 9.2.7) — Replay-data API-route.
 *
 * Returnt die positions + metadata für einen PIREP als JSON. Wird vom
 * client-component der replay-page on-mount gefetched.
 *
 * Auth: member-only. Ownership/visibility check matched dem rest der
 * pirep-pages: eigene PIREPs immer, fremde nur für admin/instructor
 * der gleichen airline.
 *
 * Cache-policy: no-store. Replay-data ist zwar immutable (nach
 * approval ändert sich der trail nicht mehr), aber bei concurrent
 * approvals/edits könnte stale-data verwirren. Fresh-fetch ist billig
 * genug.
 *
 * Response-shape: passthrough von ReplayDataResult als JSON. Date-
 * felder werden via toJSON() automatisch zu ISO-strings.
 */

import { auth } from "@/auth";
import { findReplayDataForPirep, prisma } from "@vam/db";
import { isApproverRole } from "@/lib/roles";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: pirepId } = await params;

  // Ownership/visibility-check (analog pirep-detail-page)
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true, role: { select: { name: true } } },
  });
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: { userId: true, airlineId: true },
  });
  if (!pirep) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwn = pirep.userId === currentUser.id;
  const isApprover = isApproverRole(currentUser.role?.name);
  const sameAirline = pirep.airlineId === currentUser.airlineId;
  if (!isOwn && !(isApprover && sameAirline)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await findReplayDataForPirep(pirepId);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
