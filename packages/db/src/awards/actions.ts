import { Prisma, type Award, type UserAward } from "@prisma/client";
import { prisma } from "../index.js";

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Write-side actions für das awards-system.
 *
 * Diese helpers sind admin-territory: nur user mit role.name === 'admin'
 * sollten sie aufrufen können. Den auth-check macht der caller (server-
 * action in apps/web), nicht hier — Pure-DB-helpers ohne session-context
 * sind composable für CLI-tools/seed-scripts/zukünftige cron-jobs.
 *
 * # Idempotency-design
 *
 * `grantAward` wirft NICHT bei already-granted (würde die UX vermasseln
 * wenn admin denselben award versehentlich zweimal vergibt). Statt-
 * dessen returnt er ein result-objekt mit `wasAlreadyEarned: true` —
 * caller kann das fürs UI nutzen ("Pilot hatte den award schon"). Kein
 * unique-constraint-error, kein silent-overwrite des awardedAt.
 *
 * `revokeAward` ist auch idempotent: wenn nicht da, return wasAlreadyAbsent=true.
 *
 * `createAward` wirft bei duplicate-name (Award.name ist @unique im
 * schema) — caller fängt das und zeigt es als validation-error im UI.
 */

// ─────────────────────────────────────────────────────────────────────
// createAward
// ─────────────────────────────────────────────────────────────────────

export type CreateAwardInput = {
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  criteria?: Prisma.InputJsonValue | null;
};

/**
 * Erstellt einen neuen award-typ. Name muss unique sein — bei kollision
 * wirft prisma einen P2002 unique-constraint-error den der caller
 * abfangen sollte.
 */
export async function createAward(input: CreateAwardInput): Promise<Award> {
  return prisma.award.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      iconUrl: input.iconUrl ?? null,
      // criteria ist Json? im schema, so null oder InputJsonValue. Wir
      // expliziten null-cast wenn nicht gesetzt damit prisma's typing
      // happy ist.
      criteria:
        input.criteria === undefined || input.criteria === null
          ? Prisma.JsonNull
          : input.criteria,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// updateAward
// ─────────────────────────────────────────────────────────────────────

export type UpdateAwardInput = {
  id: string;
  name?: string;
  description?: string | null;
  iconUrl?: string | null;
  criteria?: Prisma.InputJsonValue | null;
};

/**
 * Updates an existing award. Felder die nicht im input sind bleiben
 * unverändert — partial update. Bei criteria=null wird das feld auf
 * Prisma.JsonNull gesetzt (DB-NULL), bei undefined wird's nicht angefasst.
 */
export async function updateAward(input: UpdateAwardInput): Promise<Award> {
  const data: Prisma.AwardUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.iconUrl !== undefined) data.iconUrl = input.iconUrl;
  if (input.criteria !== undefined) {
    data.criteria = input.criteria === null ? Prisma.JsonNull : input.criteria;
  }
  return prisma.award.update({
    where: { id: input.id },
    data,
  });
}

// ─────────────────────────────────────────────────────────────────────
// deleteAward
// ─────────────────────────────────────────────────────────────────────

/**
 * Löscht einen award PLUS alle UserAwards die darauf zeigen (cascade
 * via separate delete-call weil das schema kein onDelete: Cascade
 * gesetzt hat). Wir machen das in einer transaction damit beide löschungen
 * atomar passieren.
 *
 * Returnt die anzahl der UserAwards die mit-gelöscht wurden — das ist
 * "verlorene history" fürs admin-UI als warnung-nach-fakt.
 */
export async function deleteAward(id: string): Promise<{
  deleted: boolean;
  userAwardsDeleted: number;
}> {
  return prisma.$transaction(async (tx) => {
    const userAwardsCount = await tx.userAward.count({ where: { awardId: id } });
    await tx.userAward.deleteMany({ where: { awardId: id } });
    await tx.award.delete({ where: { id } });
    return { deleted: true, userAwardsDeleted: userAwardsCount };
  });
}

// ─────────────────────────────────────────────────────────────────────
// grantAward
// ─────────────────────────────────────────────────────────────────────

export type GrantAwardResult =
  | {
      ok: true;
      wasAlreadyEarned: false;
      userAward: UserAward;
    }
  | {
      ok: true;
      wasAlreadyEarned: true;
      userAward: UserAward;
    };

/**
 * Vergibt einen award an einen user. Idempotent: wenn der user den
 * award schon hat, wird der existing UserAward returnt mit
 * wasAlreadyEarned=true (kein neuer awardedAt-timestamp, kein error).
 *
 * Im UI nutzt der admin das wasAlreadyEarned-flag um eine "war schon
 * earned"-toast zu zeigen statt eine "neu vergeben"-celebration. Bot-
 * dispatch (discord-embed) sollte AUCH nur bei wasAlreadyEarned=false
 * gefeuert werden — sonst würden bei doppelvergabe zwei "🏆 Pilot hat
 * award erhalten"-posts kommen.
 *
 * Race-handling: zwei concurrent grants → der zweite kriegt den unique-
 * constraint-error (P2002), den fangen wir und re-querien das jetzt
 * existing record. So ist der zweite caller "wasAlreadyEarned=true" wie
 * erwartet, statt einen P2002 zu bubbeln.
 */
export async function grantAward(
  userId: string,
  awardId: string,
): Promise<GrantAwardResult> {
  // Erst checken ob's schon existiert — billiger als das try-catch um
  // den constraint-error wenn das der häufige fall ist (admin sieht
  // "schon earned" in der UI bevor er klickt).
  const existing = await prisma.userAward.findUnique({
    where: { userId_awardId: { userId, awardId } },
  });
  if (existing) {
    return { ok: true, wasAlreadyEarned: true, userAward: existing };
  }

  try {
    const userAward = await prisma.userAward.create({
      data: { userId, awardId },
    });
    return { ok: true, wasAlreadyEarned: false, userAward };
  } catch (err) {
    // Race: zwischen unserem findUnique-check und create hat ein anderer
    // call den UserAward angelegt. P2002 = unique-constraint-violation.
    // Wir machen ein zweites findUnique und returnen das als
    // wasAlreadyEarned=true.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const raceWinner = await prisma.userAward.findUnique({
        where: { userId_awardId: { userId, awardId } },
      });
      if (raceWinner) {
        return { ok: true, wasAlreadyEarned: true, userAward: raceWinner };
      }
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// revokeAward
// ─────────────────────────────────────────────────────────────────────

export type RevokeAwardResult = {
  ok: true;
  wasAlreadyAbsent: boolean;
};

/**
 * Entfernt einen award von einem user. Idempotent: wenn der user den
 * award eh nicht hat, returnt wasAlreadyAbsent=true ohne fehler.
 *
 * Use-cases: admin-fehler ("falscher pilot bekommen"), award-rebalancing
 * ("award wurde irrtümlich vergeben weil criteria falsch waren"). Nicht
 * für "user has been bad" — das wäre ein eigener moderation-flow.
 */
export async function revokeAward(
  userId: string,
  awardId: string,
): Promise<RevokeAwardResult> {
  const result = await prisma.userAward.deleteMany({
    where: { userId, awardId },
  });
  return { ok: true, wasAlreadyAbsent: result.count === 0 };
}
