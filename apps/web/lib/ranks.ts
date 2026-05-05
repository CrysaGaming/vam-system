import { prisma, getActiveLicenses, type LicenseType } from '@vam/db';
import { emitRankUpgraded } from '@/lib/bot-events';

/**
 * Rank-Promotion-Logic (Welle 6 commit 6B-3, Welle 13E-9 career-extension).
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
 * Welle 13E-9 — Career-mode license-gate:
 * - Wenn airline.careerEnabled UND user.careerEnabled, werden für die
 *   rank-eligibility ZUSÄTZLICH zur hours-threshold die rank.requiredLicenses
 *   geprüft. Pilot muss ALLE darin gelisteten licenses ACTIVE haben um den
 *   rank zu erreichen.
 * - Fallback-cascade: wenn pilot nicht den höchsten rank kriegt (licenses
 *   fehlen), wird der nächsthöhere rank versucht den er erfüllt. So bleibt
 *   ein neuer Captain-Anwärter ohne ATPL als Senior-FO statt einfach
 *   blockiert auf seinem alten rank.
 * - Career-mode aus → klassische hours-only-promotion wie vor 13E.
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
      // Welle 13E-9: welche licenses haben den new-rank-claim ermöglicht?
      // Empty-array wenn career-mode off oder rank ohne requirements.
      // Wird im discord-announcement nicht genutzt, aber für audit-trail
      // im server-log und potentielle UI-anzeige.
      licensesUsed: LicenseType[];
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
      // Welle 13E-9: airline.careerEnabled für gating-decision + user-flag
      // mit fetchen damit wir nicht nochmal queryen müssen.
      airline: { select: { careerEnabled: true } },
      accounts: {
        where: { provider: 'discord' },
        select: { providerAccountId: true },
      },
    },
  });

  if (!user || !user.airlineId) {
    return { promoted: false, reason: 'no-airline' };
  }

  // Welle 13E-9: dual-gate-check ob career-mode für diesen user aktiv ist.
  // Selbe philosophie wie hasCareer in shellUser: BEIDE flags müssen ON
  // sein. Wenn auch nur einer false, läuft die promotion in legacy-mode
  // (hours-only, ignoriert rank.requiredLicenses).
  const careerActive = !!(user.careerEnabled && user.airline?.careerEnabled);

  // Active licenses einmal laden (nur wenn career-mode active). Bei legacy-
  // mode skippen wir die query komplett — kein performance-overhead für
  // airlines die das feature nicht nutzen.
  const activeLicenseTypes = careerActive
    ? new Set((await getActiveLicenses(userId)).map((l) => l.type))
    : new Set<LicenseType>();

  // Alle ranks der airline laden, sortiert by order DESC. Wir filtern
  // dann in memory weil wir mehrere kriterien kombinieren (hours +
  // licenses) und der fallback-cascade in legacy-DB-only-pattern nicht
  // gut ausdrückbar ist. N=2-10 ranks pro airline, application-side
  // filterung ist trivial.
  const allRanks = await prisma.rank.findMany({
    where: { airlineId: user.airlineId },
    orderBy: { order: 'desc' },
  });

  if (allRanks.length === 0) {
    return { promoted: false, reason: 'no-qualifying-rank' };
  }

  // Find highest qualifying rank. In career-mode mit cascade — wenn der
  // höchste hours-eligible rank licenses-fehlt, fallen wir auf den nächst-
  // höheren rank zurück den der pilot erfüllt. Im legacy-mode ist es
  // einfach der erste hours-match.
  let qualifyingRank: (typeof allRanks)[number] | null = null;
  let licensesUsed: LicenseType[] = [];

  for (const r of allRanks) {
    // Hours-check (gilt in beiden modi)
    if (r.minFlightHours > user.totalFlightHours) continue;

    // License-check (nur in career-mode)
    if (careerActive && r.requiredLicenses.length > 0) {
      const hasAll = r.requiredLicenses.every((lic) =>
        activeLicenseTypes.has(lic),
      );
      if (!hasAll) {
        // Pilot hat hours aber nicht alle required licenses — versuch
        // den nächsten (niedrigeren) rank.
        continue;
      }
    }

    // Beide checks bestanden → das ist unser höchster qualifying rank.
    qualifyingRank = r;
    licensesUsed = careerActive ? r.requiredLicenses : [];
    break;
  }

  if (!qualifyingRank) {
    // Edge-case: airline hat ranks, user hat 0 hours UND kein rank hat
    // minFlightHours=0, oder career-mode mit licenses die alle ranks
    // verfehlen. Kein promotion möglich.
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

  // Server-log mit license-info wenn career-mode active. Hilft beim
  // debugging (warum hat pilot X den FO-rank statt Captain bekommen).
  const licenseInfo =
    careerActive && licensesUsed.length > 0
      ? ` [licenses: ${licensesUsed.join(', ')}]`
      : careerActive
        ? ' [career-mode, no license requirements]'
        : '';
  console.log(
    `[rank-upgrade] ${user.email}: ${user.rank?.name ?? 'None'} -> ${qualifyingRank.name} (${user.totalFlightHours.toFixed(1)}h)${licenseInfo}`,
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
    licensesUsed,
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
