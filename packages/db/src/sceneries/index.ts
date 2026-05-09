/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — barrel export für sceneries.
 */

export {
  listSceneries,
  getSceneryById,
  listDistinctProviders,
  getSceneryCounts,
  getUserOwnedSceneryIds,
  toggleUserScenery,
  type SceneryWithAirline,
  type SceneryFilter,
} from "./queries.js";

export {
  createScenery,
  updateScenery,
  deleteScenery,
  type CreateSceneryInput,
  type UpdateSceneryInput,
} from "./actions.js";
