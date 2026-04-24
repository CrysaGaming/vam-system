import type { Client } from 'discord.js';

export type RankUpgradedPayload = {
  userId: string;
  discordId: string | null;
  oldRankName: string;
  newRankName: string;
  totalFlightHours: number;
};

export async function handleRankUpgraded(
  client: Client,
  payload: RankUpgradedPayload
) {
  console.log('[event] rank-upgraded:', payload);
  // TODO: in Phase C — Discord-Rolle aktualisieren + Embed in #rank-promotions posten
}