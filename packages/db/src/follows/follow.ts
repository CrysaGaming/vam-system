/**
 * Track 5 #13 (Section C) — Follow-System helpers.
 *
 * Asymmetric follow (twitter-style). Ein user kann jedem anderen user
 * mit `isProfilePublic=true` folgen. Kein consent vom followee, kein
 * accept/reject — wenn das profile public ist, ist es follow-bar.
 *
 * # Public API
 *
 *   - followUser(followerId, followeeId)
 *   - unfollowUser(followerId, followeeId)
 *   - getFollowState(viewerId, targetId) → { isFollowing, isFollowedBy, isMutual }
 *   - getFollowCounts(userId) → { followers, following }
 *   - listFollowers(userId, limit) — wer folgt userId
 *   - listFollowing(userId, limit) — wem folgt userId
 *
 * # Constraints (enforced server-side)
 *
 *   - No self-follow (followerId !== followeeId)
 *   - Followee must have isProfilePublic=true (sonst NotFollowableError)
 *   - Idempotent: doppel-follow returnt success ohne error (via unique-
 *     constraint catch)
 *
 * # Privacy
 *
 *   - Follower-/Following-listen sind public sichtbar weil das profile
 *     selbst public ist (man kann nicht "secretly" jemandem folgen)
 *   - V2 könnte "private follow"-feature einbauen, V1 ist clean public
 */

import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

export class NotFollowableError extends Error {
  constructor() {
    super("User existiert nicht oder hat kein public profile.");
    this.name = "NotFollowableError";
  }
}

export class SelfFollowError extends Error {
  constructor() {
    super("Du kannst dir nicht selbst folgen.");
    this.name = "SelfFollowError";
  }
}

const FOLLOWER_LIST_USER_SELECT = {
  id: true,
  name: true,
  image: true,
  isProfilePublic: true,
  rank: { select: { name: true } },
  airline: { select: { icao: true, name: true } },
} satisfies Prisma.UserSelect;

type FollowerListUser = Prisma.UserGetPayload<{
  select: typeof FOLLOWER_LIST_USER_SELECT;
}>;

export type FollowListEntry = {
  id: string;
  name: string | null;
  image: string | null;
  rankName: string | null;
  airlineIcao: string | null;
  airlineName: string | null;
  isProfilePublic: boolean;
  followedAt: Date;
};

function entryFromFollow(row: {
  createdAt: Date;
  user: FollowerListUser;
}): FollowListEntry {
  return {
    id: row.user.id,
    name: row.user.name,
    image: row.user.image,
    rankName: row.user.rank?.name ?? null,
    airlineIcao: row.user.airline?.icao ?? null,
    airlineName: row.user.airline?.name ?? null,
    isProfilePublic: row.user.isProfilePublic,
    followedAt: row.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────

/**
 * Erstellt eine follow-edge (followerId → followeeId).
 *
 * Idempotent: wenn die edge schon existiert, ist das ein no-op (catch
 * P2002 unique-constraint-violation).
 *
 * Throws:
 *   - SelfFollowError wenn follower === followee
 *   - NotFollowableError wenn der followee nicht existiert oder
 *     isProfilePublic=false
 */
export async function followUser(
  followerId: string,
  followeeId: string,
): Promise<void> {
  if (followerId === followeeId) {
    throw new SelfFollowError();
  }

  // Check ob followee follow-bar ist. Wir scope'n den findUnique auf
  // {id, isProfilePublic:true} — wenn null returnt, ist der user entweder
  // nicht da oder hat sein profile nicht public. Beide fälle treaten wir
  // gleich (kein hint über account-existenz).
  const followee = await prisma.user.findUnique({
    where: { id: followeeId },
    select: { id: true, isProfilePublic: true },
  });
  if (!followee || !followee.isProfilePublic) {
    throw new NotFollowableError();
  }

  try {
    await prisma.follow.create({
      data: { followerId, followeeId },
    });
  } catch (e) {
    // P2002 = unique-constraint violation = already following. Idempotent.
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return;
    }
    throw e;
  }
}

/**
 * Löscht eine follow-edge. Idempotent: wenn die edge nicht existiert,
 * passiert nichts (deleteMany returnt count=0).
 */
export async function unfollowUser(
  followerId: string,
  followeeId: string,
): Promise<void> {
  await prisma.follow.deleteMany({
    where: { followerId, followeeId },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Read queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Returnt den follow-state aus sicht von viewer auf target.
 *
 * Wenn viewer null (= unlogged-in viewer auf einer public profile-page),
 * returnt {isFollowing: false, isFollowedBy: false, isMutual: false} —
 * der UI-state ist dann einfach "not-following, button is 'Folgen'".
 *
 * Wenn viewer === target, returnt false für alles (self-follow möglich
 * nicht). Frontend sollte den button dann eh nicht zeigen.
 */
export async function getFollowState(
  viewerId: string | null,
  targetId: string,
): Promise<{ isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean }> {
  if (!viewerId || viewerId === targetId) {
    return { isFollowing: false, isFollowedBy: false, isMutual: false };
  }

  // Zwei lookups parallel: A→B (viewer folgt target?) und B→A (target
  // folgt viewer? für "follows you"-badge).
  const [forwardEdge, reverseEdge] = await Promise.all([
    prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId: viewerId, followeeId: targetId } },
      select: { id: true },
    }),
    prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId: targetId, followeeId: viewerId } },
      select: { id: true },
    }),
  ]);

  const isFollowing = forwardEdge !== null;
  const isFollowedBy = reverseEdge !== null;
  return {
    isFollowing,
    isFollowedBy,
    isMutual: isFollowing && isFollowedBy,
  };
}

/**
 * Returnt {followers, following}-counts.
 *
 * Zwei count-queries parallel. Auf einem index covered (Follow
 * @@index([followeeId, createdAt]) bzw. @@unique([followerId,
 * followeeId])) sind das O(log n) lookups.
 */
export async function getFollowCounts(
  userId: string,
): Promise<{ followers: number; following: number }> {
  const [followers, following] = await Promise.all([
    prisma.follow.count({ where: { followeeId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
  ]);
  return { followers, following };
}

/**
 * Listet die follower eines users (wer folgt dem user), neueste zuerst.
 *
 * Default-limit 50. Hard-cap 200. Cursor-pagination für V2.
 */
export async function listFollowers(
  userId: string,
  options: { limit?: number } = {},
): Promise<FollowListEntry[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const rowsRaw = await prisma.follow.findMany({
    where: { followeeId: userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      createdAt: true,
      // followers list: zeige den FOLLOWER-user (= follower-relation)
      follower: { select: FOLLOWER_LIST_USER_SELECT },
    },
  });
  // Same cast pattern as andere helpers — extended-client loses select-
  // payload-inference downstream. See ../users/public-profile.ts USER_PUBLIC_SELECT
  // comment for details.
  const rows = rowsRaw as unknown as Array<{
    createdAt: Date;
    follower: FollowerListUser;
  }>;
  return rows.map((r) => entryFromFollow({ createdAt: r.createdAt, user: r.follower }));
}

/**
 * Listet die users denen ein user folgt (following), neueste zuerst.
 */
export async function listFollowing(
  userId: string,
  options: { limit?: number } = {},
): Promise<FollowListEntry[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const rowsRaw = await prisma.follow.findMany({
    where: { followerId: userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      createdAt: true,
      // following list: zeige den FOLLOWEE-user
      followee: { select: FOLLOWER_LIST_USER_SELECT },
    },
  });
  const rows = rowsRaw as unknown as Array<{
    createdAt: Date;
    followee: FollowerListUser;
  }>;
  return rows.map((r) => entryFromFollow({ createdAt: r.createdAt, user: r.followee }));
}
