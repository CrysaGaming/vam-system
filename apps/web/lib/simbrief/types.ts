export interface ParsedOfp {
  ofpId: string;
  routeString: string;
  fuelKg: number;
  blockTimeMin: number;
  rawResponse: SimBriefOfpRaw;
}

export type SimBriefOfpRaw = Record<string, unknown>;

export type SimBriefUnits = 'kg' | 'kgs' | 'lbs';
