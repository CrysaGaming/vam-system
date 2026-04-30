# Pattern Y — Navigraph OAuth API Access Request

**Date**: 2026-04-30 (Day 4)
**Recipient**: dev@navigraph.com
**Status**: Draft, ready to send. Pending user review + send.
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
OAuth API Access Request — VAM-System (vam.kevindrack.de)
```

(Short, specific, mentions both the request and the project. Avoids
generic phrases like "Quick Question" which get filtered.)

---

## Email Body (English, Markdown formatting stripped on send)

```text
Hi Navigraph dev team,

I'm building VAM-System (https://vam.kevindrack.de), an open
multi-tenant Virtual Airline management platform for flight-sim
pilots. The system handles booking, OFP dispatch, PIREP filing, and
network integration (VATSIM/IVAO/POSCON). It's currently in MVP
development as a solo project.

I'd like to request OAuth API access with the `simbrief` scope so VAM
can generate flight plans on behalf of authenticated pilots in a
silent, browser-redirect flow — the same pattern vAMSYS implements.

# What I'm asking for

- An OAuth Client ID + Client Secret tied to the VAM-System project
- The private `simbrief` scope (in addition to the public scopes
  openid / offline_access / fmsdata)
- Redirect URI registration for:
    - Production: https://vam.kevindrack.de/api/oauth/navigraph/callback
    - Local dev:  http://localhost:3000/api/oauth/navigraph/callback

# Use case

Pilots in a VA log into VAM-System, link their Navigraph account once
via the standard OAuth Authorization Code flow, and from then on the
"Generate Flight Plan" action on a booking can reach SimBrief
server-to-server with the user's bearer token — no popup, no second
login, no manual URL hand-off. The OFP XML is consumed by VAM for
fuel/route/timing display and downstream PIREP filing.

I have a working fallback already shipped:

1. Pattern α — tab-redirect to dispatch.simbrief.com with
   prefilled URL params, then xml.fetcher.php retrieval by static_id.
   No external credentials needed.
2. Pattern Z — Partner-API-Key (already provisioned by Derek on
   2026-04-28) for popup-based dispatch with `?ofp_id=` callback,
   server-side hashing per the published demo, idempotent callback
   handler.

Both work, but the popup is friction users notice. The OAuth path is
the one that turns "manage your VA flights" into a single-sign-on
experience.

# Technical context

- Stack: Next.js 16 (App Router) + Prisma 5 + PostgreSQL 16, deployed
  via Cloudflare Tunnel
- Architecture follows SimBrief staff guidance from
  forum.navigraph.com/t/22391 (API key + hashing kept server-side, never
  exposed to the browser; same will apply to the OAuth bearer token)
- Multi-tenant: airlines are isolated at the airlineId boundary, so a
  VA's pilots only see their own bookings
- Open source intent: the code base is currently private during MVP
  development, will be opened once stable. Happy to discuss licensing
  considerations if relevant.

# About me

Kevin Drack, IVAO 770283, Discord CrysaGaming. Solo developer, this
is a personal project but with intent to grow it into a long-term
shared platform for sim community VAs. I've been a SimBrief and
Navigraph subscriber for several years.

Happy to provide additional context, demo access, or anything else
that would help the review. Looking forward to hearing back.

Thanks,
Kevin Drack
crysagaming@drack.eu
https://vam.kevindrack.de
```

---

## Notes for the User Before Sending

1. **Replace placeholders if any** — none expected, all values are real.
2. **Send from `crysagaming@drack.eu`** to match the sender identity in
   the body. Or the user's preferred professional address — but it
   should match what's in the body.
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
