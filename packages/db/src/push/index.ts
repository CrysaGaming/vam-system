// Track 5 #24 (Section E): Push subscriptions — Web Push API persistence.
// CRUD-helpers für die PushSubscription DB-table. Pure DB-layer, keine
// web-push library-deps hier. Die actual notification-versendung lebt
// in apps/web/lib/push/vapid.ts.
export {
  upsertPushSubscription,
  removePushSubscription,
  listPushSubscriptionsForUser,
  deletePushSubscriptionByEndpoint,
  countPushSubscriptionsForUser,
  type PushSubscriptionPayload,
} from "./subscriptions.js";
