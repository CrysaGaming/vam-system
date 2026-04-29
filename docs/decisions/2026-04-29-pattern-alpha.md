# Pattern α — Dispatch-Redirect + xml.fetcher — 2026-04-29

## Status

PIVOT von gestrigem Pattern Y zu Pattern α. Pattern Y (OAuth-basiert für Generate) war auf einer Fehl-Annahme aufgebaut. Nach systematischer Doku-Recherche heute am 29.04. ist klar: es gibt drei separate SimBrief-Mechanismen, kein einheitlicher OAuth-Path.

## Korrektur der Pattern-Y-Annahme

Gestern Nacht (28.04. ~03:00) wurde aufgrund der vAMSYS-Initiator-Chain-Beobachtung angenommen, dass Navigraph-OAuth ein Server-to-Server-Pfad zum SimBrief-OFP-Generate ist. Diese Annahme war FALSCH.

Tatsächlich existieren drei separate Mechanismen:

| Was | Wie | Auth |
|---|---|---|
| Account-Linking + Subscription-Check | OAuth Authorization Code Flow + PKCE | client_id + client_secret + per-User-Authorize |
| OFP generieren (Pattern Z) | apiv1.js Popup | API-Key (per Email beantragen) |
| OFP generieren (Pattern α NEU) | dispatch.simbrief.com/options/custom Redirect | KEINE Auth |
| OFP abholen (read-only) | xml.fetcher.php | KEINE Auth, nur Username/Pilot-ID |

Navigraph-OAuth liefert KEINEN Token zum SimBrief-OFP-Generate. Pattern Y wie gestern formuliert kann nicht implementiert werden.

## Recherche-Bilanz

Quellen die zu dieser Korrektur geführt haben:

1. Navigraph Developer Portal (developers.navigraph.com)
   - Authentication-Sektion (Overview, JWT, PKCE, Authorization-Code, Device-Authorization, Client-Credentials)
   - SimBrief-Sektion (Introduction, How it Works, Using the API, Fetching OFP Data, Layout Options)
   - General/Restrictions

2. Forum-Threads:
   - forum.navigraph.com/t/the-simbrief-api/5298 (offizielle API-Doku)
   - forum.navigraph.com/t/dispatch-redirect-guide/5299 (DER ENTSCHEIDENDE FUND — Dispatch-Redirect ohne API-Key)
   - forum.navigraph.com/t/fetching-a-users-latest-ofp-data/5297 (json=v2 statt json=1)

3. phpVMS GitHub Repo (phpvms/phpvms)
   - Issue #1226: bestätigt static_id-Pattern als {user_id}_{flight_id}
   - Issue #405: simbrief_ofp Schema mit user_id/flight_id/pirep_id Lifecycle
   - PR #1006: SimBrief-Anforderung "User-Check, only own briefings"

4. vAMSYS-Doku (llms-full.txt)
   - Day 2 / Fleet-Setup: "SimBrief is a free flight planning tool [...] pilots access it by linking their Navigraph account"
   - Confirmation: vAMSYS-Server macht keinen OFP-Generate, nur Sub-Check + xml.fetcher
   - Schema-Hierarchie: Aircraft → Fleet → Airline + Airport-Overrides + Route-Overrides

## Pattern α Architektur

User-Workflow:
1. User klickt "Plan via SimBrief"-Link auf VAM Booking-Detail-Page
2. Browser öffnet neuen Tab: `https://dispatch.simbrief.com/options/custom?airline=X&fltnum=Y&type=Z&orig=A&dest=B&deph=H&depm=M&static_id={booking_id}` mit allen Booking-Daten als Query-Parametern
3. User editiert/akzeptiert Optionen auf simbrief.com, klickt "Generate"
4. SimBrief speichert OFP gegen User-Account mit der gegebenen static_id
5. User wechselt zurück zu VAM-Tab
6. User klickt "Refresh OFP"-Button (oder VAM pollt automatisch)
7. VAM-Server holt OFP via `https://www.simbrief.com/api/xml.fetcher.php?username={user.simBriefUsername}&static_id={booking.simBriefStaticId}&json=v2`
8. parser.ts parsed XML/JSON → captureSimBriefOfp persistiert in FlightPlanCache
9. OFP-Summary rendert auf Booking-Detail-Page

## Implementation-Plan Phase 1 (heute, ~3-4h)

### Neue Helper

apps/web/lib/simbrief/buildDispatchUrl.ts (~80 LOC):
- Funktion buildSimBriefDispatchUrl(booking, user) → string
- Baut die dispatch.simbrief.com URL mit Query-Params
- Nutzt: airline, fltnum (route.flightNumber), type (route.aircraft.type), orig, dest, deph/depm (booking.scheduledDeparture), static_id (booking.id oder user.id_booking.id)

apps/web/lib/simbrief/fetchOfp.ts (~80 LOC):
- Funktion fetchSimBriefOfp(username, staticId) → ParsedOfp | null
- Calls https://www.simbrief.com/api/xml.fetcher.php?username=...&static_id=...&json=v2
- Error-Handling für HTTP 400 (kein Plan vorhanden) → returns null
- Reuse existing parser.ts (XML-fallback) oder neuer JSON-parser

### Neue Server-Action

apps/web/app/bookings/actions.ts erweitern:
- refreshSimBriefOfp(bookingId) → existing pattern wie captureSimBriefOfp
- Lädt Booking via requireUserWithAirline + ownership-check
- Lädt User für simBriefUsername (Phase-1 Schema-Field)
- Falls Username fehlt: Error mit Hinweis User-Settings
- Calls fetchSimBriefOfp + persistiert in FlightPlanCache (existing)

### UI auf Booking-Detail-Page

apps/web/app/bookings/[id]/page.tsx (existing) erweitern:
- "Plan via SimBrief"-Link (anchor mit target="_blank", öffnet Tab)
- "Refresh OFP"-Button (form mit refreshSimBriefOfp action)
- Wenn FlightPlanCache vorhanden: OFP-Summary inline rendern
- Wenn User.simBriefUsername fehlt: Inline-Hinweis + Link zu Settings

### Cleanup Pattern-Z-Code

Diese Files/Functions werden gelöscht (nach Implementation):
- apps/web/app/api/simbrief/api-code/route.ts (apiv1.js MD5-Hash, nicht nötig für Pattern α)
- dispatchSimBrief Server-Action in actions.ts (popup-orientiert)
- buildSimBriefDispatchUrl alte Version in actions.ts (replaced durch neuen Helper)

BLEIBT (ist API-agnostisch und Pattern-α-kompatibel):
- apps/web/lib/simbrief/types.ts (ParsedOfp interface)
- apps/web/lib/simbrief/parser.ts (XML-Parser)
- captureSimBriefOfp Server-Action (XML-fetch + parse + cache)
- Booking + FlightPlanCache Schema (alles aus Phase 1)
- User.simBriefUsername + simBriefStaticId Felder (alles aus Phase 1)

## Phase 2 Material (NICHT heute, für später)

### Override-Hierarchie nach vAMSYS-Vorbild

vAMSYS hat eine 4-stufige SimBrief-Settings-Hierarchie:
- Airline-Default (system-wide)
- Fleet-Defaults (per Aircraft-Type)
- Aircraft-Overrides (per individual airframe)
- Route-Overrides (per scheduled flight)
- + Airport-Overrides (für Alternates)

Mit 16+ SimBrief-Felden pro Ebene: OFP-Layout, Performance-Code, Weight-Cat, ETOPS, ICAO-Equipment, PBN, Pax/Bag-Weight, OEW/MZFW/MTOW/MLW/MaxFuel, alle Fuel-Policies (Contingency, Reserve, MEL, ATC, WXX, Extra, Tankering), Alternate-Search-Logic.

Für VAM-System Phase 2 würde das bedeuten:
- Schema-Erweiterung der Aircraft + Fleet + Route Modelle um SB-Felder
- buildDispatchUrl erweitern um Inheritance-Logic
- Settings-UI in Orwell-Equivalent für Owner um defaults zu pflegen

### Lifecycle-Pattern nach phpVMS-Vorbild

phpVMS macht:
- simbrief_ofp.flight_id (nullable)
- simbrief_ofp.pirep_id (nullable)
- Bei PIREP-File: flight_id wird auf null gesetzt, pirep_id wird gesetzt
- Briefing "transferiert" vom Booking zum PIREP

Bei VAM-System aktuell:
- FlightPlanCache.bookingId (NOT NULL, cascade delete)
- Pirep.bookingId (link zurück zum Booking)

Für VAM-System Phase 2 würde das bedeuten:
- FlightPlanCache.bookingId nullable machen
- FlightPlanCache.pirepId hinzufügen (nullable)
- Migration-Logic bei PIREP-File: transfer FlightPlanCache von Booking zu Pirep
- Vorteil: OFP überlebt Booking-Stornierung, kann zu Pirep transferiert werden

### Optional: Voll-OAuth-Linking

Für Subscription-Check + Username-Auto-Fill könnte später Navigraph-OAuth implementiert werden:
- Benötigt: NAVIGRAPH_CLIENT_ID + NAVIGRAPH_CLIENT_SECRET (per Email beantragen bei dev@navigraph.com)
- Authorization Code Flow + PKCE (zwingend per Doku)
- Per-User-Token-Storage in User-Modell: navigraphAccessToken, navigraphRefreshToken, navigraphTokenExpiresAt, navigraphSubject
- Routes: /api/oauth/navigraph/start, /api/oauth/navigraph/callback, /api/oauth/navigraph/refresh
- Vorteile: User muss simBriefUsername nicht manuell eintippen, Subscription-Status verifiziert
- Tradeoff: ~1-2 Tage Aufwand, externe Wartezeit (Navigraph-Approval per Email), Engineering-Komplexität

NICHT für MVP empfohlen. Erst nach erstem Live-Test mit Pilots wenn Username-Manual-Eingabe als Friction-Point identifiziert wird.

## Decision

Pattern α PFAD α Phase 1 wird heute (29.04.) implementiert (~3-4h).
Phase 2 (Override-Hierarchie, Lifecycle, OAuth) wird vermerkt für nach MVP-Launch.
