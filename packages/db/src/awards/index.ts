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

// Track 5 #7 — Criteria DSL + evaluator + auto-grant runner.
// Award.criteria JSON-feld (existiert seit prisma initial-schema, war
// bisher ungenutzt) wird jetzt als strukturiertes DSL interpretiert.
// parseCriteria validiert raw JSON → typed AwardCriteriaV1, evaluator
// returnt {met, progress, target}, runAutoGrantForUser triggert nach
// PIREP-approval und vergibt erfüllte awards.
export {
  parseCriteria,
  evaluateCriteria,
  evaluateAllAwardsForUser,
  runAutoGrantForUser,
  type AwardCriteriaV1,
  type EvaluationResult,
  type AutoGrantedAward,
  type AwardWithProgress,
} from "./criteria.js";
