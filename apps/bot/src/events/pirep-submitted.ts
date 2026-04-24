import type { Client } from 'discord.js';

export type PirepSubmittedPayload = {
  pirepId: string;
  userId: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  flightTimeMin: number;
  aircraftRegistration: string | null;
  remarks: string | null;
};

export async function handlePirepSubmitted(
  client: Client,
  payload: PirepSubmittedPayload
) {
  console.log('[event] pirep-submitted:', payload);
  // TODO: in Phase C — Embed in #pireps posten
}