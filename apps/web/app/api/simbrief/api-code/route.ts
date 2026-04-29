import { auth } from '@/auth';
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * SimBrief Pattern Z — API-Code endpoint (server-side md5 hashing).
 *
 * Mirrors the upstream `simbrief.apiv1.php?api_req=…` behaviour from the
 * SimBrief Partner-API sample (Release 1.1, Derek Mayer / SimBrief). The
 * upstream PHP performs `md5($SIMBRIEF_API_KEY . $_GET['api_req'])` and
 * returns `var api_code = "<hash>";` as a JavaScript snippet that is then
 * dynamically loaded as a `<script>` tag by the vendored
 * `/public/simbrief.apiv1.js`. Routing this through Next.js keeps the API
 * key server-side per SimBrief's own guidance (forum thread 22391, January
 * 2026): "Not recommended to perform the API key hashing in the front end."
 *
 * This route therefore intentionally returns `text/javascript` rather than
 * JSON — the client never sees the key, only the resulting hash.
 */
export async function GET(req: NextRequest) {
  // Only authenticated VAM users may trigger SimBrief dispatches. This adds
  // a layer that the upstream PHP demo does not have, since the demo runs
  // on a public dispatch page; in our app every dispatch is bound to a
  // booking owned by a logged-in pilot.
  const session = await auth();
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const apiKey = process.env.SIMBRIEF_API_KEY;
  if (!apiKey) {
    // Pattern Z degrades gracefully: without a key, the dispatch flow is
    // simply unavailable. Pattern α (full-tab redirect) remains the
    // available path. Returning 503 here surfaces the misconfiguration to
    // the dispatching client without exposing whether the key is unset
    // versus malformed.
    return new NextResponse(
      '/* SimBrief API key not configured */',
      {
        status: 503,
        headers: { 'Content-Type': 'application/javascript' },
      },
    );
  }

  const apiReq = req.nextUrl.searchParams.get('api_req');
  if (!apiReq) {
    return new NextResponse(
      '/* missing api_req parameter */',
      {
        status: 400,
        headers: { 'Content-Type': 'application/javascript' },
      },
    );
  }

  const apiCode = createHash('md5').update(apiKey + apiReq).digest('hex');

  return new NextResponse(`var api_code = "${apiCode}";`, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      // The hash is unique per dispatch attempt (incorporates timestamp +
      // outputpage + flight params) so caching would only ever help an
      // attacker. Make it explicit.
      'Cache-Control': 'no-store',
    },
  });
}
