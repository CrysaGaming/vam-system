/**
 * Track 4 #17 — POST /api/sceneries/[id]/toggle-owned
 *
 * Toggle ownership des aktuellen users für eine specific scenery. Der
 * sceneries-catalog UI ruft das beim klick auf den "Habe ich"-button auf.
 *
 * # Auth
 *
 * Member-only (logged-in user). Sceneries-katalog ist eh member-locked
 * (siehe /sceneries/page.tsx) — anonyme user kämen gar nicht zur button-
 * action. Defensive prüfen wir trotzdem im handler.
 *
 * # Idempotency
 *
 * toggleUserScenery() in @vam/db macht das delete-or-create atomic. Bei
 * doppel-click (z.B. user double-clickt schnell) gewinnt die zweite
 * request den finalen state — die erste sieht ihren state zurück, die
 * zweite invertiert nochmal. Net-effect: auf der DB ist das, was der
 * pilot zuletzt geklickt hat.
 *
 * # Response
 *
 * `{ owned: boolean }` — der neue ownership-state. UI nutzt das für
 * optimistic-update-correction. HTTP-statuscode 200 für beide outcomes
 * (toggle ist immer success wenn auth passt + scenery existiert).
 */

import { auth } from "@/auth";
import { toggleUserScenery, prisma } from "@vam/db";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid scenery id" }, { status: 400 });
  }

  // Existence-check — sonst würde toggleUserScenery() bei einem create
  // einen FK-violation werfen. Sauberer: 404 hier abfangen.
  const scenery = await prisma.scenery.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!scenery) {
    return NextResponse.json({ error: "Scenery not found" }, { status: 404 });
  }

  const result = await toggleUserScenery(session.user.id, id);
  return NextResponse.json(result);
}
