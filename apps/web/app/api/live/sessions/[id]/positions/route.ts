import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { NextResponse } from 'next/server';

const MAX_TRAIL_POINTS = 200; // letzte ~100 Min bei 30s-Polling

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  // Load session + verify caller is in the same airline
  const liveSession = await prisma.liveSession.findUnique({
    where: { id },
    select: {
      id: true,
      user: {
        select: { airlineId: true },
      },
    },
  });

  if (!liveSession) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });

  if (
    !currentUser?.airlineId ||
    currentUser.airlineId !== liveSession.user.airlineId
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Load positions in chronological order
  const positions = await prisma.liveSessionPosition.findMany({
    where: { sessionId: id },
    orderBy: { recordedAt: 'asc' },
    take: MAX_TRAIL_POINTS,
    select: {
      latitude: true,
      longitude: true,
      altitude: true,
      groundSpeed: true,
      heading: true,
      onGround: true,
      recordedAt: true,
    },
  });

  return NextResponse.json({
    sessionId: id,
    count: positions.length,
    positions: positions.map((p) => ({
      lat: p.latitude,
      lon: p.longitude,
      alt: p.altitude,
      gs: p.groundSpeed,
      hdg: p.heading,
      onGround: p.onGround,
      at: p.recordedAt.toISOString(),
    })),
  });
}