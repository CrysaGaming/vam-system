// Track 5 #26 (Section F): Roster-Assignment helpers. DB-CRUD layer für
// das RosterAssignment-model. Business-logic (eligibility-rules, swap-
// flow, no-show-detection) lebt in apps/web/lib/roster/ — diese helpers
// hier sind pure persistence.
export {
  ROSTER_ASSIGNMENT_SELECT,
  listAssignmentsForAirline,
  listAssignmentsForPilot,
  getAssignmentById,
  createAssignment,
  updateAssignmentStatus,
  completeAssignmentWithPirep,
  cancelAssignment,
  countActiveAssignmentsForPilot,
  type RosterAssignmentWithRelations,
} from "./assignments.js";
