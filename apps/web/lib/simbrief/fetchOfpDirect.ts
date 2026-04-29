import type { ParsedOfp } from './types';
import { parseSimBriefXml } from './parser';

const BASE_URL = 'https://www.simbrief.com/ofp/flightplans/xml';

/**
 * Fetches a SimBrief OFP directly by ofp_id.
 *
 * Pattern Z retrieval mechanism: after the popup closes and the JS bounces
 * back to the booking page with `?ofp_id=…`, we hit the SimBrief CDN
 * directly using the documented per-OFP URL. This is different from
 * Pattern α (fetchOfp.ts), which queries `xml.fetcher.php?username=…&
 * static_id=…` — that endpoint resolves the *latest* OFP for a user, not
 * a specific one.
 *
 * The OFP-ID format is documented in the upstream simbrief.apiv1.php:
 * `<10-digit-timestamp>_<10-char-hash>`. We re-validate it before issuing
 * the network call so a malformed query parameter cannot be coerced into
 * a different SimBrief URL (defense-in-depth — the check-ofp route does
 * the same regex, but this helper may be called from contexts that did
 * not go through the popup flow).
 *
 * The XML payload format is identical to what xml.fetcher.php returns,
 * so parseSimBriefXml is reused unchanged.
 *
 * @throws if the ofp_id format is invalid, the HTTP request fails, or
 *         the response body is not valid SimBrief XML.
 *
 * @example
 * const ofp = await fetchSimBriefOfpDirect('1714400000_abcd1234EF');
 * // ofp.ofpId === '1714400000_abcd1234EF'
 */
export async function fetchSimBriefOfpDirect(
  ofpId: string,
): Promise<ParsedOfp> {
  if (!/^[0-9]{10}_[A-Za-z0-9]{10}$/.test(ofpId)) {
    throw new Error(
      `Invalid SimBrief ofp_id format: ${ofpId}. Expected <timestamp>_<hash>.`,
    );
  }

  const response = await fetch(`${BASE_URL}/${ofpId}.xml`, {
    // The popup flow polls our /api/simbrief/check-ofp until SimBrief
    // confirms the file is present, so by the time this runs the file
    // should be there. Still — a tight timeout protects against SimBrief
    // CDN hiccups.
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `SimBrief CDN returned HTTP ${response.status} for ofp_id ${ofpId}`,
    );
  }

  const xmlText = await response.text();
  return parseSimBriefXml(xmlText);
}
