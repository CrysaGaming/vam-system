import { auth } from '@/auth';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * SimBrief Pattern Z — OFP-existence check endpoint.
 *
 * Mirrors the upstream `simbrief.apiv1.php?js_url_check=…` behaviour from
 * the SimBrief Partner-API sample. After the dispatch popup closes, the
 * vendored `/public/simbrief.apiv1.js` polls this endpoint to verify that
 * SimBrief actually generated the OFP XML before redirecting the user to
 * the output page. The upstream PHP issues `get_headers()` against
 * `https://www.simbrief.com/ofp/flightplans/xml/{ofp_id}.xml` and replies
 * with a JavaScript snippet `var fe_result = "true|false";`.
 *
 * The reason this lives server-side is the same-origin policy: the JS in
 * the dispatch page cannot directly probe www.simbrief.com from the
 * browser. Routing through our Next.js API avoids CORS entirely.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const ofpId = req.nextUrl.searchParams.get('js_url_check');
  // The upstream JS lets the calling site name the resulting JS variable
  // (defaults to `fe_result`) so the same endpoint can theoretically serve
  // multiple checks on a page. We preserve that contract.
  const varName = (req.nextUrl.searchParams.get('var') ?? 'fe_result').trim();

  // Restrict to a sane identifier so we cannot be coerced into emitting
  // arbitrary JavaScript via the URL parameter.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
    return new NextResponse(
      '/* invalid var name */',
      {
        status: 400,
        headers: { 'Content-Type': 'application/javascript' },
      },
    );
  }

  if (!ofpId) {
    return new NextResponse(
      `var ${varName} = "false";`,
      {
        status: 400,
        headers: { 'Content-Type': 'application/javascript' },
      },
    );
  }

  // OFP IDs follow the upstream format `<10-digit-timestamp>_<10-char-hash>`
  // (see simbrief.apiv1.php line ~107). Strict validation here also makes
  // SSRF impossible — only the SimBrief CDN URL pattern can ever be hit.
  if (!/^[0-9]{10}_[A-Za-z0-9]{10}$/.test(ofpId)) {
    return new NextResponse(
      `var ${varName} = "false";`,
      {
        status: 400,
        headers: { 'Content-Type': 'application/javascript' },
      },
    );
  }

  let exists = false;
  try {
    const res = await fetch(
      `https://www.simbrief.com/ofp/flightplans/xml/${ofpId}.xml`,
      {
        method: 'HEAD',
        // The popup just closed; SimBrief may still be flushing the file
        // to disk. The upstream JS polls this endpoint every 500 ms so a
        // tight per-request timeout is fine — we'd rather a brief false
        // negative than a hung connection blocking the user's browser.
        signal: AbortSignal.timeout(5000),
      },
    );
    exists = res.ok;
  } catch {
    // Network error, timeout, or invalid response — treat as "not yet
    // available" so the JS continues polling.
    exists = false;
  }

  return new NextResponse(`var ${varName} = "${exists ? 'true' : 'false'}";`, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store',
    },
  });
}
