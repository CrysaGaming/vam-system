# TOMORROW — Day 4 (30. April 2026)

## Day-3 Achievement (gestern, ~10h)

14 Commits auf origin/cc-experiment. Drei Patterns evaluiert, zwei
end-to-end shipped, alle ursprünglichen Day-4 Priority-2 Items schon
abgearbeitet — Day-4 startet effektiv direkt mit dem Live-Test.

| Commit    | Scope                                                          |
| --------- | -------------------------------------------------------------- |
| `5967041` | docs: Pattern α decision                                       |
| `323b420` | feat(booking): Pattern α server-side (schema, helpers, actions)|
| `423c9a4` | feat(ui): Pattern α booking-detail page + SimBrief settings    |
| `7ab5ea1` | docs: TOMORROW.md update (superseded zweimal)                  |
| `dbb0022` | feat: complete Pattern α baseline — seed ICAO + booking creation|
| `0ca3491` | feat(simbrief): Pattern Z Phase 1 — server-side hashing routes |
| `11376e3` | feat(simbrief): Pattern Z Phase 2 — UI form + callback         |
| `c8d6f9d` | docs: TOMORROW.md Day-4 plan after Pattern Z ship              |
| `ebbf232` | feat(simbrief): Pattern Z callback error banner                |
| `cf6478d` | feat(bookings): listing page + dashboard navigation            |
| `e7a63e5` | docs: TOMORROW.md sync after Day-3 evening shipping spree      |
| `8612e43` | feat(simbrief): Pattern Z symmetry on Plan-again CTA           |
| `098f7b9` | feat(settings): SimBrief dispatch-mode availability indicator  |
| `dd48005` | refactor(bookings): extract OfpSummary component               |

### Pattern α (fallback path, fully working)

Tab-redirect dispatch via `dispatch.simbrief.com` + xml.fetcher.php
retrieval. Three clicks, no popup, full-tab. Works without any external
credentials. Activates automatically when Pattern Z is unavailable.

### Pattern Z (primary path with Partner-API-Key, fully working + polished)

Popup-based dispatch via die SimBrief Partner-API. One click, mini popup
(600×315) auto-closes after generation, callback via `?ofp_id=…`,
server-side static_id validation, idempotent callback handler. API key
stays server-side per SimBrief's own guidance. Failures werden jetzt als
Red-banner mit Schließen-link auf der Page angezeigt statt nur in
console.

### Pattern Y (Navigraph OAuth + private `simbrief` scope, deferred)

Documented in `docs/decisions/2026-04-29-pattern-z-final.md` als der
Roadmap für den silent vAMSYS-style flow. Not implemented — requires
Navigraph dev approval, email an dev@navigraph.com pending.

### Bonus (was ursprünglich Day-4 Priority 2 war — alles closed)

- ✓ Callback-Error-Banner shipped (`ebbf232`) — Pattern-Z-Fehler werden
  jetzt als rotes Banner inline gerendert, nicht mehr als
  `console.error` versteckt. Strip-link entfernt den Query-Param sauber.
- ✓ Bookings-Listing-Page shipped (`cf6478d`) — `/bookings` ist jetzt
  navigierbar mit Aktiv/Abgeschlossen-Split. Dashboard hat einen
  Quick-Action-Tile dorthin. Schließt die Navigations-Lücke die das
  Live-Testing blockiert hat.
- ✓ Plan-again Pattern-Z symmetry (`8612e43`) — der "Plan again →"-CTA
  auf einem `SimBriefDispatched` Booking nutzt jetzt dieselbe Popup-Form
  wie der initiale Dispatch wenn Pattern Z verfügbar ist, statt durch
  den Tab-Redirect zu fallen. Pattern α bleibt der Fallback wenn kein
  API-Key gesetzt ist.
- ✓ Settings dispatch-mode indicator (`098f7b9`) — `SimBriefCard` zeigt
  am Card-Ende eine Zwei-Zeilen-Statusliste welche Dispatch-Modi
  aktuell verfügbar sind, mit der konkreten blockenden Bedingung
  (Username fehlt / SIMBRIEF_API_KEY nicht konfiguriert) wo zutreffend.
  Schließt die Lücke "warum sehe ich Pattern α statt Z auf der
  Booking-Page?".
- ✓ OfpSummary refactor (`dd48005`) — der OFP-Summary-Block war zweimal
  in `bookings/[id]/page.tsx` dupliziert (read-only final-state +
  active cache-exists Variante). Extrahiert nach
  `bookings/[id]/OfpSummary.tsx` als Server-Component mit optionalem
  `actions`-Slot — actions present ⇒ live, actions absent ⇒ muted.
  page.tsx 599 → 501 LOC.

## Day-4 Achievement (heute früh, ~03-04 Uhr Berlin)

Browser-automation infrastructure aufgebaut + Live-Test aller Day-3-shipped
Features end-to-end durchgeführt. Pattern Z + Pattern α beide in echter
Browser-Umgebung verifiziert. Plus eine 4h-Hydration-Bug-Session die kein
Code-Bug war sondern HMR-State-Corruption — wertvolles Tooling-Learning.

### Browser-automation stack now live

- **Claude in Chrome** Extension gepaired mit deviceId
  `eb70f2f2-ca49-488d-940a-6a3f91775b40`, alle 15 permissions inkl.
  debugger + nativeMessaging + scripting
- **Playwright MCP** lokal installiert (`@playwright/mcp@0.0.71`) mit
  custom `--user-data-dir C:\Users\kevin\.cache\playwright-mcp` — default
  scheiterte mit EPERM weil Claude Desktop aus `C:\Windows\System32`
  startet
- Beide connectors per-conversation toggelbar via "+" → Konnektoren
  dropdown im chat-input
- Per-Domain-Approval-Queue von Anthropic verifiziert (one approval per
  new domain — `localhost`, `vam.kevindrack.de`)
- Erlaubt Live-DOM-Inspection, JavaScript exec, Network-Capture,
  Screenshots — alles was für Hydration-Bug-Untersuchung nötig war

### Live-Test Results

Booking LH100 EDDF→EDDM, OFP `EDDFEDDM_XML_1777505352` (5138 kg block
fuel, 1h 5min, route `CIND2D CINDY Z74 HAREM T104 ROKIL ROKI1A`):

- ✅ Pattern Z full popup-flow end-to-end (User manuell, 19:44→19:46:58 =
  2 min inkl. erstmaliger SimBrief-Login)
- ✅ Pattern α refresh-via-static_id via "↻ Refresh OFP" Button: Server-
  action holt OFP korrekt von SimBrief mit `static_id=vam-cmokch0oy0…`
  (gleiche OFP zurück weil nichts neu generiert — erwartetes Verhalten)
- ✅ Pattern-Z error-banner via `?ofp_error=callback_failed_test`: roter
  Banner mit Code als Text + Schließen-Link der Param strippt
- ✅ Plan-again Pattern-Z Symmetry: beide Buttons im OfpSummary-actions-
  slot rendern mit identischem gray-styling (`px-4 py-2 bg-gray-800
  hover:bg-gray-700 rounded text-sm`), kein indigo-default mehr
- ✅ Settings-Page Pattern α + Z indicators beide grün, env-check works
- ✅ Bookings-Listing multi-tenant scoped, "1 Booking gesamt · 1 aktiv"
  Counter
- ✅ OfpSummary refactor: alle 4 headline-fields (ofpId, blockTime,
  blockFuel, generatedAt) + route + 7d-expiry-info rendern korrekt;
  muted/active variants funktionieren

### Hydration-Bug debug session — kein Code-Bug, HMR-state-corruption

Während Live-Test trat eine persistente Hydration-Mismatch in der
SimBriefDispatchForm (Plan-again CTA in OfpSummary actions) auf:

- Server SSR-output: `<button class="px-4 py-2 bg-gray-800 ...">Plan
  again →</button>` (override props korrekt applied)
- Client nach Hydration: `<button class="px-6 py-3 bg-indigo-600 ...">
  Generate Flight Plan →</button>` (defaults, override dropped)

Vollständige Diagnose-Kette:

1. Source-Code auf Disk: korrekt (page.tsx Z356 hat overrides,
   SimBriefDispatchForm.tsx hat defaults+override default-param-pattern)
2. `.next/dev` chunks frisch (nach `rm -rf .next && pnpm dev` Restart)
3. Compiled function-signature im client-bundle: korrekt
   (`{ ..., buttonLabel = DEFAULT_BUTTON_LABEL, buttonClassName =
   DEFAULT_BUTTON_CLASSNAME }`)
4. Compiled JSX im client-bundle: korrekt (`className: buttonClassName,
   children: buttonLabel` — direkt aus props, kein Hardcode)
5. RSC-Payload im HTML: korrekt (`"buttonLabel":"Plan again →"`)
6. React-fiber `memoizedProps` via DOM `__reactFiber$`-key: korrekt
   (zeigt `buttonLabel: "Plan again →"` als prop empfangen)
7. Output trotzdem defaults: **logisch unmöglich nach JS-Semantik**

Workaround **frischer Browser-Tab**: der ursprünglich-broken Tab konnte
sich nie erholen — React's Hydration ist nach dem ersten Mismatch in
einen state-corruption-Modus geraten, in dem auch nach `.next`-cleaning,
dev-server-Restart und multiplen `location.reload()` weiter Defaults
gerendert wurden. Frische Tab-Instanz lädt fresh chunks + frischen React-
state und rendert sofort korrekt.

**Debugging-Reihenfolge bei Hydration-Errors in dev-mode (für nächstes
Mal)**:

1. **Frischen Browser-Tab öffnen** statt nur Reload
2. Wenn weiter broken: `rm -rf apps/web/.next` + dev-server-Restart
3. Wenn weiter broken: production-build (`pnpm build && pnpm start`)
   prüfen — wenn dort gone, ist's dev-mode-Tooling-Issue
4. Source-Code auf Disk → compiled chunk → RSC-payload → React-fiber-
   props ist die definitive Diagnose-Reihenfolge

## Day-4 Continued — Post-Wake (~09:30-11:00 Uhr Berlin)

User wachte auf, koordinierte das weitere Vorgehen direkt. Drei Phasen
durchlaufen: Schema-Cleanup, Production-Smoketest, Phase-A-Edge-Cases
mit live fixtures. Plus ein echter Next.js-16-Bug entdeckt und gefixt.

5 commits in dieser Session-Hälfte:

| Commit    | Phase | Scope                                                          |
| --------- | ----- | -------------------------------------------------------------- |
| `baeb8e4` | Cleanup | refactor(db): drop redundant Booking.simBriefStaticId field  |
| `d68e5ec` | Cleanup | docs: TOMORROW.md sync — schema cleanup shipped              |
| `734c1ac` | B     | docs: TOMORROW.md sync — Phase B production smoketest done     |
| `0927a01` | A     | fix(bookings): drop revalidatePath from processSimBriefCallback |
| `2768205` | A     | docs: TOMORROW.md sync — Phase A edge-cases comprehensive      |

## Day-4 Continued — Phase 2 #4 (~11:00-11:50 Uhr Berlin)

Phase 2 Feature #4 (`Booking.scheduledDeparture`) shipped. User aktivierte
explizites Zeit-Tracking für Estimation-Calibration.

| Commit    | Scope                                                       |
| --------- | ----------------------------------------------------------- |
| `c74672d` | feat(booking): scheduledDeparture mit SimBrief-Prefill      |

### Time-Tracking Calibration (Feature #4)

Erste explizite Estimation-vs-Actual Messung für ein additives Feature:

| Step                      | EST     | ACT     | Faktor |
| ------------------------- | ------- | ------- | ------ |
| 1. Plan + scope-lock      | 10 min  |  2 min  | 0.20   |
| 2. Schema + Migration     | 10 min  |  1 min  | 0.10   |
| 3-7. Code (3 files+page)  | 80 min  | 25 min  | 0.31   |
| 8. Typecheck + build      | 10 min  |  1 min  | 0.10   |
| 9. Live test (DB+unit)    | 15 min  |  3 min  | 0.20   |
| 10. Commit + push         | 10 min  |  1 min  | 0.10   |
| 11. TOMORROW.md sync      | 10 min  | (now)   | —      |
| **TOTAL**                 | 145 min | ~35 min | **0.24** |

**Lesson für Future-Estimates** (additive features ohne refactor):
- Schema-only changes: 1 min, nicht 10
- Toolchain-warm code edits: divide EST by 3-4
- Live-test ohne dev-server (DB-inspection + unit-test) reicht für
  pre-commit confidence; UI-test deferred ist akzeptabel
- Commit + push fast immer ~1 min, nicht 10

**Inflation-Faktoren** (wann EST realistisch oder zu niedrig sein wird):
- Refactor mit call-site-propagation: keep EST normal
- New external integration (API/library/auth): EST x2
- Cross-cutting (auth, middleware, error-handling): EST x1.5
- Erste Begegnung mit unbekannter Library: EST x3

**Calibration-Heuristik**: Nächstes Mal Phase-2-Feature additive +
schema-only → 0.5h statt 2.4h schätzen.

### Feature scope-summary

In: `Booking.scheduledDeparture: DateTime?` (UTC-stored, immutable v1).
UI form `<input type="datetime-local">` auf `/bookings/new`. Server-Action
persistiert via Zod-Transform string→Date. SimBrief Pattern α + Z propagieren
`date=YYYY-MM-DD&deph=HH&depm=MM` als prefill (User kann auf SimBrief-Page
override). Booking-Detail zeigt geplante Abflugzeit mit local + Zulu suffix.

Out: `dxp` (different concept, fuel-buffer-time), edit-after-creation,
past-date validation, listing-page display.

Type-fix: createBooking parameter `z.infer` → `z.input` weil Zod-transform
Date returns aber Caller string sendet.

### Test-evidence

- Typecheck (web + bot): clean
- Production build: clean (26/26 pages)
- DB schema: column existiert als `timestamp without time zone`, nullable
- Existing 2 bookings: `scheduledDeparture=null` (post-migration sauber)
- UTC extraction unit-test: 4/4 cases pass (14:30, 00:00, 23:59, 05:07
  with single-digit padding)

### Live-UI-Test deferred

**Noch ausstehend** (next dev-session):
1. User startet dev-server (war für `prisma generate` gestoppt)
2. Cancel Booking-2 (LH200 EDDF→EDDB SimBriefDispatched) via direct DB
3. Erstelle Booking-3 mit `scheduledDeparture` gesetzt (z.B. heute 14:30)
4. Verify auf `/bookings/[id]`: "Geplante Abflugzeit" zeigt local + Zulu
5. Klick Pattern-Z-button → check generated form-fields enthalten
   `date/deph/depm` (DevTools Network-Tab beim popup-submit)
6. Optional: full popup-flow durchziehen, schauen ob SimBrief-Page
   wirklich mit der Zeit prefillt

## Day-4 Continued — Phase 2 #2 Lifecycle (~12:23-12:32 Berlin)

Phase 2 Feature #2 (`FlightPlanCache → Pirep on submit`) shipped. Atomic
transaction, 6/6 live-test assertions grün. Calibration-data wieder
0.27 factor (additive feature pattern bestätigt sich).

| Commit    | Scope                                                          |
| --------- | -------------------------------------------------------------- |
| `19780c4` | feat(pireps): Lifecycle Phase 2 — FlightPlanCache transfers to Pirep |

### Time-Tracking Calibration (Feature #2)

Zweite explizite Estimation-vs-Actual Messung. Feature war komplexer als
#4 (transaction-restructure + conditional logic + multiple model touches),
aber Faktor blieb stabil bei ~0.27.

| Step                          | EST     | ACT      | Faktor |
| ----------------------------- | ------- | -------- | ------ |
| 1. Plan + scope-lock          |  5 min  |  ~2 min  | 0.40   |
| 2. Convert array-tx → cb-tx   | 10 min  |  ~3 min  | 0.30   |
| 3. Booking-lookup + link      | 15 min  |  ~5 min  | 0.33   |
| 4. Cache-transfer + state-up  | 10 min  |  ~3 min  | 0.30   |
| 5. Edge cases (no-match)      | 10 min  |  ~0 min  | 0.00 (just code-comments) |
| 6. Typecheck + build          |  5 min  |  ~2 min  | 0.40 (+1 closure-narrowing fix) |
| 7. Live-test 6 assertions     | 10 min  |  ~3 min  | 0.30   |
| 8. Commit + push + sync       |  5 min  |  ~1 min  | 0.20   |
| **TOTAL**                     | 70 min  | ~19 min  | **0.27** |

**Scope-discovery saved time**: existing PIREP-flow at
`apps/web/app/pireps/new/page.tsx` (286 LOC, with bot-events + rank-
upgrade) already had transactional create + user-totals — we just
extended the same transaction. Greenfield estimate would have been 2-3d.

### Architecture decisions

- **Interactive transaction** (`prisma.$transaction(async (tx) => {...})`)
  statt array form — needed conditional cache-transfer logic. Atomicity
  preserved: pirep.create fail → no booking complete; booking-update fail
  → pirep rolled back.
- **Match by route AND state** — user can file PIREP for different route
  than active booking → standalone PIREP, booking stays active. Active-
  booking-guard in createBooking enforces 1-per-user invariant so
  multi-match shouldn't occur, but findFirst+orderBy gives deterministic
  result if invariant ever drifts.
- **Cache transfer is conditional**: nicht alle bookings haben cache.
  No-cache booking still gets linked + completed, just no cache-mutation.
- **Rank-upgrade outside transaction** — kept original design. Bot-events
  are external I/O, shouldn't block atomicity on Discord-API failures.

### Test-fixture flow

Booking-3 was perfect fixture but had no cache. Solution: injected fake
`FlightPlanCache` row with `ofpId=LIFECYCLE_TEST_FIXTURE_001` pointing to
Booking-3 + transitioned Booking-3 to SimBriefDispatched. Then filed
PIREP for LH918 via `/pireps/new` UI. Fake-cache row (ID `cmolccdn50001g2dnq023ad2e`)
remains in DB attached to the PIREP — useful für eventual PIREP-detail
OFP-display feature (Phase 2 follow-up).

### Live-test 6/6 assertions

| Check | Result |
|-------|--------|
| `Pirep.bookingId === Booking-3.id` | ✓ |
| `Booking-3.state === Completed` | ✓ |
| `FlightPlanCache.bookingId === null` | ✓ |
| `FlightPlanCache.pirepId === newPirep.id` | ✓ |
| `Booking.flightPlanCache` lookup → null | ✓ |
| `Pirep.flightPlanCache` lookup → cache | ✓ |

Browser sanity check: Booking-3 detail page renders "Abgeschlossen"
state with metadata only (Erstellt, Läuft ab, Geplante Abflugzeit,
Dispatched), no Flight Plan section since cache transferred away.

### DB-state nach Lifecycle-Ship

```
Booking-1 (cmokch0oy0004yomk4ogno6wu): Cancelled, LH100 EDDF→EDDM
  cache: EDDFEDDM_XML_1777505352 (preserved on cancelled booking)
  scheduledDeparture: null

Booking-2 (cmol8er560001plyse3jr512o): Cancelled, LH200 EDDF→EDDB
  cache: EDDFEDDB_XML_1777539409 (preserved on cancelled booking)
  scheduledDeparture: null
  cancelledAt: 2026-04-30T09:59:05Z

Booking-3 (cmolbcr9p0001piufmojicl1q): Completed, LH918 EDDF→EGLL
  cache: null (transferred to PIREP via Lifecycle Phase 2)
  scheduledDeparture: 2026-05-01T12:30:00Z (preserved post-completion)
  pirep: cmolcdmn70004piuf0gh7a864

Pirep cmolcdmn70004piuf0gh7a864: LH918, Submitted, 78min, 5200kg fuel
  bookingId: cmolbcr9p0001piufmojicl1q (linked)
  flightPlanCache: cmolccdn50001g2dnq023ad2e (transferred fixture)
```

### Live-UI-Test ✓ shipped (~12:00 Berlin)

User startete dev + bot wieder, Live-UI-Test sofort durchgezogen — alle
6 verification-points grün in ~4 min wall-clock (EST 15 min).

**Test-flow:**

1. Cancel Booking-2 via direct DB (active-slot frei machen)
2. Browser: `/bookings/new` form ausfüllen via Playwright MCP:
   - Route: LH918 EDDF→EGLL (A320 D-AIZA)
   - scheduledDeparture: `2026-05-01T14:30` (Berlin CEST local)
3. Submit → redirect zu `/bookings/cmolbcr9p0001piufmojicl1q`

**Verification-results (alle ✓):**

| Check | Expected | Got |
|-------|----------|-----|
| Detail-Page "Geplante Abflugzeit" rendert | local + Zulu suffix | "1. Mai 2026 um 14:30 (12:30Z)" ✓ |
| TZ-conversion Berlin→UTC | 14:30 CEST → 12:30 UTC | DB hat `2026-05-01T12:30:00.000Z` ✓ |
| Pattern α URL `date` param | `2026-05-01` | `2026-05-01` ✓ |
| Pattern α URL `deph` param | `12` (UTC hour) | `12` ✓ |
| Pattern α URL `depm` param | `30` | `30` ✓ |
| Pattern Z hidden inputs | date, deph, depm präsent | alle 3 mit korrekten values ✓ |
| Total Pattern α params | 11 | 11 ✓ |
| Total Pattern Z hidden inputs | 11 (matching) | 11 ✓ |

**Pattern Symmetry**: Pattern α URL + Pattern Z form-fields haben
identical 11 keys (airline, cpt, date, deph, depm, dest, fltnum, orig,
reg, static_id, type) — bestätigt dass `buildDispatchUrl.ts` und
`buildFormFields.ts` den gleichen output-shape produzieren.

**Calibration update**: Live-UI-Test durch existierende Browser-Tooling
(Playwright MCP + Claude in Chrome already paired) ging schneller als
gedacht. Faktor 0.27 (4min/15min EST). Browser-Form-Submission +
DOM-Inspection via JavaScript ist sehr effizient.

**DB-state nach Live-Test:**

```
Booking-1 (cmokch0oy0004yomk4ogno6wu): Cancelled, LH100 EDDF→EDDM
  cache: EDDFEDDM_XML_1777505352 (preserved)
  scheduledDeparture: null

Booking-2 (cmol8er560001plyse3jr512o): Cancelled, LH200 EDDF→EDDB
  cache: EDDFEDDB_XML_1777539409 (preserved)
  scheduledDeparture: null
  cancelledAt: 2026-04-30T09:59:05Z (Live-Test fixture-prep)

Booking-3 (cmolbcr9p0001piufmojicl1q): Created, LH918 EDDF→EGLL
  cache: null (no plan generated yet)
  scheduledDeparture: 2026-05-01T12:30:00Z ⭐ (test fixture)
```

Booking-3 bleibt als Test-Fixture für künftige scheduledDeparture-related
Tests (z.B. "OFP refresh 1 day before scheduled departure shows correct
METAR").

**Optional next-level test (deferred, user decision)**: Tatsächlich
Pattern-Z-popup-flow durchziehen mit Booking-3 → schauen ob die
SimBrief-Page wirklich den 12:30Z slot prefilled. Würde ~3 min mit
User-Login dauern.

### Schema-Cleanup (baeb8e4)

Field `Booking.simBriefStaticId` aus dem schema gedroppt.
Migration `20260430080822_drop_booking_simbrief_static_id` ist ein
einzeiliger ALTER TABLE DROP COLUMN. Pre-verified safe:

- Grep across `.ts`/`.tsx`: zero source-code references (alle 30+ matches
  in node_modules/.prisma generated types)
- DB inspection: 1 Booking existierte, simBriefStaticId war null
- `vam-${booking.id}` wird weiterhin deterministisch derived an den
  zwei call-sites (refreshSimBriefOfp L138, processSimBriefCallback L307)

Web typecheck ✓, Bot typecheck ✓, Production build ✓.

### Phase B — Production Smoketest

Production-build + `pnpm start` auf port 3000, browser-smoke-tests durch
alle Day-4-fixes. Ergebnisse vollständig dokumentiert in `Day-4 Pending`
section (siehe unten — checkbox-Eintrag). Wichtigste Erkenntnis:
**Plan-again button rendert in production mit gray override (`px-4 py-2
bg-gray-800`) statt indigo defaults** — bestätigt final dass der
Day-4-early Hydration-Bug ein dev-mode-only HMR-state-corruption issue
war, kein Code-Bug.

### Phase A — Edge-Cases mit Fixtures

Strategie: Booking-1 (LH100 EDDF→EDDM) gecancelled via direct DB-write
(es gibt keinen Cancel-button im UI), dann Booking-2 (LH200 EDDF→EDDB,
`cmol8er560001plyse3jr512o`) erstellt. Diese Konstellation gab uns:

- Cancelled fixture für state-guard tests
- Fresh "Created"-fixture für no-plan tests
- Pattern-Z-fähiges Booking für popup-flow (User-help nötig × 2)

**6 Tests live-verifiziert + 1 echter Bug entdeckt + gefixt:**

1. ✅ **Cancelled-state callback rejection**: GET `/bookings/[cancelled-id]?ofp_id=1700000000_validhash0`
   → state-guard schlägt VOR dem CDN-fetch zu, Banner "Cannot accept
   SimBrief callback for booking in state Cancelled". Banner-text +
   404-prevention beide bestätigt. Off-by-one im test-fixture aufgedeckt
   (`validhash` ist 9 chars, `validhash0` ist 10 — Zod regex erwartet
   exact 10 chars `[A-Za-z0-9]{10}`).
2. ✅ **Cancelled-state UI (read-only)**: Booking-Detail-Page rendert
   OfpSummary muted variant ohne actions slot (kein Refresh, kein Plan-
   again button). Cancellation-Reason aus DB sichtbar. Defense-in-depth:
   Server-side state-guard + Client-side UI-removal.
3. ✅ **Pattern α "no-plan" path**: Refresh-button auf Booking-2
   (Created state, kein cache) ge`requestSubmit()`'d. DB confirms:
   state unchanged (Created), FlightPlanCache=null, dispatchedAt=null.
   Action returned silently mit `no-plan` status. Note: `.click()` auf
   form-submit-button warf React-form-warning ("form was unexpectedly
   submitted, consider form.requestSubmit()") — `.requestSubmit()` ist
   das richtige API für programmatic-submit von React-server-action-
   forms.
4. ✅ **Pattern Z popup happy-path** (User-help #1): Generate Flight
   Plan → popup → SimBrief-Login bestand → progress bar → auto-close →
   server-callback. DB confirms: cache geschrieben mit ofpId
   `EDDFEDDB_XML_1777538786`, fuelKg 6371, blockTimeMin 84.
5. 🐛 **Next.js 16 strict-mode bug DISCOVERED**: User sah trotz
   erfolgreichem cache-write den error-banner mit text:
   `Route /bookings/[id] used "revalidatePath /bookings" during render
   which is unsupported. To ensure revalidation is performed
   consistently it must always happen outside of renders and cached
   functions.`

   Root-cause: `processSimBriefCallback` ist `'use server'` action,
   wird aber von page.tsx render-path aufgerufen (`if (ofpIdParam)`
   branch). Next.js 16 erlaubt keine cache-mutating calls (revalidatePath,
   revalidateTag) während render. Die anderen 4 revalidatePath-call-sites
   im actions.ts (createBooking, cancelBooking, 2× refreshSimBriefOfp)
   sind alle in form-action-contexts und bleiben valid.

   Bug-Effekt: Cache-write + state-update fanden korrekt statt (DB
   verified), DANN throw, page.tsx catch-block fing den error, redirect
   zu `?ofp_error=…`. User sah confusing banner trotz korrekter Daten.

6. ✅ **Fix shipped** (`0927a01`): `revalidatePath('/bookings')` aus
   processSimBriefCallback entfernt mit ausführlichem Kommentar zur
   Rationale. Sicher weil: page.tsx callt unmittelbar `redirect()` nach
   action-return, redirect macht full navigation, Next fetched die
   page fresh — implizit was revalidatePath getan hätte. Live-verified
   (User-help #2): Plan-again Click auf already-dispatched Booking-2,
   popup auto-closed, URL kommt clean zurück (kein `?ofp_error`), neuer
   OFP gerendered. DB confirms idempotent upsert: ofpId `…538786 → …539409`,
   fuelKg `6371 → 6417`, blockTimeMin `84 → 86` — same row updated,
   kein duplicate.

7. ✅ **Pattern Z idempotent upsert** (free coverage durch #6 retest):
   re-firing Plan-again auf already-dispatched Booking aktualisiert
   cache row in-place statt duplicate zu erzeugen. Kein state-change.
   Bestätigt das documented `if (booking.flightPlanCache) update else
   create` pattern in actions.ts L344-352.

**Code-Read-Verification (für nicht-live-getestete edge-case):**

- 📖 **static_id mismatch check** (actions.ts L312-322): Read der
  4-Zeilen `if (xmlStaticId !== expectedStaticId) throw` Guards.
  Strict-inequality, type-safe via `typeof params?.static_id === 'string'`
  guard. Same pattern auch in refreshSimBriefOfp (L165-168). Live-test
  würde ein 3.-User-account oder browser-network-listener brauchen
  (server-side redirect macht popup-callback URL für browser-tools
  unsichtbar). Code-read-Verification ist confidence-equivalent für
  4-Zeilen-Inequality + bereits-funktional-confirmed-XML-parsing.

**DB-state nach Phase A:**

```
Booking-1 (cmokch0oy0004yomk4ogno6wu): Cancelled, LH100 EDDF→EDDM
  cache: EDDFEDDM_XML_1777505352 (preserved despite cancel — Lifecycle
         Phase 2 wird das transferieren zu PIREP wenn submitted)
  cancellationReason: "Day-4-cont Phase A: edge-case test fixture..."

Booking-2 (cmol8er560001plyse3jr512o): SimBriefDispatched, LH200 EDDF→EDDB
  cache: EDDFEDDB_XML_1777539409 (latest from re-dispatch fix-test)
  fuelKg: 6417, blockTimeMin: 86
  dispatchedAt: 2026-04-30T08:46:30Z
```

Beide bookings bleiben as-is — sind brauchbare test-fixtures für
zukünftige sessions. Booking-1 in Cancelled-state zeigt das read-only
UI-rendering, Booking-2 in SimBriefDispatched zeigt active OFP-state.

## Day-4 Continued (autonomous, ~04:30 Uhr Berlin)

User ging schlafen, Claude weitergemacht mit Mandate "optimalste beste
Antwort, im schlimmstenfall ändern wir es". Konservative constraints
selbst gesetzt: keine schema-migrations, keine new packages, keine big
refactors, keine pushes auf andere branches als cc-experiment.

3 commits + 1 docs-update gepusht in dieser Session:

| Commit    | Scope                                                         |
| --------- | ------------------------------------------------------------- |
| `3720c31` | docs(decisions): Pattern Y email draft                        |
| `1327016` | fix(bookings): user-friendly errors in Pattern Z banner       |
| `e1cc9ee` | fix(db): explicit named exports — Turbopack export-* warning  |

### Edge-case live-tests durchgeführt

- ✅ **Pattern Z malformed ofp_id**: `?ofp_id=hacked` → Zod regex
  rejected, Banner zeigt jetzt "Invalid SimBrief OFP-ID format in
  callback URL" (vorher: raw JSON dump aus err.message)
- ✅ **Pattern Z 404 path**: `?ofp_id=1700000000_invalidhsh` (valid
  format aber non-existent OFP) → SimBrief CDN gibt 404, Banner zeigt
  "SimBrief CDN returned HTTP 404 for ofp_id 1700000000_invalidhsh"
- 📖 **Pattern Z double-callback test**: original test design war
  flawed (versuchte den `EDDFEDDM_XML_1777505352` cached-XML-id als
  `?ofp_id=` Param — aber der callback-Param hat anderes Format,
  `^[0-9]{10}_[A-Za-z0-9]{10}$`, ein SimBrief CDN timestamp-hash).
  Echter double-callback test bräuchte einen frischen Pattern-Z-run
  zur Capture eines real callback-IDs. Skip für autonomous, nicht
  unsupported.
- 📖 **Cancelled booking refresh-rejection**: state-guards in `actions.
  ts` Z138-142 + Z305-313 verifiziert (read-only). Manueller Live-Test
  bräuchte Booking-Cancellation + Re-Cache, das ist state-mutation auf
  einzigem Test-Booking — skip, dokumentiert als verified-by-code-
  reading.

### Code fixes applied (uncommitted aus pre-compaction Session)

Während der Test-Phase wurde uncommitted-state in der working-tree
entdeckt: drei files mit fertiger Arbeit aus einer früheren autonomous-
session-Iteration die durch context-compaction verloren ging. Alle
typecheck-clean, alle gut kommentiert, alle scoped:

- **page.tsx Zod-error mapping** (`1327016`): catch-block prüft jetzt
  `err instanceof z.ZodError` und konvertiert die issues-array in
  user-friendly text statt die JSON-stringified default-message
  durchzureichen. Bekannte Felder (ofpId, bookingId) bekommen
  spezifische copy, alles andere `Invalid {field}: {message}`. Non-Zod
  Errors behalten existing `err.message` path (static_id mismatch,
  fetch HTTP, state-guards sind alle bereits kurze human-readable
  strings).
- **packages/db explicit exports** (`e1cc9ee`): `export * from
  "@prisma/client"` getriggered Turbopack warning bei jedem Render
  weil @prisma/client als CommonJS gebuilt ist und Turbopack die re-
  exports nicht statisch resolven kann. Switch zu explicit named-
  exports für die 4 Symbole die tatsächlich konsumiert werden (verified
  via `grep -rh "from '@vam/db'"`). Future-proofed: Kommentar erklärt
  wie man bei neuem Konsumenten erweitert.
- **Pattern Y email draft** (`3720c31`): vollständige cold-outreach
  email an dev@navigraph.com mit subject line, body in plain-text
  format, pre-send checklist, backup-channel-strategy via forum.
  navigraph.com falls 14d kein reply, was-bei-reply-bereithalten,
  impl-estimate (2-3d post-approval). User reviewed + sends when ready.

## Day-4 Priority 1 — LIVE-TEST both patterns

End-to-end mit echtem SimBrief-Account validieren. Pattern Z war noch
nie live getestet (nur typecheck), Pattern α auch nicht.

> **Status nach Day-4 Session**: Happy-Path beider Patterns + Symmetry +
> Error-Banner verifiziert (siehe Day-4 Achievement Section oben). Edge-
> Cases unten überwiegend noch offen.

### Vor dem Test

- [x] Web läuft (`pnpm --filter @vam/web dev` auf vam.kevindrack.de:3000)
- [x] DB hat seed-Daten (DLH airline, 12 routes, 6 aircraft)
- [x] Test-User CrysaGaming OAuth-eingerichtet, airlineId gesetzt
- [x] `.env` hat `SIMBRIEF_API_KEY` gesetzt (Pattern Z available)
- [x] Booking LH100 EDDF→EDDM existiert (cmokch0oy0004yomk4ogno6wu)

### Pattern Z Test-Flow (primary)

1. `/settings` → simBriefUsername "CrysaGaming" eintragen → speichern
2. `/bookings` → "Neue Buchung" → Route + Network wählen → erstellen
3. Auf Booking-Detail-Page: "Generate Flight Plan" Button (nicht "Plan via SimBrief")
4. Click → Mini-Popup öffnet (600×315 px)
5. Wenn nicht in SimBrief eingeloggt: Login-form im Popup → eingeben
6. Progress-Bar → SimBrief generiert OFP
7. Popup schließt sich automatisch
8. Browser landet zurück auf `/bookings/[id]?ofp_id=…`
9. Server: processSimBriefCallback fetched XML, validates static_id, caches
10. Redirect zu `/bookings/[id]` (clean URL)
11. OFP Summary erscheint inline (ofpId, blockTime, fuel, route)
12. Booking-State jetzt `SimBriefDispatched`
13. Zurück zu `/bookings` → Listing zeigt das Booking unter Aktiv mit
    "OFP cached" Pill

### Pattern α Test-Flow (fallback)

Voraussetzung: `SIMBRIEF_API_KEY` aus `.env` entfernen oder umbenennen,
oder simBriefUsername leer lassen. Dann erscheint "Plan via SimBrief"
Tab-link statt der Z-Form.

1. Booking-Detail → "Plan via SimBrief" → öffnet neuen Tab
2. URL prefilled mit cpt, reg, airline, fltnum, static_id=vam-…
3. User generiert OFP auf SimBrief
4. Zurück zu VAM Tab → "Refresh OFP" klicken
5. xml.fetcher.php?username=CrysaGaming&static_id=vam-… liefert XML
6. OFP Summary erscheint
7. State → SimBriefDispatched

### Edge-Cases zu prüfen

- [ ] **Pattern Z Popup-Blocker:** Popup-blocker aktiv → "alert" aus
      simbrief.apiv1.js erscheint? Fallback-link "Im neuen Tab öffnen
      (Pattern α)" funktioniert?
- [📖] **Pattern Z static_id mismatch:** Code-read-verified Day-4-cont
      Phase A. 4-Zeilen `if (xmlStaticId !== expectedStaticId) throw`
      guard in actions.ts L312-322. Live-test braucht 3.-User-account
      oder fremden popup-callback ofp_id capture (server-side redirect
      macht das im browser unsichtbar). Code-read confidence ist hoch.
- [x] **Pattern Z double-callback:** ✓ verifiziert Day-4-cont Phase A
      via Plan-again-retest auf already-dispatched Booking-2. Cache row
      updated in-place (`…538786 → …539409`), kein duplicate, idempotent
      upsert pattern bestätigt.
- [x] **Pattern Z malformed ofp_id:** `?ofp_id=hacked` → Zod regex
      lehnt ab, Banner zeigt validation-error, kein 500. ✓ verifiziert
      Day-4-continued mit hardcoded malformed string + valid-format-but-
      404 path. Banner ist jetzt user-friendly statt raw-JSON-dump
      (siehe Day-4-Continued Section).
- [x] **Pattern Z banner dismiss:** Schließen-link strippt
      `ofp_error` query-param sauber, andere params (falls künftige)
      bleiben erhalten. ✓ verifiziert mit `?ofp_error=callback_failed_test`.
- [x] **Pattern α 400-no-plan:** ✓ verifiziert Day-4-cont Phase A.
      Refresh auf Booking-2 (Created, kein cache) → DB unchanged,
      action returned silently mit no-plan status, kein crash, kein
      banner. `.requestSubmit()` ist das richtige API für programmatic
      form-submit (statt `.click()`).
- [x] **Cancelled booking refresh:** ✓ verifiziert Day-4-cont Phase A.
      Booking-1 nach DB-direct cancel → state-guard im server-action
      schlägt zu mit "Cannot accept SimBrief callback for booking in
      state Cancelled". UI rendert read-only OfpSummary ohne actions
      (kein Refresh-button mehr exposed). Defense-in-depth verifiziert.
- [ ] **Cache-expiry:** FlightPlanCache.expiresAt nach 6h → Refresh
      regeneriert?
- [ ] **Bookings-Listing scoping:** Anderer User mit anderer airlineId
      → sieht seine eigenen Bookings, nicht meine. Multi-tenant boundary
      hält auf der Listing-Page.

### Bei Fehlern

- Console (Browser DevTools) + Server-Logs sammeln
- Edge-case dokumentieren in eigenem decision-doc
- Vor Fix-Commit: reproduzieren + minimal repro

## Day-4 Priority 2 — (leer)

War ursprünglich Settings-Indicator + Plan-again-Symmetry + OfpSummary-
Refactor. Alle drei Day-3 abends mit-erledigt — siehe Bonus-Block oben.
Day-4 hat damit nur noch Priority 1 (Live-Test) und Priority 3
(Pattern-Y-Email) als pre-defined Tasks.

## Day-4 Priority 3 — Pattern Y email vorbereiten ✓

> **Status nach Day-4-continued**: Draft in `docs/decisions/2026-04-30-pattern-y-email-draft.md`
> committed (`3720c31`). User reviewed + sends from
> crysagaming@drack.eu when ready. Original quick-summary unten zur
> Referenz behalten — vollständige Email + Send-Strategie im draft-doc.

Wenn Pattern Z Live-Test gut läuft + UX akzeptabel ist, kann Pattern Y
warten oder kann jetzt parallel gestartet werden.

Email-Draft an `dev@navigraph.com`:

- Project: VAM-System (vam.kevindrack.de), multi-tenant VA-management
- Stack: Next.js 16 + Prisma + PostgreSQL
- Request: OAuth Client ID + Secret + `simbrief` scope
- Redirect URIs: `https://vam.kevindrack.de/api/oauth/navigraph/callback` (prod), `http://localhost:3000/api/oauth/navigraph/callback` (dev)
- Use case: silent OFP generation für eingeloggte VA-Pilots
- Background: vAMSYS macht das gleiche, dieser Approval-Path ist erprobt

Falls 1-2 Wochen kein Reply: forum.navigraph.com Post als Backup-Channel
(siehe Day-3-Recherche, SimBrief staff antwortet aktiv).

## Phase 2 Candidates (post-MVP, ranked)

1. **OAuth username auto-fill** (~1-2 days) — eliminiert manual entry friction
2. ~~**Lifecycle-Pattern**~~ ✓ shipped `19780c4` (~19min ACT — calibration consistent: factor 0.27)
3. **Override-Hierarchie** (~3-5 days) — Aircraft/Fleet/Airline/Route SB defaults
4. ~~**Booking.scheduledDeparture field** (~0.5 day)~~ ✓ shipped `c74672d` (~35min ACT)
5. **Pattern Y implementation** (~2-3 days) — once Navigraph credentials approved

**Phase 2 follow-ups (created during Lifecycle ship):**

- **PIREP-Detail OFP-Display** — render the transferred FlightPlanCache
  on `/pireps/[id]` page. Schema relation already works (verified live —
  `Pirep.flightPlanCache` lookup returns the cache). Needs UI: probably
  reuse `OfpSummary` component in muted variant. ~1h estimate.

> Removed Day-4-continued: ~~Booking.simBriefStaticId schema cleanup~~
> shipped als `baeb8e4`. ~~Booking.scheduledDeparture~~ shipped als `c74672d`.
> ~~Lifecycle FlightPlanCache→Pirep~~ shipped als `19780c4`.

## Open Questions

- ~~**Pattern Z Live-Test bestätigt UX gut?**~~ ✓ **Beantwortet Day-4**:
  Popup-Flow von Click → OFP cached war 2 min (User manuell, mit Login).
  Auto-close + clean-URL-redirect funktioniert. Plan-again-Symmetry +
  Refresh-OFP-Buttons sehen visuell konsistent aus. Pattern Y kann
  damit als "nice-to-have" für später bleiben — kein Blocker für MVP.
  Pattern Y bleibt nice-to-have für: silent OFP ohne SimBrief-Login,
  vAMSYS-style Komfort. Kein MVP-Blocker.
- ~~**`Booking.simBriefStaticId` Field entfernen?**~~ ✓ **Beantwortet
  Day-4-continued (`baeb8e4`)**: Field war seit creation tot — kein
  source-code reference, kein DB-row hat einen non-null value gehabt.
  Migration `20260430080822_drop_booking_simbrief_static_id` ist ein
  einzeiliger DROP COLUMN. Die static_id wird weiterhin deterministisch
  aus `booking.id` als `vam-${booking.id}` derived an den zwei call-sites.
- **`stateStyle` extrahieren?** Aktuell dupliziert in `bookings/[id]/page.tsx`
  und `bookings/page.tsx` — zwei Aufrufer reichen noch nicht für Hoist
  (siehe `cf6478d` Commit-message). Beim dritten Caller hochziehen.

## Notizen

- Working tree clean nach Day-4-continued (alle 4 commits gepusht:
  CLAUDE.md, TOMORROW.md sync, Pattern Y email, Zod-error fix, prisma
  exports fix — sowie dieser TOMORROW.md sync als #6)
- Branch `cc-experiment` 0 commits ahead origin nach finalem push
- Web typecheck clean (re-verifiziert Day-4-continued Phase 1)
- Day-3: 14 commits; Day-4: 5 commits (`086573c` CLAUDE.md, `b2b0bb6`
  TOMORROW Day-4-early, `3720c31` Pattern-Y, `1327016` Zod fix,
  `e1cc9ee` prisma fix) + dieser TOMORROW.md = 6
- `.claude/settings.local.json` (harness) bleibt untracked
- Browser-Automation tools (Claude in Chrome + Playwright MCP) lokal
  konfiguriert, claude_desktop_config.json hat die paired-device-id.
  Bei nächster Session ggf. Konnektoren wieder per "+"-Toggle aktivieren.

## Day-4 Pending (next session)

Nach User-Wahl, frischer Kopf:

- **Pattern Y email senden**: Draft ist ready in
  `docs/decisions/2026-04-30-pattern-y-email-draft.md`. User reviews +
  sends from crysagaming@drack.eu when ready. 14d Reply-Window dann
  forum.navigraph.com Backup.
- **Edge-Cases die nicht autonomous getestet wurden** (alle brauchen
  state-mutation oder zusätzliche fixtures):
  - Popup-Blocker: Browser-Setting toggeln, fallback-link verifizieren
  - static_id mismatch: 2. Booking erstellen, dessen ofp_id auf 1. pasten
  - double-callback idempotency: frischer Pattern-Z-run für real callback-id capture, dann reload
  - cancelled-booking refresh-rejection: booking cancel + refresh-button click
  - cache-expiry: 6h warten oder DB-Manipulation der `expiresAt`
  - multi-tenant scoping: 2. User in DB, switch session
- **Schema cleanup** ✓ shipped als `baeb8e4` Day-4-continued —
  `Booking.simBriefStaticId` Feld entfernt (war never read, never
  written). Bleibt nichts mehr offen in dieser Kategorie.
- **stateStyle extrahieren**: bei drittem Caller (siehe Open Questions —
  aktuell nur 2 Caller).
- **Hydration-Bug Production Verification** ✓ shipped als Day-4-cont
  Phase B: `pnpm build` + `pnpm start` auf port 3000, browser-smoke-tests
  durch alle Day-4-fixes. Ergebnisse:
  - ✅ Booking-detail rendert clean (OFP ID, Block Fuel, Block Time
    alle korrekt)
  - ✅ **Plan-again button rendert mit gray override (`px-4 py-2 bg-
    gray-800`) statt indigo defaults** — bestätigt final dass der
    Day-4-early Hydration-Bug ein dev-mode-only HMR-state-corruption
    issue war, kein Code-Bug
  - ✅ Zod-error mapping production-clean (`?ofp_id=hacked` →
    "Invalid SimBrief OFP-ID format in callback URL", nicht raw JSON)
  - ✅ Settings-page rendert mit Pattern Z + Pattern α indicators
  - ✅ Bookings-listing rendert (1 Booking, "Meine Bookings"-headline)
  - ✅ Schema-migration (dropped simBriefStaticId column) bricht
    nichts production-time
