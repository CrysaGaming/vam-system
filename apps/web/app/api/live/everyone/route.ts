import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const BOT_URL = process.env.BOT_HTTP_URL ?? 'http://localhost:3001';
const BOT_SECRET = process.env.BOT_EVENTS_SECRET ?? '';

type PublicPilot = {
  cid: number;
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  groundSpeed: number;
  heading: number;
  onGround: boolean;
  aircraftType: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
};

type BotResponse = {
  vatsim: {
    count: number;
    updatedAt: string | null;
    pilots: PublicPilot[];
  };
  ivao: {
    count: number;
    updatedAt: string | null;
    pilots: PublicPilot[];
  };
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
    const res = await fetch(`${BOT_URL}/public-pilots`, {
      headers: {
        Authorization: `Bearer ${BOT_SECRET}`,
      },
      // Cache for 15 seconds at edge - this endpoint is shared across users
      next: { revalidate: 15 },
    });

    if (!res.ok) {
      console.error(`Bot bridge returned ${res.status}`);
      return NextResponse.json(
        { error: 'Bot bridge unreachable' },
        { status: 502 },
      );
    }

    const data: BotResponse = await res.json();

    return NextResponse.json(data);
  } catch (err) {
    console.error('Failed to fetch from bot:', err);
    return NextResponse.json(
      { error: 'Bot bridge fetch failed' },
      { status: 502 },
    );
  }
}