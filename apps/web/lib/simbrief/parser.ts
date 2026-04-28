import { XMLParser } from 'fast-xml-parser';
import type { ParsedOfp, SimBriefOfpRaw } from './types';

// Locked to exact domain + path — fail loud on SimBrief endpoint changes.
export const SIMBRIEF_XML_URL_PATTERN =
  /^https:\/\/www\.simbrief\.com\/ofp\/flightplans\/xml\/([^/]+)\.xml$/;

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  trimValues: true,
  parseTagValue: true,
});

const KNOWN_UNITS: ReadonlySet<string> = new Set(['kg', 'kgs', 'lbs']);

export function lbsToKg(lbs: number): number {
  return Math.round(lbs * 0.453592);
}

export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export function extractOfpId(xmlFileUrl: string): string {
  const match = SIMBRIEF_XML_URL_PATTERN.exec(xmlFileUrl);
  if (!match) {
    throw new Error(
      `SimBrief xml_file URL does not match expected pattern: ${xmlFileUrl}`,
    );
  }
  return match[1];
}

export function parseSimBriefXml(xml: string): ParsedOfp {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;

  const ofp = parsed.OFP;
  if (!isObject(ofp)) {
    throw new Error('SimBrief XML root is not <OFP>');
  }

  const params = requireSection(ofp, 'params');
  const general = requireSection(ofp, 'general');
  const fuel = requireSection(ofp, 'fuel');
  const times = requireSection(ofp, 'times');

  const xmlFile = requireString(params, 'xml_file', 'params.xml_file');
  const ofpId = extractOfpId(xmlFile);

  const route = requireString(general, 'route', 'general.route');

  const planRamp = requireNumber(fuel, 'plan_ramp', 'fuel.plan_ramp');
  const units = requireString(params, 'units', 'params.units').toLowerCase();
  if (!KNOWN_UNITS.has(units)) {
    throw new Error(`SimBrief XML has unknown units value: '${units}'`);
  }
  const fuelKg = units === 'lbs' ? lbsToKg(planRamp) : planRamp;

  const estBlock = requireNumber(times, 'est_block', 'times.est_block');
  const blockTimeMin = secondsToMinutes(estBlock);

  return {
    ofpId,
    routeString: route,
    fuelKg,
    blockTimeMin,
    rawResponse: ofp as SimBriefOfpRaw,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSection(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const section = parent[key];
  if (!isObject(section)) {
    throw new Error(`SimBrief XML missing required section: ${key}`);
  }
  return section;
}

function requireString(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`SimBrief XML missing required field: ${path}`);
  }
  return value;
}

function requireNumber(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`SimBrief XML missing or invalid field: ${path}`);
  }
  return value;
}
