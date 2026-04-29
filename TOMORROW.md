# Tomorrow / In-Progress

## Stand 2026-04-29 ~16:00

11 commits ahead of origin/cc-experiment (post Day-2 Tag-Schluss).
Pattern α architecture decision finalized. Phase-1-Implementation in progress.

## Pattern α — Architektur-Stand

Pattern Y (OAuth-Server-to-Server) war Fehl-Annahme von 28.04. spät. Korrigiert am 29.04. zu Pattern α (Dispatch-Redirect-Link + xml.fetcher.php). Vollständige Begründung in docs/decisions/2026-04-29-pattern-alpha.md.

OAuth ist NICHT für MVP nötig. simBriefUsername-Manual-Eingabe ist genug für V1.

## Pattern α Phase 1 — Heute Tasks

1. lib/simbrief/buildDispatchUrl.ts Helper schreiben (~80 LOC)
2. lib/simbrief/fetchOfp.ts Helper schreiben (~80 LOC)
3. refreshSimBriefOfp Server-Action in actions.ts erweitern (~60 LOC)
4. UI auf Booking-Detail-Page: "Plan via SimBrief" Link + "Refresh OFP" Button + OFP-Summary inline
5. Cleanup Pattern-Z-Code: api-code/route.ts, dispatchSimBrief, alter buildDispatchUrl

## Pattern α Phase 2 — Post-MVP

### Override-Hierarchie (vAMSYS-Vorbild)

Schema-Erweiterung um SimBrief-Felder auf 4 Ebenen:
- Aircraft (per individual airframe override)
- Fleet (per aircraft type defaults)
- Airline (system defaults)
- Route (per scheduled flight overrides)
- Airport (für Alternate-Settings)

16+ Felder pro Ebene: OFP-Layout, Performance-Code, Weight-Cat, ETOPS, ICAO-Equipment, PBN, Pax/Bag-Weight, OEW/MZFW/MTOW/MLW/MaxFuel, Fuel-Policies (Contingency, Reserve, MEL, ATC, WXX, Extra, Tankering), Alternate-Search-Logic.

buildDispatchUrl erweitern um Inheritance-Resolution: Aircraft → Fleet → Airline → Route-Overrides → final acdata-Object.

Aufwand: ~3-5 Tage. Schema-Migration + UI-Pflegestelle für Owners.

### Lifecycle-Pattern (phpVMS-Vorbild)

FlightPlanCache aktuell direkt an Booking gebunden (cascade delete).

Refactor zu:
- FlightPlanCache.bookingId nullable
- FlightPlanCache.pirepId hinzufügen (nullable)
- Bei PIREP-File: transfer FlightPlanCache von Booking zu Pirep
- OFP überlebt Booking-Stornierung

Aufwand: ~1 Tag. Schema-Migration + actions.ts adapt.

### OAuth-Account-Linking

Optional, falls User-Friction durch manual simBriefUsername-Eingabe erkannt wird.

- Navigraph-Developer-Portal-Registration via Email an dev@navigraph.com
- NAVIGRAPH_CLIENT_ID + NAVIGRAPH_CLIENT_SECRET in .env
- Authorization Code Flow + PKCE (RFC 7636 zwingend per Navigraph-Doku)
- User-Schema-Erweiterung: navigraphAccessToken, navigraphRefreshToken, navigraphTokenExpiresAt, navigraphSubject
- Routes: /api/oauth/navigraph/{start,callback,refresh}
- Token-Refresh-Logic mit one-time-use Refresh-Token-Replacement

Aufwand: ~1-2 Tage + externe Email-Wartezeit für Navigraph-Approval.

## Pending Sub-Stages aus Phase 2 Service-Layer

Diese sind noch offen aus dem Service-Layer-Plan vor Pattern-Z-Pivot:

- Schritt 6 expireOverdueBookings (~30min, unabhängig, kann parallel)
- .env.example mit SIMBRIEF_API_KEY-Placeholder gelöscht (Pattern α braucht keinen Key)

## Branch-State

cc-experiment, 11 commits ahead, KEIN Push. Working tree clean nach diesem Commit.
