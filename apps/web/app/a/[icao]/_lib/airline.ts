import { cache } from 'react';
import { prisma } from '@vam/db';

/**
 * Shared loader for /a/[icao] layout + sub-pages (Welle 8 commit 8B-2).
 *
 * Wrapped in React's `cache()` so the layout and the page (which both
 * call this in the same request) issue exactly ONE Postgres query per
 * request — instead of duplicating it. cache() works at the request
 * boundary; concurrent users get their own cached entries.
 *
 * Returns null when the airline doesn't exist OR when publicVisible=false.
 * Treating those two cases identically prevents existence-leakage:
 * "DLH exists but is hidden" → "DLH does not exist", same response.
 *
 * The selected fields cover everything the layout/hero needs (branding,
 * identity chips). Sub-pages typically need a separate, more specific
 * query for their content (hubs, fleet, routes, schedule) and call this
 * helper only for the airline-id + branding context.
 */
export const getPublicAirline = cache(async (icaoRaw: string) => {
  const icao = icaoRaw.toUpperCase();
  return prisma.airline.findFirst({
    where: { icao, publicVisible: true },
    select: {
      id: true,
      icao: true,
      iata: true,
      name: true,
      callsign: true,
      logoUrl: true,
      tagline: true,
      description: true,
      websiteUrl: true,
      primaryColor: true,
      secondaryColor: true,
    },
  });
});

export type PublicAirline = NonNullable<
  Awaited<ReturnType<typeof getPublicAirline>>
>;

/** Fallback brand colors when the airline hasn't set theirs */
export const FALLBACK_PRIMARY = '#4F46E5';
export const FALLBACK_SECONDARY = '#1F2937';
