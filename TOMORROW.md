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
- [ ] **Pattern Z static_id mismatch:** Manuell `?ofp_id=…` einer
      anderen Booking anhängen → server lehnt ab. Red banner zeigt
      "OFP does not match this booking …" mit Schließen-link.
- [ ] **Pattern Z double-callback:** Browser-reload auf `?ofp_id=…`
      URL → idempotent (kein duplicate cache row).
- [ ] **Pattern Z malformed ofp_id:** `?ofp_id=hacked` → Zod regex
      lehnt ab, Banner zeigt validation-error, kein 500.
- [x] **Pattern Z banner dismiss:** Schließen-link strippt
      `ofp_error` query-param sauber, andere params (falls künftige)
      bleiben erhalten. ✓ verifiziert mit `?ofp_error=callback_failed_test`.
- [ ] **Pattern α 400-no-plan:** Refresh wenn noch nichts generiert →
      "no-plan" status, kein crash, cache wird gelöscht falls existiert.
- [ ] **Cancelled booking refresh:** sowohl Pattern α als auch Z
      lehnen mit "Cannot refresh in state Cancelled" ab.
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

## Day-4 Priority 3 — Pattern Y email vorbereiten

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

## Phase 2 Candidates (post-MVP, ranked, unverändert)

1. **OAuth username auto-fill** (~1-2 days) — eliminiert manual entry friction
2. **Lifecycle-Pattern** (~1 day) — FlightPlanCache → Pirep on file
3. **Override-Hierarchie** (~3-5 days) — Aircraft/Fleet/Airline/Route SB defaults
4. **Booking.scheduledDeparture field** (~0.5 day) — enables deph/depm/dxp
5. **Booking.simBriefStaticId schema cleanup** (~0.5 day) — Field jetzt redundant
6. **Pattern Y implementation** (~2-3 days) — once Navigraph credentials approved

## Open Questions

- ~~**Pattern Z Live-Test bestätigt UX gut?**~~ ✓ **Beantwortet Day-4**:
  Popup-Flow von Click → OFP cached war 2 min (User manuell, mit Login).
  Auto-close + clean-URL-redirect funktioniert. Plan-again-Symmetry +
  Refresh-OFP-Buttons sehen visuell konsistent aus. Pattern Y kann
  damit als "nice-to-have" für später bleiben — kein Blocker für MVP.
  Pattern Y bleibt nice-to-have für: silent OFP ohne SimBrief-Login,
  vAMSYS-style Komfort. Kein MVP-Blocker.
- **`Booking.simBriefStaticId` Field entfernen?** War für Phase-1 Pattern
  α gedacht aber static_id ist jetzt deterministisch aus `booking.id`
  ableitbar. Schema-cleanup commit candidate.
- **`stateStyle` extrahieren?** Aktuell dupliziert in `bookings/[id]/page.tsx`
  und `bookings/page.tsx` — zwei Aufrufer reichen noch nicht für Hoist
  (siehe `cf6478d` Commit-message). Beim dritten Caller hochziehen.

## Notizen

- Working tree dirty: TOMORROW.md modified (this commit), CLAUDE.md just
  committed (`086573c` — stop-policy + hosts-mapping)
- Branch `cc-experiment` HEAD nach diesem Commit ahead `origin/cc-experiment`
  bis push
- Web typecheck clean (last verified Day-3)
- Day-3: 14 Commits gepusht; Day-4 so far: 1 Commit (CLAUDE.md), dieser
  TOMORROW.md sync wird der zweite
- `.claude/settings.local.json` (harness) bleibt untracked
- Browser-Automation tools (Claude in Chrome + Playwright MCP) lokal
  konfiguriert, claude_desktop_config.json hat die paired-device-id.
  Bei nächster Session ggf. Konnektoren wieder per "+"-Toggle aktivieren.

## Day-4 Pending (next session)

Nach Wahl:

- **Edge-Cases durchspielen** (siehe Liste oben — Popup-blocker test,
  static_id mismatch test, double-callback idempotency, malformed ofp_id
  validation, cancelled-booking refresh-rejection, cache-expiry
  regeneration, multi-tenant cross-airline-scoping). Read-only nav
  zumeist, schnell durchspielbar.
- **Pattern Y email** an dev@navigraph.com schreiben (Draft in Priority 3
  oben). Längere Vorlaufzeit für Approval, also lieber früh raus.
- **Schema cleanup**: `Booking.simBriefStaticId` Field entfernen (jetzt
  redundant, ~0.5 day).
- **stateStyle extrahieren**: bei drittem Caller (siehe Open Questions).
