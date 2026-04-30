# Pattern Y — Navigraph OAuth API Access Request

**Date**: 2026-04-30 (Day 4)
**Recipient**: dev@navigraph.com
**Status**: ✉ **SENT 2026-04-30 ~18:30 Berlin** (from kevindrack@gmx.de)
**Reply-window**: 14 days → escalate to forum.navigraph.com on **2026-05-14**
**Background**: see `docs/decisions/2026-04-29-pattern-z-final.md`, Pattern Y section

---

## Context

Pattern Z (Partner-API-Key, popup-based dispatch) is shipped and works
end-to-end as of Day 4. Pattern Y (Navigraph OAuth + private `simbrief`
scope, vAMSYS-style silent flow) remains the desired long-term primary
path because it eliminates the popup and lets pilots stay logged-in on
the VAM-System without bouncing through SimBrief's UI.

Approval timeline is realistic at **1–2 weeks based on forum
observations** (SimBrief staff is active there). The email below is a
clean cold-outreach kick-off.

If no reply within 14 days: post on `forum.navigraph.com` as a
secondary channel — SimBrief staff (Derek and others) read and answer
there actively.

---

## Subject Line

```
OAuth API access request — VAM-System (vam.kevindrack.de)
```

(Short, specific, mentions both the request and the project. Avoids
generic phrases like "Quick Question" which get filtered.)

---

## Email Body (English, plain text on send)

Style note: matches the SimBrief Dispatch-API request email Kevin sent
on 2026-04-29 — same humble, transparent tone, same structure
(disclaimers up front, concrete use cases as a numbered list, explicit
permission-to-defer ending). Both emails should read like the same
person wrote them, because the same person did.

```text
Hi Navigraph dev team,

I would like to request OAuth API access with the private `simbrief`
scope for use in a self-hosted virtual airline management platform.
I started developing five days ago under the working title
"VAM-System" (https://vam.kevindrack.de,
https://github.com/CrysaGaming/vam-system).

A few honest disclaimers up front:

The project is very early-stage. Many things are still open and may
change as it evolves: the final name, the public URL, whether it
stays single-airline or becomes a multi-airline platform, and the
licensing model. Right now everything is open-source. Whether premium
features are added later at a fair price (to cover hosting, licenses,
and running costs without profit motive) is undecided. I want to be
transparent about this rather than promise something I cannot
guarantee for the long term.

About the project:

It is being built as an alternative to vAMSYS and phpVMS for people
who want to run their own infrastructure. Stack is Next.js,
PostgreSQL, NestJS, and TypeScript. VATSIM and IVAO live-tracking are
already implemented, an OBS streaming overlay for pilots is in
production, and SimBrief integration via the Partner Dispatch API key
(kindly provisioned a few days ago by the SimBrief team) is shipped
end-to-end. The primary motivation is offering my own VA members and
fellow pilots a clean, modern flight booking and SimBrief integration
experience.

How I would use the OAuth API:

1. Pilots on the VAM-System dashboard would link their Navigraph
identity once via the standard OAuth Authorization Code flow. The
platform would store the resulting refresh token server-side,
encrypted at rest, scoped to that one pilot.

2. When a pilot books a route from the airline schedule, the platform
would call the SimBrief Dispatch API server-to-server using the
pilot's bearer token to generate a flight plan in the pilot's own
SimBrief account, pre-filled with origin, destination, alternate,
aircraft type, and route. This replaces the current Partner-API
popup hand-off with a silent dispatch — the same pattern vAMSYS
implements.

3. OFP retrieval via the XML/JSON fetcher endpoint to display route,
fuel, weights, and navlog data on the booking detail page, alongside
prefile-buttons for VATSIM and IVAO.

4. Static-ID linking so the flight plan can be re-fetched by the
pilot's ACARS client and aircraft EFB during the actual flight
without manual user input.

The OAuth client credentials would only be used server-side. The
pilot's bearer token is stored encrypted in the platform database
and used exclusively to authenticate API calls on behalf of the
pilot who initiated the booking. The platform never stores
Navigraph or SimBrief account credentials directly. All requests
are made on behalf of an explicitly authenticated pilot who has
linked their Navigraph account in their profile.

Redirect URIs to register:

- Production: https://vam.kevindrack.de/api/oauth/navigraph/callback
- Local dev:  http://localhost:3000/api/oauth/navigraph/callback

I am aware that the project is very young and small, and I would
completely understand if you prefer to wait until it is more mature
before granting OAuth access with the `simbrief` scope. If that is
the case, I am happy to continue with the current Partner-API popup
flow and revisit this request later. Either way, I would appreciate
a brief reply so I know how to proceed.

Thank you for your time.

Best regards,
Kevin Drack
kevindrack@gmx.de
https://github.com/CrysaGaming/vam-system
```

---

## Notes for the User Before Sending

1. **Replace placeholders if any** — none expected, all values are real.
2. **Send from `kevindrack@gmx.de`** to match the sender identity in
   the body and the address used on the SimBrief Dispatch-API request
   (2026-04-29). Keeping one consistent address across both Navigraph
   and SimBrief contact threads avoids any "is this the same person?"
   confusion if dev@navigraph.com cross-references with the SimBrief
   side.
3. **Keep it plain text** — no HTML formatting, no signature block with
   logos. Navigraph's dev contact is small-team and replies usually
   read on phone or terminal mail clients.
4. **Don't attach anything** — first-contact email; if they want
   diagrams/architecture details, they'll ask in a reply.
5. **Don't follow up before 14 days** — gives them a real review window.
   On day 14, switch to forum-post backup (see "Backup channel" below).

## Backup Channel — forum.navigraph.com

If no reply by 2026-05-14:

- Post a thread in the API/Developer category
- Title: "OAuth API access request — VAM-System (multi-tenant VA
  management)"
- Body: very abbreviated version of above, with link to vam.kevindrack.de
- Tag the SimBrief-staff usernames who answer regularly (research:
  Derek, others). DO NOT @-spam multiple staff in the first post.
- Reference the email date so it doesn't look like a parallel
  bypass-attempt: "Sent the same request to dev@navigraph.com on
  2026-04-30, posting here as a secondary channel after no reply for
  two weeks."

## What to Have Ready When They Reply

- A brief technical doc / architecture sketch they can verify
  (server-side token storage, expected request volume, error-handling)
- Working demo URL (vam.kevindrack.de — already public via Cloudflare
  Tunnel)
- Confirmation that VAM-System will keep all SimBrief-derived data
  scoped to the user who generated it (no cross-tenant leakage of
  generated OFPs, which is already enforced via airlineId in the
  current schema)
- Willingness to sign whatever Terms-of-Service or developer agreement
  Navigraph requires for the `simbrief` scope

## Implementation Estimate Once Approved

From `docs/decisions/2026-04-29-pattern-z-final.md` Phase 2 candidates:
**~2-3 days** of focused implementation:

1. NextAuth provider config for Navigraph OAuth (Authorization Code +
   PKCE)
2. Refresh-token storage in `User.navigraphRefreshToken` (encrypted at
   rest)
3. `/api/simbrief/generate` route that fetches a fresh access-token
   server-side and posts to SimBrief's authenticated endpoint
4. Wire into `SimBriefDispatchForm` as preferred mode when the user
   has a linked Navigraph account; Pattern Z + α remain as fallback
5. Settings UI: "Connect Navigraph" button + status indicator
6. Tests: token refresh, expired-token handling, scope validation
