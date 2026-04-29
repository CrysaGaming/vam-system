import type { ParsedOfp } from './types';
import { parseSimBriefXml } from './parser';

const BASE_URL = 'https://www.simbrief.com/api/xml.fetcher.php';

/**
 * Fetches the latest SimBrief OFP for a given username + static_id pair.
 *
 * Pattern α retrieval mechanism: after the user generates an OFP on
 * simbrief.com (via the dispatch-redirect URL from buildSimBriefDispatchUrl),
 * VAM polls xml.fetcher.php to pull the resulting OFP back. The static_id
 * acts as the bridge between the dispatch-link (which embedded
 * `vam-<bookingId>`) and this retrieval call.
 *
 * Returns null on HTTP 400 — SimBrief's documented "no plan exists for this
 * user/static_id" response. This is expected when the user has not yet
 * clicked Generate on SimBrief; UI should render a "Plan via SimBrief"
 * prompt rather than treat it as an error.
 *
 * Throws on non-400 HTTP failures (5xx, network) or malformed XML. Reuses
 * parseSimBriefXml from parser.ts since SimBrief returns the same OFP-XML
 * format that captureSimBriefOfp consumes when fetching by ofp_id directly.
 *
 * @example
 * const ofp = await fetchSimBriefOfp('CrysaGaming', 'vam-cl9abc');
 * if (ofp === null) {
 *   // No plan generated yet — show "Click Plan via SimBrief" UI
 * } else {
 *   // Render OFP summary
 * }
 */
export async function fetchSimBriefOfp(
  simBriefUsername: string,
  staticId: string,
): Promise<ParsedOfp | null> {
  const params = new URLSearchParams();
  params.set('username', simBriefUsername);
  params.set('static_id', staticId);

  const response = await fetch(`${BASE_URL}?${params.toString()}`);

  if (response.status === 400) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `SimBrief xml.fetcher returned HTTP ${response.status}`,
    );
  }

  const xmlText = await response.text();
  return parseSimBriefXml(xmlText);
}
