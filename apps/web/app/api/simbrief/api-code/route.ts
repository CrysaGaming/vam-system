import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { requireUserWithAirline } from '@/lib/auth';

const ApiCodeRequestSchema = z.object({
  orig: z.string().length(4),
  dest: z.string().length(4),
  type: z.string().min(2).max(8),
  timestamp: z.number().int().positive(),
  outputpage: z.string().min(1),
});

// Computes the SimBrief api_code hash for Pattern Z dispatch.
// MD5 of (api_key + orig + dest + type + timestamp + outputpage) — order is
// load-bearing. SimBrief recomputes this hash on its side from the form
// fields the client submits; outputpage in the request body must match the
// outputpage value the client embeds in the dispatch form, byte-for-byte.
//
// WATCH-ITEM: no rate-limit. Add per-user throttle (e.g. 10/h) when SimBrief
// quota becomes a concern. Authenticated-only is sufficient for v1 internal-use.
export async function POST(request: NextRequest) {
  try {
    await requireUserWithAirline();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsed: z.infer<typeof ApiCodeRequestSchema>;
  try {
    const body = await request.json();
    parsed = ApiCodeRequestSchema.parse(body);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Invalid request',
        details: error instanceof Error ? error.message : 'unknown',
      },
      { status: 400 },
    );
  }

  const apiKey = process.env.SIMBRIEF_API_KEY;
  if (!apiKey) {
    console.error('SIMBRIEF_API_KEY env var not set');
    return NextResponse.json(
      { error: 'Service misconfigured' },
      { status: 500 },
    );
  }

  const apiCode = createHash('md5')
    .update(
      `${apiKey}${parsed.orig}${parsed.dest}${parsed.type}${parsed.timestamp}${parsed.outputpage}`,
    )
    .digest('hex');

  return NextResponse.json({ apiCode });
}
