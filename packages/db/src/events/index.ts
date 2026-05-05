/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Module barrel.
 *
 * Public API für das events-modul. Geteilt in:
 *  - queries.ts: read-side helpers (catalog, detail, profile)
 *  - actions.ts: write-side helpers (CRUD + state-transitions + signups)
 *
 * Re-export pattern wie bei awards/, sceneries/, economy/.
 */

export {
  computeRuntimeStatus,
  listPublishedEvents,
  getEventBySlug,
  listEventsForAdmin,
  getEventForAdmin,
  getEventParticipants,
  getUserEventParticipation,
  getUserEvents,
  countUserEvents,
  type RuntimeStatus,
  type EventWithCounts,
  type EventDetail,
  type EventForAdmin,
  type EventParticipantWithUser,
  type UserEventEntry,
} from "./queries.js";

export {
  slugify,
  createEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
  completeEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  markParticipantCompleted,
  unmarkParticipantCompleted,
  type CreateEventInput,
  type UpdateEventInput,
  type StateTransitionResult,
  type JoinEventResult,
  type LeaveEventResult,
  type MarkCompletedResult,
} from "./actions.js";
