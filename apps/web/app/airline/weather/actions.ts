'use server';

/**
 * Welle P / P1 — Server action for force-refreshing a single airport's
 * weather cache. The /airline/weather page wires this to a per-row
 * "↻ Refresh" button so a dispatcher can pull fresh data without
 * waiting for the 30-minute cache window.
 *
 * Auth: airline-manager (same gate as the page itself). We don't
 * verify the ICAO belongs to a specific airline because METAR data
 * is public — any manager can refresh any airport. The auth check
 * exists only to prevent anonymous abuse of our NOAA quota.
 */

import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { getAirportWeather } from '@/lib/weather/aviation-weather';

export type RefreshResult =
  | { ok: true; icao: string }
  | { ok: false; icao: string; reason: string };

export async function refreshAirportWeather(
  icao: string,
): Promise<RefreshResult> {
  await requireAirlineManagerWithAirlinePage();

  const result = await getAirportWeather(icao, { forceRefresh: true });
  if (!result.ok) {
    return {
      ok: false,
      icao,
      reason: result.detail ?? result.reason,
    };
  }
  // Even on `isStale: true` we count it as ok — the caller got *some*
  // data back, just couldn't reach upstream. The page renders the
  // stale-badge so the manager sees what happened.

  revalidatePath('/airline/weather');
  return { ok: true, icao: result.weather.airportIcao };
}
