# Pattern Z Implementation + Pattern Y Roadmap — 2026-04-29 (Day 3 Evening)

## Status

Pattern α ist committed baseline (commit `dbb0022`). Working full-stack: Booking-Creation, Detail-Page mit "Plan via SimBrief"-Redirect, Settings für simBriefUsername, xml.fetcher-OFP-Refresh.

Pattern Z wird jetzt **als zweite Option implementiert** — mit existing Partner-API-Key (von Derek's Email, 28.04.) und vendored Sample-Files. Pattern Z ersetzt Pattern α NICHT — beide bleiben verfügbar, User wählt.

Pattern Y (Navigraph OAuth + simbrief scope, vAMSYS-style silent flow) wird **parallel als Email-Request** an dev@navigraph.com gestartet. Implementation erst nach Approval (Wochen Wartezeit realistic).

## Findings aus Day-3-Recherche

### vAMSYS-Pattern bestätigt durch User-Screenshots

User hat den vAMSYS-Account-Settings-Flow + Navigraph-Consent-Dialog dokumentiert. Consent-Dialog zeigt scopes:

- Your user identifier (= openid)
- Keep me logged in (= offline_access)
- FMS data API (= fmsdata)
- **SimBrief** ← privater Scope, nicht in public Navigraph-Doku
- Remember my decision

vAMSYS macht den OAuth-Authorization-Code-Flow mit dem privaten `simbrief` scope. Server-zu-Server-Calls zu SimBrief mit Bearer-Token. Kein Popup, vollständig silent. Siehe Image 5 in Discovery-History: vAMSYS synced sogar SimBrief-Airframes (Headwind A339X) — geht nur mit direktem API-Access via OAuth-Token.

### Forum-Research (forum.navigraph.com)

Aktuelle Threads (alle in den letzten 3 Monaten):

- **Thread 22391** (Januar 2026, "OFP Generator"): SimBrief-Staff bestätigt explicit dass API-Key-Hashing **server-side** erfolgen muss. "Not recommended to perform the API key hashing in the front end. This is why the demo files perform the hashing in the backend." → bestätigt unsere Architecture mit Next.js API-Routes.
- **Thread 23230** (April 2026, "Simbrief API V2 JWT"): Andere Devs entwickeln gegen V2 JWT-API. Documentation NICHT public, nur via Approval.
- **Thread 23197** (April 2026, "API Access Request - SmartCIP"): CyberAvia VA implementiert mit Device-Authorization-Flow. SimBrief-Staff confirmed dass dev@navigraph.com der approval-channel ist. SimBrief V2 documentation existiert aber ist private.
- **Thread 22851** (März 2026, "Navigraph API Request"): Approval-Timeline real-world: 3 Wochen, manchmal blockt der User-Email-Provider die Reply. Forum-Post als Backup-Channel funktioniert (SimBrief-Staff antwortet aktiv).
- **Thread 23062** (März 2026): Bestätigt dass FlyHub (flyhub.app) Pattern Z popup in production nutzt, INVA auch. Pattern Z ist der Standard-Path für Apps ohne private OAuth-Partnership.

### Sample-Files studied (tmp/SimBrief_APIv1.zip)

Inhalt:
- README.txt (Release 1.1, 26/08/2021, contact@simbrief.com)
- simbrief.apiv1.js (681 LOC) — popup-launcher + form-submit + checkSBworker-poll + Redirect_caller
- simbrief.apiv1.php (243 LOC) — API-key-hashing endpoint + file-existence-check endpoint + SimBrief-class für output-page
- demo.php + demo_output.php — working integration example
- test-ofp.xml — sample response

Auth-Mechanism (Pattern Z):
1. JS sendet `orig+dest+type+timestamp+outputpage` an PHP
2. PHP returned `md5(API_KEY + params)` als JavaScript-Variable
3. JS submitted Form mit diesem `api_code` an `https://www.simbrief.com/ofp/ofp.loader.api.php` mit `target=SBworker` (Popup)
4. SimBrief validiert hash mit eigenem API-Key (server-side)
5. Popup zeigt Login (falls nicht eingeloggt) + Progress-Bar
6. Popup auto-closes
7. JS detected closed-popup, prüft via PHP ob XML-File existiert
8. Wenn ja: redirect zu outputpage mit `?ofp_id=...`
9. Output-page fetched XML von `https://www.simbrief.com/ofp/flightplans/xml/{ofp_id}.xml`

OFP-ID-Format: `{10-digit-timestamp}_{10-char-hash}` (statt xml.fetcher.php in Pattern α).

## Drei Patterns im Vergleich

| Aspekt | Pattern α (committed) | Pattern Z (jetzt) | Pattern Y (Email pending) |
|---|---|---|---|
| Klicks für OFP | 3 (Plan→Generate→Refresh) | 1 (Generate) | 1 (Generate) |
| Popup | nein | ja, ~2-5 sec wenn logged in | nein |
| Tab-Wechsel | ja, full-tab | nein | nein |
| Auth | keine | API-Key (have) | OAuth Client + simbrief scope (don't have) |
| Server-side hash | n/a | ja (env var) | ja (Bearer token) |
| OFP-Persistierung | per booking | per booking | per booking |
| Status | working | implementing today | needs approval |
| User wählt | ✓ als fallback | ✓ als preferred wenn API-Key set | ✓ als preferred wenn linked |

## Pattern Z Implementation — Phase 1 (heute)

### Environment

- `SIMBRIEF_API_KEY` in `.env` (server-side only, never client-side)
- Optional check at startup: warn if missing → Pattern Z disabled gracefully

### Vendored Files

- `apps/web/public/simbrief.apiv1.js` (681 LOC, von tmp/) — `api_dir` angepasst auf `/api/simbrief/`
- Lizenz: SimBrief APIv1 Release 1.1 © Derek Mayer / SimBrief, used per Partner-API-Key approval

### Neue API Routes

`apps/web/app/api/simbrief/api-code/route.ts`:
- GET handler mit Query-Param `api_req`
- Returns `Content-Type: application/javascript`
- Body: `var api_code = "{md5(SIMBRIEF_API_KEY + req.api_req)}";`
- Replaces `simbrief.apiv1.php?api_req=...` server-side

`apps/web/app/api/simbrief/check-ofp/route.ts`:
- GET handler mit Query-Params `js_url_check` (= ofp_id) + `var` (= variable name)
- Sendet HEAD request zu `https://www.simbrief.com/ofp/flightplans/xml/{ofp_id}.xml`
- Returns `Content-Type: application/javascript`
- Body: `var {var} = "{true|false}";`
- Replaces `simbrief.apiv1.php?js_url_check=...&var=...` server-side

### Phase 1 Done When

- `pnpm --filter @vam/web typecheck` clean
- Routes accessible via curl with mocked SIMBRIEF_API_KEY
- API-Key never logged or exposed to client
- Atomic commit + push to `cc-experiment`

## Pattern Z Implementation — Phase 2 (next)

### Helpers

`apps/web/lib/simbrief/buildFormFields.ts`:
- `buildSimBriefFormFields(booking, user)` → Array `<input>` field configs
- Outputs HTML-form-fields shape: `[{ name: 'orig', value: 'EDDF' }, ...]`
- All Booking + Route + User context als hidden inputs

`apps/web/lib/simbrief/fetchOfpDirect.ts`:
- `fetchSimBriefOfpDirect(ofpId)` → ParsedOfp
- Calls `https://www.simbrief.com/ofp/flightplans/xml/{ofp_id}.xml`
- Reuses existing `parser.ts`
- Cache-headers handled

### Server-Actions erweitern

`apps/web/app/bookings/actions.ts`:
- `processSimBriefCallback(bookingId, ofpId)` → Server-Action
- Triggered after popup-redirect mit `?ofp_id=...`
- Calls fetchOfpDirect + persistiert in FlightPlanCache
- Reuses existing FlightPlanCache schema (per-booking unique)

### UI auf Booking-Detail-Page

`apps/web/app/bookings/[id]/page.tsx`:
- Variant: when SIMBRIEF_API_KEY set + user has simBriefUsername
- Render `<form id="sbapiform">` with hidden inputs (from buildFormFields)
- `<Script>` tag for `/simbrief.apiv1.js`
- Submit button: `onclick="simbriefsubmit('/bookings/[id]?ofp_callback=1')"`
- On query-param `?ofp_id=...`: trigger processSimBriefCallback, redirect to clean URL

### Phase 2 Done When

- End-to-end test: Click Generate → Popup → SimBrief Login → Progress → auto-close → OFP displayed
- Pattern α path bleibt unverändert (fallback)
- Atomic commit + push

## Pattern Y Roadmap (pending Email-Reply)

Email an `dev@navigraph.com` heute geschickt mit:
- Project-description (VAM-System, multi-tenant)
- Request: OAuth Client ID/Secret + `simbrief` scope + V2 JWT docs
- Redirect URIs (prod + dev)

Bei Approval:
1. Schema-Migration: User-Felder navigraphAccessToken, navigraphRefreshToken, navigraphTokenExpiresAt, navigraphSubject (encrypted at rest)
2. Routes: `/api/oauth/navigraph/start`, `/api/oauth/navigraph/callback`, `/api/oauth/navigraph/refresh` (background refresh-token-flow vor expiry)
3. Settings-UI: "Link Navigraph"-Button mit status-indicator
4. Booking-Detail-Page: zusätzliche variant für linked-User → server-side OFP-generation mit Bearer-Token, no popup
5. Pattern α + Z bleiben als fallback für non-linked-Users

Bei Forum-Backup: nach 1-2 Wochen ohne Reply auf forum.navigraph.com posten.

## Decision

Pattern α (commit dbb0022) bleibt working baseline. Pattern Z wird heute Phase 1 implementiert + committed. Phase 2 + Pattern Y separately, je nach Time + Approval.

Pattern Z + α können parallel betrieben werden — VA-Admin entscheidet (env var) welcher Path Default ist.
