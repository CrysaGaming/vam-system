import { prisma } from '@vam/db';
import { emitRankUpgraded } from '@/lib/bot-events';

/**
 * Rank-Promotion-Logic (Welle 6 commit 6B-3).
 *
 * Zentrale stelle für die "find highest qualifying rank for this pilot's
 * flight hours and promote if needed"-logik. Vorher dupliziert in
 * /pireps/new/page.tsx submitPirep — jetzt extracted damit:
 *   1. Manuelle re-evaluation von airline-admin möglich ist (nach
 *      änderung an Rank.minFlightHours-thresholds).
 *   2. Single source of truth für promotion-policy (kein drift zwischen
 *      auto-trigger und manual-trigger).
 *
 * POLICY:
 * - Promotion-only, kein automatic-demote. Wenn admin minFlightHours eines
 *   ranks erhöht und ein pilot dadurch unter den threshold fällt, behält
 *   er seinen rank trotzdem. Demote ist eine destruktive aktion die admin
 *   bewusst manuell machen soll, kein silent-side-effect von rank-edits.
 * - Promotion läuft beim PIREP-SUBMIT (in /pireps/new/page.tsx), NICHT beim
 *   approval. Das ist legacy-behavior von vor Welle 6: hours werden auch
 *   beim submit incrementiert. Wenn ein PIREP later rejected wird, werden
 *   hours aktuell NICHT decrementiert (separater bug, out-of-scope für 6B-3).
 *   Promotion folgt also dem hours-tracking — wo hours updated werden, muss
 *   evaluatePromotion gerufen werden.
 *
 * Discord-event: emitRankUpgraded bei jeder erfolgreichen promotion.
 * Bot übernimmt Discord-rolle-update + announcement im channel.
 */

export type PromotionResult =
  | { promoted: false; reason: 'no-change' | 'no-airline' | 'no-qualifying-rank' }
  | {
      promoted: true;
      userId: string;
      oldRankId: string | null;
      oldRankName: string | null;
      newRankId: string;
      newRankName: string;
      totalFlightHours: number;
    };

/**
 * Evaluiert einen einzelnen user. Lädt aktuelle hours + rank, findet
 * höchsten qualifying rank, promotet wenn höher als aktuell.
 *
 * Idempotent: zweimaliger call ohne hours-change → 'no-change'.
 *
 * Atomicity: KEINE transaction um den User-load + Rank-load + User-update
 * — das ist absichtlich. Auto-promotion ist best-effort, nicht critical-
 * path. Eine race-condition (two concurrent PIREP-submits, beide sehen
 * old rank, beide promoten) ist harmless: das update ist idempotent
 * (rankId=X → rankId=X), und das emitRankUpgraded ist nicht transactional
 * eh. Bei realistic load (1-2 PIREPs pro pilot pro tag) statistisch
 * irrelevant.
 *
 * Nicht atomar mit der hours-update: caller (submitPirep) updated hours
 * erst, ruft DANN evaluatePromotion. Wenn dazwischen ein crash passiert,
 * sind hours updated aber promotion läuft beim NÄCHSTEN PIREP-submit
 * (oder via manual evaluateAllPromotions).
 *
 * Discord-events: silent-failure, bot-events sind side-effects nicht
 * critical. Console.error wenn fehlschlägt, return continues.
 */
export async function evaluatePromotion(
  userId: string,
): Promise<PromotionResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      rank: true,
      accounts: {
        where: { provider: 'discord' },
        select: { providerAccountId: true },
      },
    },
  });

  if (!user || !user.airlineId) {
    return { promoted: false, reason: 'no-airline' };
  }

  // Highest rank where minFlightHours <= user's hours, sortiert nach order
  // desc — der erste match ist der höchste rank den der user qualified ist
  // zu erreichen. Bewusst order desc statt minFlightHours desc, weil order
  // ist die kanonische hierarchie (admin kann theoretisch order und min-
  // FlightHours unabhängig setzen — order entscheidet wer "höher" ist).
  const qualifyingRank = await prisma.rank.findFirst({
    where: {
      airlineId: user.airlineId,
      minFlightHours: { lte: user.totalFlightHours },
    },
    orderBy: { order: 'desc' },
  });

  if (!qualifyingRank) {
    // Edge-case: airline hat keine ranks angelegt, oder user hat 0 hours
    // und kein rank hat minFlightHours=0. Kein promotion möglich.
    return { promoted: false, reason: 'no-qualifying-rank' };
  }

  // Promotion-only: nur upgrade wenn qualifying rank höhere order hat
  // als aktueller rank. Wenn user keinen rank hat (rank=null), zählt
  // currentOrder=-1 — jeder qualifying rank wäre höher.
  const currentOrder = user.rank?.order ?? -1;

  if (
    qualifyingRank.id === user.rankId ||
    qualifyingRank.order <= currentOrder
  ) {
    return { promoted: false, reason: 'no-change' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { rankId: qualifyingRank.id },
  });

  console.log(
    `[rank-upgrade] ${user.email}: ${user.rank?.name ?? 'None'} -> ${qualifyingRank.name} (${user.totalFlightHours.toFixed(1)}h)`,
  );

  // Discord-event — silent failure damit bot-outage nicht promotion blockiert
  try {
    await emitRankUpgraded({
      userId: user.id,
      discordId: user.accounts[0]?.providerAccountId ?? null,
      oldRankName: user.rank?.name ?? 'None',
      newRankName: qualifyingRank.name,
      totalFlightHours: user.totalFlightHours,
    });
  } catch (err) {
    console.error('[evaluatePromotion] emitRankUpgraded failed:', err);
  }

  return {
    promoted: true,
    userId: user.id,
    oldRankId: user.rankId,
    oldRankName: user.rank?.name ?? null,
    newRankId: qualifyingRank.id,
    newRankName: qualifyingRank.name,
    totalFlightHours: user.totalFlightHours,
  };
}

/**
 * Bulk-evaluation für alle members einer airline. Wird vom airline-admin
 * über die "Ränge neu auswerten"-action getriggert — z.B. nachdem ein
 * minFlightHours-threshold geändert wurde und einige piloten promoten
 * sollten ohne dass sie einen neuen PIREP submitten müssen.
 *
 * Performance: N+1 queries (pro user mehrere DB-roundtrips für rank-lookup
 * + update + discord-event). Bei 50-200 mitgliedern einer typischen VA
 * irrelevant. Wenn airlines mal 1000+ haben würde, müsste das in einer
 * single bulk-query mit application-level rank-matching umgeschrieben
 * werden — aber das ist YAGNI bis solche scale exists.
 *
 * Errors-strategy: collect, nicht fail-fast. Wenn ein user-update fehl-
 * schlägt (z.B. rank wurde von anderem admin gelöscht zwischen find und
 * update), läuft der bulk weiter und reportet den fehler in failed[].
 */
export type BulkPromotionResult = {
  totalEvaluated: number;
  promoted: Array<{
    userId: string;
    userName: string | null;
    oldRankName: string | null;
    newRankName: string;
    totalFlightHours: number;
  }>;
  failed: Array<{ userId: string; error: string }>;
};

export async function evaluateAllPromotions(
  airlineId: string,
): Promise<BulkPromotionResult> {
  const members = await prisma.user.findMany({
    where: { airlineId },
    select: { id: true, name: true },
  });

  const promoted: BulkPromotionResult['promoted'] = [];
  const failed: BulkPromotionResult['failed'] = [];

  for (const member of members) {
    try {
      const result = await evaluatePromotion(member.id);
      if (result.promoted) {
        promoted.push({
          userId: result.userId,
          userName: member.name,
          oldRankName: result.oldRankName,
          newRankName: result.newRankName,
          totalFlightHours: result.totalFlightHours,
        });
      }
    } catch (err) {
      failed.push({
        userId: member.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    totalEvaluated: members.length,
    promoted,
    failed,
  };
}
