# TOMORROW — Day 4 (30. April 2026)

## Day-3 Achievement (gestern)

Pattern α full-stack Phase 1 KOMPLETT auf origin/cc-experiment:

| Commit | Scope |
|---|---|
| `5967041` | docs: Pattern α architecture decision |
| `323b420` | feat(booking): server-side (schema, helpers, actions) |
| `423c9a4` | feat(ui): booking-detail page + SimBrief settings |

End-to-end User-Flow:
1. `/settings` → simBriefUsername eintragen (SimBriefCard)
2. `/bookings/[id]` → "Plan via SimBrief" Link
3. SimBrief Tab öffnet (dispatch.simbrief.com prefilled)
4. User generiert OFP auf SimBrief
5. Zurück → "Refresh OFP" → server fetched via xml.fetcher.php
6. OFP Summary inline + Booking-State transition zu SimBriefDispatched

## Day-4 Priority 1: LIVE-TEST Pattern α

End-to-end flow validieren mit echtem SimBrief-Account.

**Vor dem Test:**
- [ ] Web auf vam.kevindrack.de oder localhost erreichbar
- [ ] Bot läuft (oder nicht — Bot ist nicht in Pattern α flow)
- [ ] Test-User mit OAuth-eingerichtet (CrysaGaming z.B.)
- [ ] Mind. 1 Test-Booking im Created state

**Test-Flow:**
1. /settings → simBriefUsername "CrysaGaming" eintragen → Speichern
2. SaveStatusBadge zeigt "✓ Gespeichert"? Persistiert nach reload?
3. /bookings/[id] für ein Created Booking
4. "Plan via SimBrief" link → öffnet dispatch.simbrief.com Tab?
5. URL-Params korrekt? (cpt=CrysaGaming, reg=..., static_id=vam-...)
6. SimBrief generiert OFP — flow auf SimBrief-Seite OK?
7. Zurück zu vam.kevindrack.de/bookings/[id] → "Refresh OFP" klicken
8. OFP Summary erscheint? (ofpId, blockTime, fuel, route)
9. Booking-State jetzt SimBriefDispatched? (DB check oder UI badge)
10. Erneutes Refresh: idempotent? Cache-Update?
11. "Plan again" link funktioniert?

**Edge-Cases watchlist:**
- HTTP 400 von xml.fetcher.php (no plan yet) → "no-plan" status, kein crash
- Multi-refresh schnell hintereinander → race?
- Cancelled/Completed booking refresh → schould fail gracefully (state-final-check)
- Cache-expiry handling (FlightPlanCache.expiresAt)

**Bei Fehlern:** 
- Console + server-logs sammeln
- Edge-case in eigenes Issue/decision-doc
- Vor Fix-Commit: reproduzieren + minimal-test

## Day-4 Priority 2 (Optional, je nach Live-Test)

- **Bookings-Listing-Page** (`bookings/page.tsx`): aktuell kein Navigation-Path zu Detail-Pages außer manueller URL. Falls nötig für UX-Test, einfache RSC-Liste.
- **OFP Summary Refactor**: extract `<OfpSummary>` helper aus booking-detail-page um Variant C (active) + Variant D (final readonly) zu deduplizieren. ~30 LOC saved, klarere Logik.
- **Bug-Fixes** aus Live-Test

## Phase 2 Candidates (post-MVP, ranked)

1. **OAuth username auto-fill** (~1-2 days, blockiert ggf. extern Navigraph approval) — eliminiert manual entry friction
2. **Lifecycle-Pattern** (~1 day) — FlightPlanCache transfer zu Pirep on file
3. **Override-Hierarchie** (~3-5 days) — Aircraft/Fleet/Airline/Route SB defaults
4. **Booking.scheduledDeparture field** (~0.5 day) — enables deph/depm/dxp in dispatch URL
5. **Booking.simBriefStaticId schema cleanup** (~0.5 day) — Field jetzt redundant (deterministisch aus booking.id ableitbar)

## Open Questions

- **Phase 2 Reihenfolge?** Lifecycle (klein, backend-only) zuerst oder Override-Hierarchie (groß, UX-design-heavy)?
- **Bookings-Listing nötig vor Live-Test?** Detail-Page direkt erreichbar via DB-id ist OK für Test, aber langfristig braucht's eine Liste.
- **OAuth-flow timing?** Externe Navigraph-Approval ist Lead-time, früh starten wenn Phase-2 das umfasst.

## Notizen

- Working tree clean außer `.claude/settings.local.json` (harness, ignored)
- Branch `cc-experiment` 0 commits ahead origin
- Web + Bot beide ohne typecheck-Errors
