/**
 * Welle 13E Career-System — barrel-export für career module.
 *
 * Convention (siehe ../economy/index.ts): module-exports werden in
 * packages/db/src/index.ts re-exported, sodass apps/web und apps/bot
 * `import { canPilotFlyAircraft, grantLicense } from "@vam/db"` nutzen
 * ohne subpath-imports.
 */

// 13E-2: license-helpers
export {
  generateCertificateNumber,
  grantLicense,
  revokeLicense,
  suspendLicense,
  reinstateLicense,
  expireLicenses,
  getUserLicenses,
  getActiveLicenses,
  hasLicense,
  getExpiringLicenses,
  type GrantLicenseInput,
  type RevokeLicenseInput,
  type SuspendLicenseInput,
  type ReinstateLicenseInput,
  type ExpireLicensesResult,
} from "./licenses.js";

// 13E-2: type-rating-helpers
export {
  grantTypeRating,
  extendTypeRating,
  revokeTypeRating,
  incrementHoursOnType,
  getUserTypeRatings,
  getActiveTypeRatings,
  hasTypeRating,
  getExpiringTypeRatings,
  getExpiredTypeRatings,
  type GrantTypeRatingInput,
  type ExtendTypeRatingInput,
  type IncrementHoursInput,
} from "./type-ratings.js";

// 13E-2: aircraft → license-requirements lookup
export {
  getAircraftRequirements,
  inferAircraftCategory,
  formatRequirements,
  licenseDisplayName,
  type AircraftCategory,
  type AircraftRequirements,
} from "./requirements.js";

// 13E-2: composite booking-gate
export {
  canPilotFlyAircraft,
  canPilotFlyAircraftStrict,
  shouldEnforceCareerGate,
  type CanFlyInput,
  type CanFlyResult,
  type CanFlyStrictInput,
  type CanFlyStrictResult,
  type ShouldEnforceInput,
} from "./can-fly.js";

// 13E-13: theory-exam helpers (question-bank CRUD + attempt-flow + grading)
export {
  PASS_MARK_PERCENT,
  DEFAULT_EXAM_QUESTION_COUNT,
  RELEVANT_CATEGORIES_BY_LICENSE,
  distributeBalanced,
  gradeAnswers,
  createTheoryExamQuestion,
  deactivateTheoryExamQuestion,
  listTheoryExamQuestions,
  startTheoryExam,
  getAttemptWithQuestions,
  saveAttemptAnswer,
  submitTheoryExam,
  getTheoryExamAttempts,
  getActiveAttempt,
  hasPassedTheoryExam,
  type CreateTheoryExamQuestionInput,
  type ListTheoryExamQuestionsFilters,
  type StartTheoryExamInput,
  type StartTheoryExamResult,
  type AttemptWithQuestions,
  type SaveAttemptAnswerInput,
  type SubmitTheoryExamInput,
  type SubmitTheoryExamResult,
} from "./theory-exam.js";
