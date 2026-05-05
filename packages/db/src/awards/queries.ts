import type { Award, UserAward, User } from "@prisma/client";
import { prisma } from "../index.js";

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Read-side queries für das awards-system.
 *
 * Awards sind merit-badges die pilots im laufe ihrer karriere verdienen
 * können. Im MVP werden sie manuell vom admin vergeben (auto-detection
 * via cron-job ist v2-vision laut roadmap section 9.2.3).
 *
 * # Datenmodell
 *
 * - `Award` — die definition: name, description, optional iconUrl,
 *   optional criteria-JSON (für zukünftige auto-detection-rules).
 * - `UserAward` — die vergabe: userId × awardId × awardedAt. Unique-
 *   constraint auf (userId, awardId) verhindert dass ein award mehrfach
 *   an den selben user vergeben wird.
 *
 * # Query-pattern
 *
 * Die queries hier sind alles SELECT-side helpers für die awards-UI:
 *   - Public catalog: `listAwardsWithCounts()` zeigt alle awards plus
 *     "X piloten haben das" für jedes.
 *   - Award-detail: `getAwardWithRecipients(id)` zeigt den award + die
 *     liste der user die ihn erworben haben.
 *   - User-profile: `getUserAwards(userId)` zeigt alle awards eines
 *     pilots, sorted by awardedAt desc (neueste zuerst).
 *
 * Pure read-helpers — keine side-effects, alle errors propagieren raw
 * vom prisma-client damit caller (server-components) sie über next.js'
 * error-boundary handeln kann.
 */

/**
 * Award + count of users who earned it. Für den public-catalog wo wir
 * "scarcity" zeigen wollen — ein award mit 1 recipient ist anders als
 * einer mit 50.
 */
export type AwardWithCount = Award & {
  recipientCount: number;
};

/**
 * UserAward + the linked Award definition. Standard-shape für display
 * auf user-profile und im personal-awards-view.
 */
export type UserAwardWithAward = UserAward & {
  award: Award;
};

/**
 * Award + list of recipients (with minimal user-info for display). Für
 * die award-detail-page wo wir die "wall of fame" zeigen.
 */
export type AwardWithRecipients = Award & {
  recipients: Array<{
    userAwardId: string;
    awardedAt: Date;
    user: Pick<User, "id" | "name" | "image">;
  }>;
};

/**
 * Listet alle awards alphabetisch nach name. Basic catalog-view ohne
 * recipient-counts — billig genug für sidebars, dropdown-pickers etc.
 */
export async function listAwards(): Promise<Award[]> {
  return prisma.award.findMany({
    orderBy: { name: "asc" },
  });
}

/**
 * Alle awards plus recipientCount. Single-query approach via _count
 * relation-aggregation — kein N+1.
 *
 * Sortierung: nach name asc. Alternative wäre "by recipientCount desc"
 * für eine "popular awards"-perspektive, aber für catalog-browsing ist
 * alphabetisch besser navigierbar (wenn user "PMDG-master" sucht).
 */
export async function listAwardsWithCounts(): Promise<AwardWithCount[]> {
  const awards = await prisma.award.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { userAwards: true },
      },
    },
  });
  return awards.map((a) => ({
    ...a,
    recipientCount: a._count.userAwards,
  }));
}

/**
 * Single award by id. Returnt null wenn nicht gefunden — caller (page
 * server-component) macht meist notFound() draus.
 */
export async function getAwardById(id: string): Promise<Award | null> {
  return prisma.award.findUnique({ where: { id } });
}

/**
 * Award-detail mit recipients-liste. Recipients sortiert nach awardedAt
 * desc (neueste vergaben zuerst) — passt zur "recently earned by..."-
 * leseperspektive.
 *
 * Recipient-shape ist minimal (id/name/image) — für die UI reicht ein
 * avatar + name + link aufs profile. Mehr details kann der user via
 * profile-link selbst nachladen.
 */
export async function getAwardWithRecipients(
  id: string,
): Promise<AwardWithRecipients | null> {
  const award = await prisma.award.findUnique({
    where: { id },
    include: {
      userAwards: {
        orderBy: { awardedAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, image: true },
          },
        },
      },
    },
  });
  if (!award) return null;
  return {
    id: award.id,
    name: award.name,
    description: award.description,
    iconUrl: award.iconUrl,
    criteria: award.criteria,
    createdAt: award.createdAt,
    recipients: award.userAwards.map((ua) => ({
      userAwardId: ua.id,
      awardedAt: ua.awardedAt,
      user: ua.user,
    })),
  };
}

/**
 * Alle awards eines users. Sortiert nach awardedAt desc — neueste oben
 * für "what did I just earn"-feeling auf dem profile.
 *
 * Awards die der user noch nicht hat sind NICHT teil dieses results —
 * für "alle awards mit earned-status" nutze listAwardsWithCounts +
 * separate getUserAwards-call und cross-reference im UI.
 */
export async function getUserAwards(
  userId: string,
): Promise<UserAwardWithAward[]> {
  return prisma.userAward.findMany({
    where: { userId },
    orderBy: { awardedAt: "desc" },
    include: { award: true },
  });
}

/**
 * Set of award-ids die ein user schon hat. Nützlich für UIs die alle
 * awards rendern und pro award einen "earned"-toggle setzen wollen
 * (z.B. catalog-page wenn eingeloggt). Returnt ein Set für O(1) lookups.
 */
export async function getUserAwardIds(userId: string): Promise<Set<string>> {
  const userAwards = await prisma.userAward.findMany({
    where: { userId },
    select: { awardId: true },
  });
  return new Set(userAwards.map((ua) => ua.awardId));
}

/**
 * Total count von distinct awards die ein user erworben hat. Für
 * profile-stats ("12 awards earned") ohne die awards-objekte selbst
 * zu materialisieren.
 */
export async function countUserAwards(userId: string): Promise<number> {
  return prisma.userAward.count({ where: { userId } });
}
