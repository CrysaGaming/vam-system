import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { NextResponse } from 'next/server';

const BOT_URL = process.env.BOT_HTTP_URL ?? 'http://localhost:3001';
const BOT_SECRET = process.env.BOT_EVENTS_SECRET ?? '';

type DecodedMetar = {
  station: string;
  observedAt: string | null;
  wind: {
    direction: number | null;
    speed: number;
    gust: number | null;
    variableFrom: number | null;
    variableTo: number | null;
  } | null;
  visibility: string | null;
  weather: string[];
  clouds: Array<{ coverage: string; base: number; type: string | null }>;
  temperature: number | null;
  dewpoint: number | null;
  pressure: {
    qnhHpa: number | null;
    altimeterInHg: number | null;
  };
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
};

type CachedMetar = {
  icao: string;
  raw: string;
  decoded: DecodedMetar | null;
  fetchedAt: string;
};

type BotMetarResponse = {
  count: number;
  metars: Record<string, CachedMetar>;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!BOT_SECRET) {
    return NextResponse.json(
      { error: 'BOT_EVENTS_SECRET not configured' },
      { status: 500 },
    );
  }

  try {
    // Bot-Cache abfragen
    const botRes = await fetch(`${BOT_URL}/metars`, {
      headers: { Authorization: `Bearer ${BOT_SECRET}` },
      next: { revalidate: 60 },
    });

    if (!botRes.ok) {
      console.error(`[METAR API] Bot bridge returned ${botRes.status}`);
      return NextResponse.json(
        { error: 'Bot bridge unreachable' },
        { status: 502 },
      );
    }

    const botData: BotMetarResponse = await botRes.json();

    // Airport-Coords aus DB joinen, damit Frontend das direkt rendern kann
    const icaos = Object.keys(botData.metars);
    if (icaos.length === 0) {
      return NextResponse.json({ count: 0, airports: [] });
    }

    const airports = await prisma.airport.findMany({
      where: { icao: { in: icaos } },
      select: {
        icao: true,
        iata: true,
        name: true,
        city: true,
        country: true,
        latitude: true,
        longitude: true,
      },
    });

    const airportMap = new Map(airports.map((a) => [a.icao, a]));

    // Combine: nur Airports zurückgeben die wir auch in DB haben (mit Coords)
    const result = icaos
      .filter((icao) => airportMap.has(icao))
      .map((icao) => {
        const airport = airportMap.get(icao)!;
        const metar = botData.metars[icao];
        return {
          airport: {
            icao: airport.icao,
            iata: airport.iata,
            name: airport.name,
            city: airport.city,
            country: airport.country,
            latitude: airport.latitude,
            longitude: airport.longitude,
          },
          metar: {
            raw: metar.raw,
            decoded: metar.decoded,
            fetchedAt: metar.fetchedAt,
          },
        };
      });

    return NextResponse.json({
      count: result.length,
      airports: result,
    });
  } catch (err) {
    console.error('[METAR API] Fetch failed:', err);
    return NextResponse.json(
      { error: 'METAR fetch failed' },
      { status: 502 },
    );
  }
}