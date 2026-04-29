# Tomorrow

## Stand 2026-04-28 ~03:18

10 commits ahead of origin/cc-experiment. Pattern Z server-side komplett (API-agnostischer Teil bleibt nutzbar für Pattern Y). UI-Layer NICHT implementiert — wird auch nicht mehr nötig sein.

## Pattern Y Architektur-Discovery — DONE

OAuth-Flow vollständig dokumentiert (siehe docs/decisions/2026-04-28-pattern-z.md). Verbleibend morgen: 3 konkrete Lookup-Tasks, dann Implementation-Plan.

## Vorhandene Investigation-Artefakte

- tmp/navigraph-oauth-flow.har (falls gespeichert) — HAR-Recording vom OAuth-Flow. Enthält Live-Tokens! NICHT committen, NICHT teilen. Morgen: in DevTools "Import HAR" laden für vollständige Scope-List und Response-Headers.

## CRITICAL FIRST ITEM — Navigraph-Developer-Portal

3 Konkrete Lookup-Tasks (~30-60min):

1. Navigraph-Developer-Portal finden + App-Registration:
   - Vermutlich developer.navigraph.com oder navigraph.com/developer
   - OAuth-App-Registration-Flow für VAM-System
   - VAM-System als OAuth-Client registrieren
   - NAVIGRAPH_CLIENT_ID + NAVIGRAPH_CLIENT_SECRET bekommen
   - Callback-URL hinterlegen: https://vam.kevindrack.de/api/oauth/navigraph/callback
   - DEV-Callback ggf zusätzlich: http://localhost:3000/api/oauth/navigraph/callback

2. Vollständige Scope-List rausfinden:
   - HAR-File analysieren — kompletter scope-Parameter im OAuth-URL
   - Welcher Scope grants SimBrief-API-Access
   - Vermutung: 'openid', 'profile', 'simbrief' oder 'fmsdata' o.ä.

3. SimBrief-API-Endpoint mit Navigraph-Bearer-Auth finden:
   - Navigraph hat vermutlich Developer-Docs für SimBrief-Integration
   - Welche URL für OFP-Generation
   - Welches Request-Format
   - Rate-Limits

## Pattern Y Implementation Roadmap (post-Discovery)

1. Schema-Migration: User-Model erweitert um navigraph* Felder (per-User Token-Storage, NICHT auf Airline-Level)
2. /api/oauth/navigraph/start route (requireUser)
3. /api/oauth/navigraph/callback route mit Token-Exchange + per-User-Storage
4. Token-Refresh Server-Action
5. dispatchSimBriefViaNavigraph Server-Action (ersetzt dispatchSimBrief), nutzt aktuelle-User-Tokens
6. UI: User-Settings-Page für "Connect Navigraph" Button (analog vAMSYS) mit Status-Indikator + Disconnect-Action
7. Booking-Detail-Page Update: Dispatch-Button löst direkt Server-Action aus, OFP rendert inline (kein Popup, kein Roundtrip)
8. Inline-Handling falls User nicht verlinkt: Hinweis + Link zu Settings
9. captureSimBriefOfp wird intern von Server-Action gerufen (existiert)
10. Live-Test gegen echten Navigraph+SimBrief

## Pending Sub-Stages (priority order)

1. CRITICAL: Navigraph-Developer-Portal-Discovery (3 Lookups oben)
2. Pattern Y Implementation-Plan finalisieren
3. Schritt 6 expireOverdueBookings (unabhängig, ~30min, kann parallel)
4. Side-Quest .env.example mit NAVIGRAPH_CLIENT_ID + NAVIGRAPH_CLIENT_SECRET Placeholder

## Branch-State

cc-experiment, 10 commits ahead, KEIN Push, working tree clean post-11f0240.
