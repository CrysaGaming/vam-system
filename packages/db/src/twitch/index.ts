/**
 * Welle 14A Twitch-Activation — barrel-export für twitch-module.
 *
 * Convention (siehe ../economy/index.ts, ../career/index.ts): module-
 * exports werden in packages/db/src/index.ts re-exported, sodass apps/web
 * und apps/bot via `import { markPilotLive, getLivePilots } from "@vam/db"`
 * konsumieren ohne subpath-imports.
 */

// 14A: live-status-helpers
export {
  markPilotLive,
  markPilotOffline,
  getLivePilots,
  countLivePilots,
  substituteThumbnailDimensions,
  type LiveStreamContext,
  type MarkPilotLiveResult,
  type MarkPilotOfflineResult,
  type LivePilotSummary,
} from "./live-status.js";
