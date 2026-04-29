# TOMORROW — Day 4 (30. April 2026)

## Day-3 Achievement (gestern, ~9.5h)

Drei Patterns parallel evaluiert + zwei davon end-to-end shipped.
7 Commits auf origin/cc-experiment:

| Commit    | Scope                                                          |
| --------- | -------------------------------------------------------------- |
| `5967041` | docs: Pattern α decision                                       |
| `323b420` | feat(booking): Pattern α server-side (schema, helpers, actions)|
| `423c9a4` | feat(ui): Pattern α booking-detail page + SimBrief settings    |
| `7ab5ea1` | docs: TOMORROW.md update (now superseded by this file)         |
| `dbb0022` | feat: complete Pattern α baseline — seed ICAO + booking creation|
| `0ca3491` | feat(simbrief): Pattern Z Phase 1 — server-side hashing routes |
| `11376e3` | feat(simbrief): Pattern Z Phase 2 — UI form + callback         |

### Pattern α (fallback path, fully working)

Tab-redirect dispatch via `dispatch.simbrief.com` + xml.fetcher.php
retrieval. Three clicks, no popup, full-tab. Works without any external
credentials. Activates automatically when Pattern Z is unavailable.

### Pattern Z (primary path with Partner-API-Key, fully working)

Popup-based dispatch via the SimBrief Partner-API. One click, mini popup
(600×315) auto-closes after generation, callback via `?ofp_id=…`,
server-side static_id validation, idempotent callback handler. API key
stays server-side per SimBrief's own guidance.

### Pattern Y (Navigraph OAuth + private `simbrief` scope, deferred)

Documented in `docs/decisions/2026-04-29-pattern-z-final.md` as the
roadmap for the silent vAMSYS-style flow. Not implemented — requires
Navigraph dev approval, email to dev@navigraph.com pending.

## Day-4 Priority 1 — LIVE-TEST both patterns

End-to-end mit echtem SimBrief-Account validieren. Pattern Z war noch
nie live getestet (nur typecheck), Pattern α bisher auch nicht.

### Vor dem Test

- [ ] Web läuft (lokal `pnpm --filter @vam/web dev` oder vam.kevindrack.de)
- [ ] DB hat seed-Daten (DLH airline, 12 routes, 6 aircraft)
- [ ] Test-User CrysaGaming OAuth-eingerichtet, airlineId gesetzt
- [ ] `.env` hat `SIMBRIEF_API_KEY` gesetzt (für Pattern Z)
- [ ] Mind. 1 Booking im Created state

### Pattern Z Test-Flow (primary)

1. `/settings` → simBriefUsername "CrysaGaming" eintragen → speichern
2. `/bookings/new` → Route + Network wählen → erstellen
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
      anderen Booking anhängen → server lehnt mit static_id-Fehler
      ab. Console-error sichtbar, page renderet trotzdem.
- [ ] **Pattern Z double-callback:** Browser-reload auf `?ofp_id=…`
      URL → idempotent (kein duplicate cache row).
- [ ] **Pattern Z malformed ofp_id:** `?ofp_id=hacked` → Zod regex
      lehnt ab, kein 500.
- [ ] **Pattern α 400-no-plan:** Refresh wenn noch nichts generiert →
      "no-plan" status, kein crash, cache wird gelöscht falls existiert.
- [ ] **Cancelled booking refresh:** sowohl Pattern α als auch Z
      lehnen mit "Cannot refresh in state Cancelled" ab.
- [ ] **Cache-expiry:** FlightPlanCache.expiresAt nach 6h → Refresh
      regeneriert?

### Bei Fehlern

- Console (Browser DevTools) + Server-Logs sammeln
- Edge-case dokumentieren in eigenem decision-doc
- Vor Fix-Commit: reproduzieren + minimal repro

## Day-4 Priority 2 — Robustness / Polish (je nach Zeit)

### Callback-Error-Banner (Pattern Z UX-Lücke)

Aktuell: wenn `processSimBriefCallback` fehlschlägt, nur `console.error`,
User sieht nichts. Should: Error-banner auf der Page nach Redirect.

Plan:
- `?ofp_callback_error=…` query param appended on failure
- Page rendert dismissable banner wenn param gesetzt
- Banner-content: human-readable error message

### Settings-UI: Pattern Z Verfügbarkeit anzeigen

`SimBriefCard` zeigt aktuell nur den simBriefUsername. Ergänzen um:
- Status-Indicator: "Pattern Z (Popup) verfügbar" wenn API-Key set,
  sonst "Pattern α (Tab-Redirect) verfügbar".
- Hilft Admins zu verstehen welcher Path aktiv ist.

### Bookings-Listing-Page

`/bookings` ist aktuell nicht navigierbar — User muss Detail-Page
URL kennen. Einfache RSC-Liste mit links zu Detail.

### OFP Summary refactor

`<OfpSummary>` helper extrahieren aus booking-detail-page (variant
C+D dedup). ~30 LOC saved, klarere Logik.

## Day-4 Priority 3 — Pattern Y email vorbereiten

Wenn Pattern Z Live-Test gut läuft + UX akzeptabel ist, kann Pattern
Y warten oder kann jetzt parallel gestartet werden.

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

- **Pattern Z Live-Test bestätigt UX gut?** Wenn ja: Pattern Y wird "nice
  to have" statt "must have". Wenn UX schlecht (Popup zu nervig): Pattern
  Y wird Priority.
- **Bookings-Listing nötig?** Für Live-Test reicht direkter URL-Zugriff;
  langfristig brauchen wir Navigation.
- **`Booking.simBriefStaticId` Field entfernen?** War für Phase-1
  Pattern α gedacht aber static_id ist jetzt deterministisch aus
  `booking.id` ableitbar. Schema-cleanup commit candidat.

## Notizen

- Working tree clean (alle Pattern-Z-Files committed in Phase 1+2)
- Branch `cc-experiment` 0 commits ahead origin nach Push
- Web typecheck clean
- 7 Commits Day-3, alle gepusht
- `.claude/settings.local.json` (harness) bleibt untracked
