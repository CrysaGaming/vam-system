/**
 * Track 1 #1 — Awards system barrel.
 *
 * Public API für apps/web zur konsumption: alle queries + actions für
 * das award-system. Bot kann diese helpers theoretisch auch aufrufen
 * (z.B. zukünftige auto-detection-cron-jobs), für jetzt nutzt nur die
 * web-app sie.
 */

export {
  listAwards,
  listAwardsWithCounts,
  getAwardById,
  getAwardWithRecipients,
  getUserAwards,
  getUserAwardIds,
  countUserAwards,
  type AwardWithCount,
  type UserAwardWithAward,
  type AwardWithRecipients,
} from "./queries.js";

export {
  createAward,
  updateAward,
  deleteAward,
  grantAward,
  revokeAward,
  type CreateAwardInput,
  type UpdateAwardInput,
  type GrantAwardResult,
  type RevokeAwardResult,
} from "./actions.js";
