# VAM Letter-Wellen Roadmap (A-S)

> **Dokument-Typ**: Operative cross-repo Letter-Wellen-Roadmap
> **Stand**: 2026-05-14 (Welle F 5/5 ✅ komplett, G+H als nächstes geplant)
> **Repos**: `vam-system` (cc-experiment) + `VamAcarsClient` (master)
> **Live**: vam.kevindrack.de
>
> **Zweck**:
> 1. Single source of truth für die **letter-Wellen** (A-S) die parallel zur numerischen `Wellen-Roadmap.md` laufen
> 2. Cross-repo-tracking: welche Wellen-features sind vam-system, welche VamAcarsClient, welche beides
> 3. **Status-bilanz** A-F (was ist done) + **detailed scope** F2-H3 (was kommt nächstes) + **brainstorm-bank** I-S (50 options strukturiert)
> 4. Reihenfolge-empfehlung mit dependencies + impact-scores
>
> **Verhältnis zu anderen docs**:
> - `Wellen-Roadmap.md` — numeric Wellen 0-19 (vam-system strategic), referenziert Welle A-E aber nicht F+
> - `acars-client-roadmap.md` — VamAcarsClient repo-spezifisch, deckt Welle A-E ab (Welle A komplett)
> - `vam-master-roadmap.md` — 5-track strategic (Tag 5, teilweise outdated)
> - **Dieses doc** — die operative letter-Wellen-truth, primary reference für daily-work
>
> ---

## Inhaltsverzeichnis

### TEIL A — STATUS-BILANZ (Welle A-F)
1. [Was bereits erledigt ist](#1-was-bereits-erledigt-ist)
2. [Naming-konvention + cross-repo-mapping](#2-naming-konvention)

### TEIL B — RECENTLY-DONE (Welle F)
3. [Welle F — Admin/Airline-Hardening](#3-welle-f--adminairline-hardening) (5/5 ✅ KOMPLETT)

### TEIL C — NEXT (Welle G + H)
4. [Welle G — Pilot Quality-of-Life](#4-welle-g--pilot-quality-of-life) (4 features)
5. [Welle H — Welle-E Follow-ups](#5-welle-h--welle-e-follow-ups) (3 features)

### TEIL D — BRAINSTORM-BANK (Welle I-S, 50 options)
6. [50-Option-Roadmap nach Themen-Wellen](#6-50-option-roadmap)
7. [Reihenfolge-empfehlung Welle I-S](#7-reihenfolge-empfehlung)

### TEIL E — STRATEGIE
8. [Impact-vs-Aufwand-matrix](#8-impact-vs-aufwand-matrix)
9. [Cross-repo-dependencies](#9-cross-repo-dependencies)

---

# TEIL A — STATUS-BILANZ

## 1. Was bereits erledigt ist

### 1.1 Welle A — VamAcarsClient Polish & Hardening (7/7 ✅)

**Repo**: VamAcarsClient master, HEAD `701cf52`
**Released**: v0.1.1 (v0.2.0 mit Welle A bündel-release pending)

| # | Feature | Commit | Emoji |
|---|---|---|---|
| A1 | Telemetry-events to server | — | 📊 |
| A2 | Auto-recovery on network failure | — | 🌐 |
| A3 | Token rotation | — | 🔄 |
| A4 | In-app changelog | — | 📜 |
| A5 | Crash-reports auto-upload | — | 🛟 |
| A6 | Sim-quit detection (BLOCK_OFF auto) | — | 🛬 |
| A7 | Old-logs cleanup (30d retention) | — | 🧹 |

### 1.2 Welle B — PIREP-Enrichment (5/6, B6 deferred)

**Repo**: vam-system cc-experiment
**Status**: B1-B5 done, B6 (weather-provider-strategy) deferred — strategy-doc geschrieben aber kein code

Reference: `docs/weather-provider-strategy.md` für B6-deferral-rationale.

### 1.3 Welle C — Anti-Cheat & Reliability (6/6 ✅)

**Repos**: cross-repo (server + client)

| # | Feature | Commit | Repo |
|---|---|---|---|
| C1 | PirepFlag schema | `848724e` | vam-system |
| C2-C3 | sim-rate + replay-flag detection | `bee247b` | vam-system |
| C4 | /airline/admin/flagged-pireps page | `b15fc9e` | vam-system |
| C5 | GitHub Actions build-workflow | `98adfb1` | VamAcarsClient |
| C6 (server) | rate-limit middleware 90req/60s/user | `fad9178` | vam-system |
| C6 (client) | HeartbeatService rate-limit-gate | `74f57de` | VamAcarsClient |

### 1.4 Welle D — VamAcarsClient Platform (1/5, 3 deferred, 1 blocked)

**Repo**: VamAcarsClient master
**Status**: Only D5 done; D1 out-of-scope (no Mac plans), D2/D3 deferred (Linux build pipeline, native installer), D4 blocked on $200-500 code-signing cert.

| # | Feature | Status | Commit |
|---|---|---|---|
| D1 | Mac build | out-of-scope | — |
| D2 | Linux build pipeline | deferred | — |
| D3 | Native installer (MSI/PKG) | deferred | — |
| D4 | Code-signing cert | blocked $200-500 | — |
| D5 | Demo-mode toggle | ✅ | `4f5995f` |

### 1.5 Welle E — Multi-pilot / mobile / heatmap (5/5 ✅)

**Repos**: cross-repo

| # | Feature | Commit | Repo | Emoji |
|---|---|---|---|---|
| E1 | OBS-overlay HTTP-server | `b510784` | VamAcarsClient | 🎬 |
| E2 | Voice-commands (de-DE) | `713b751` | VamAcarsClient | 🎤 |
| E3 | Mobile-PWA `/m` route | `d2fb450` | vam-system | 📱 |
| E4 | Cockpit-room schema + endpoints | `65722ca` | vam-system | 👥 |
| E5 | Tracks-heatmap on live-map | `9d0e63d` | vam-system | 🔥 |

### 1.6 Welle F — Admin/Airline Hardening (5/5 ✅ KOMPLETT)

**Repo**: vam-system cc-experiment
**Aktueller stand**: Welle F vollständig abgeschlossen, ~3416 LOC über 5 commits.

| # | Feature | Status | Commit |
|---|---|---|---|
| F1 | Audit-log scoped to airline | ✅ | `8ad1481` |
| F2 | Fleet-utilization dashboard | ✅ | `9acb654` |
| F3 | Financial-reports export PDF/CSV | ✅ | `f8b2aca` |
| F5 | Multi-base-management | ✅ | `c2255f9` |
| F4 | Member-onboarding-wizard | ✅ | `6d8ba45` |

## 2. Naming-konvention

### 2.1 Letter-Wellen vs numeric Wellen

**Numeric Wellen 0-19** (`Wellen-Roadmap.md`): strategische langzeit-roadmap, vam-system-fokus, sortiert nach abhängigkeiten und phase-sequencing. Welle 0-4 done, 5-8 als next markiert, 9-19 als later/vision.

**Letter-Wellen A-S** (dieses doc): operative themen-bündel die parallel zur numeric-roadmap als focused-sprints abgearbeitet werden. Jede letter-Welle ist ein cohesives theme (z.B. "Anti-cheat", "Mobile-companion") mit 3-7 features die in einer fokussierten arbeits-session realistisch landen.

**Wie sie zusammenhängen**: letter-Wellen sind oft sub-tracks der numeric-Wellen (z.B. Welle C anti-cheat ist sub-track von Welle 9 ACARS-phase-2, Welle E mobile/heatmap überlappt mit Welle 10 OBS-overlay-erweiterung). Aber sie sind eigenständig priorisiert basierend auf opportunity statt strict dependency-graph.

### 2.2 Cross-repo-mapping

Die letter-Wellen schneiden frei durch repos:

| Welle | Primary repo | Secondary repo |
|---|---|---|
| A | VamAcarsClient | — |
| B | vam-system | — |
| C | both | both |
| D | VamAcarsClient | — |
| E | both | both |
| F | vam-system | — |
| G | vam-system | — |
| H | both | both |
| I-S | (siehe brainstorm-bank §6) | (siehe brainstorm-bank §6) |

### 2.3 Commit-konvention

```
feat(<scope>): <Welle-letter><number> — <kurzbeschreibung> <emoji>
```

Beispiele aus history:
- `feat(tray): A1 — telemetry-events to server 📊`
- `feat(airline): F1 — admin audit-log scoped to airline 📜`

`<scope>` ist subdir-name (web/server/tray/cli/airline/etc.). `<emoji>` ist semantic-marker für scan-bar history.

---

# TEIL B — RECENTLY-DONE

## 3. Welle F — Admin/Airline-Hardening

**Goal**: Airline-admins sollen ihre eigene airline verwalten ohne system-admin-rechte zu brauchen. Tools für audit, finance-export, fleet-overview, member-onboarding, multi-base.

**Status**: 5/5 ✅ KOMPLETT (commits `8ad1481` → `6d8ba45`, ~3416 LOC).

### F1 — Audit-Log für admin-actions ✅ (commit `8ad1481`)

AdminAuditLog scoped to airline via `airlineId` FK + `[airlineId, createdAt]` index. listAuditEntries airlineId-filter (undef=alle, str=that airline, null=non-airline). 3 member-ops gewrapt: assignRole/Rank/removeMember. /airline/admin/audit-log page ~290 LOC mit requireAirlineManagerPage gate, cursor-pagination, filter-chips. Sidebar-link Airline-Admin-section.

**F1.5 backlog**: settings-changes (updateAirlineSettings, updateDiscordTemplates), hub/rank/aircraft CRUD operations. Lower-frequency-actions die in einer follow-up session gewrapt werden können.

### F2 — Fleet-utilization Dashboard ✅ (commit `9acb654`, +1028 LOC)

Page `/airline/dashboard/fleet-utilization` mit period-switch (30d/90d/1y/all), 5 KPIs (active fleet, total-hours, busiest-airframe, busiest-hub, route-coverage). Per-airframe utilization-tables, hub-balance grid (departures vs arrivals pro hub), route-coverage TypeMixBar. Server-aggregation `lib/fleet/utilization.ts` (4 exports: getAirframeUtilization/getHubBalance/getRouteCoverage/rollupByType+summarize). `revalidate=300` cache. CRUD-→ link-pair in widget header von `_components/fleet-utilization.tsx`.

### F3 — Financial-Reports Export PDF/CSV ✅ (commit `f8b2aca`, +724 LOC)

`/api/airline/finance/export?period=30d|90d|1y|all&format=pdf|csv` route mit 3-layer auth (session/role/economyEnabled). PDF via `@react-pdf/renderer` (`lib/finance/report-pdf.tsx`, ~290 LOC, single-page A4 mit airline-header + 4 KPI-grid + per-typ rollup-tabelle + top-100 detail-list). CSV via UTF-8+BOM streaming (9 spalten, RFC-4180 escape). Single-pass in-memory aggregation für byType/revenueSum/expenseSum/netSum. TRANSFER_IN/OUT excluded from revenue/expense totals. Dynamic-import `@react-pdf/renderer` damit cold-start klein bleibt. `<details>` "📄 Bericht exportieren" section in `/airline/finance` mit 4×2 download-link grid.

### F4 — Member-onboarding-Wizard ✅ (commit `6d8ba45`, +1129 LOC)

`/airline/onboarding[?step=1|2|3|4]` 4-step setup-flow für neue airline-member. `User.onboardingCompletedAt DateTime?` field tracked completion. 3-layer auth-cascade (session → airline → !onboardingCompletedAt unless ?force=1). Step 1 profile (name+bio mit 500-cap), step 2 home-base (radio-list aus airline.hubs mit "Airline Primary" badge), step 3 preferences (economy+career switches mit airline-flag-warnings), step 4 done (summary + 4 "what's next" links). 5 server-actions (completeProfileStep/completeBaseStep/completePreferencesStep/completeOnboarding/skipOnboarding) jede idempotent. AcceptButton redirect post-invite-accept: `/dashboard` → `/airline/onboarding`. Server-rendered 4-segment progress-bar mit ✓-marker.

### F5 — Multi-base-Management ✅ (commit `c2255f9`, +535 LOC)

`User.secondaryBaseIcaos String[] @default([])` postgres-array (statt join-table — selten mutierende whitelist). `lib/positioning/bases.ts` (3 exports: getAllBaseIcaos, isAtAnyBase, canAddSecondaryBase). Server-action `updateSecondaryBases` mit 3-layer validation (session+airline → array+ICAO-format → dedupe+whitelist gegen airline.hubs+exclude primary). `SecondaryBasesCard` client-component im /settings profile-tab nach CareerCard: list-and-add pattern, optimistic update via useTransition, hint-states für no-airline/no-hubs/normal. Booking-eligibility-integration deferred als F5.5.

---

# TEIL C — IN-PROGRESS (NEXT)

## 4. Welle G — Pilot Quality-of-Life

**Goal**: Direkte verbesserungen am pilot-experience, kein hardening sondern features die pilots wollen.

### G1 — Flight-Replay Viewer

**Scope**: Page `/pireps/[id]/replay` mit Mapbox + LiveSessionPosition trail playback.
- Timeline-scrubber zum springen zu spezifischen zeitpunkten
- Play/pause/speed-toggle (1x/4x/16x)
- Phase-marker auf timeline (TAXI/CLIMB/CRUISE/DESCENT/APPROACH/LAND)
- Aircraft-icon zeigt position + heading-rotation

**Data**: LiveSessionPosition table (FK Pirep → LiveSession → positions). Existing index `(sessionId, recordedAt)` macht den fetch effizient.

**LOC-estimate**: ~1000-1200 LOC inkl. mapbox-component + timeline-scrubber + playback-state-machine. Größer als F-features weil interaktive playback nicht-trivial ist.

### G2 — PIREP-Photo-Gallery Upload

**Scope**: Pilot kann beim PIREP-edit fotos uploaden, gallery zeigt sie unter dem PIREP-detail-view.

**Status**: `PirepPhoto` model existiert bereits (schema.prisma line 4684 mit FK zu Pirep + author). Nur upload-endpoint + form + viewer-UI fehlen.

**Stack**: Cloudflare R2 für file-storage (sigv4 presigned-urls), oder MVP mit local-disk + serve-via-API.

**LOC-estimate**: ~400-600 LOC inkl. upload-flow + thumbnail-gen + lightbox-viewer.

### G3 — Route-Bidding Marketplace

**Scope**: Pilots bieten auf bestimmte routes für slots im weekly-roster.

**Schema**:
- New `RouteBid` model: FK Route + userId + bidAmount + bidAt
- Cron resolves bids wöchentlich → bookings für gewinner

**Currency**: economy-credits (existing wallet-system) oder karma-points (new). Karma simpler weil keine ökonomie-implikationen.

**LOC-estimate**: ~700-900 LOC inkl. UI-page + bid-actions + resolution-cron.

### G4 — Friends/Follow-System mit Live-Notifications

**Scope**: Pilots können andere pilots followen + werden benachrichtigt bei:
- Followed pilot starts flying (LiveSession.startedAt)
- Followed pilot submits PIREP
- Followed pilot earns award

**Schema**: `PilotFollow` model (followerId, followedId, createdAt).

**Notifications**: Reuse Track 4 #84 inbox-system + push-notifications für PWA-users.

**LOC-estimate**: ~600-800 LOC inkl. follow-button-component + notification-triggers + follower-list-page.

---

## 5. Welle H — Welle-E Follow-ups

**Goal**: Die in Welle E geschaffenen foundations ausbauen. Server-side ist da, jetzt fehlen die client-integrations + edge-features.

### H1 — Cockpit-room Client-Integration (VamAcarsClient)

**Scope**: VamAcarsClient kann an cockpit-rooms teilnehmen.

**Changes**:
- AcarsClientState: room-membership (current-room-id, role)
- EINSTELLUNGEN-tab erweitert um "Cockpit-Räume": list joinable + create-button + join/leave
- HeartbeatService sendet room-id im body
- UI zeigt mit-piloten-im-raum (avatars + status)

**Server-side**: bereits da (E4 cockpit-room endpoints).

**LOC-estimate**: ~600-800 LOC im VamAcarsClient.

### H2 — Mobile-PWA Service-Worker + Manifest

**Scope**: Die `/m` mobile-PWA aus E3 installierbar machen.

**Files**:
- `/m/manifest.webmanifest`: icons (192/512/maskable), theme-color, start_url=`/m`, display=standalone
- Erweitere existing `/sw.js`: caches `/m` page-shell für offline-fallback, plus offline-banner ("offline seit X")

**LOC-estimate**: ~300-500 LOC inkl. icon-generation.

### H3 — Voice-Commands Erweitern (VamAcarsClient)

**Scope**: Mehr commands für VoiceCommandService.

**Neue commands**:
- "VAM cruise altitude" → ansagen aktueller alt
- "VAM descent rate" → ansagen vertical-speed
- "VAM fuel report" → fuel-on-board ansagen
- "VAM emergency declare" → trigger discord-alert + log-entry

**Custom wake-words**: Preferences-feld für user-defined wake-word ("Tower", "Captain", etc.) statt nur "VAM".

**OFP-import via voice**: long-form dictation → parse callsign/dep/arr/route aus gesprochenem text.

**LOC-estimate**: ~500-700 LOC inkl. neue commands + custom-wake-word + OFP-parser-erweiterung.

---

# TEIL D — BRAINSTORM-BANK

## 6. 50-Option-Roadmap

Strukturiert nach themen-Wellen I-S. Jede Welle hat 4-6 options.

### Welle I — Pilot-Analytics & Self-Improvement (5 options)

1. **I1 — Personal stats-page**: per-pilot dashboard mit total-hours, top-routes, type-rating-progress, monthly-flight-graph
2. **I2 — Flight-quality-score**: heuristic landing-quality (g-force, sink-rate, runway-position) + scoring-history
3. **I3 — Personal records**: best-landing, longest-flight, most-hours-single-day, highest-altitude
4. **I4 — Pilot-logbook PDF**: official-style logbook-export für real-world reference oder personal-archive
5. **I5 — Comparison-charts**: pilot vs airline-average vs platform-average (anonymized)

### Welle J — Realism & Sim-Integration (6 options)

6. **J1 — Weather-overlay on live-map**: existing weather data → mapbox layer mit clouds/precipitation/wind-barbs
7. **J2 — METAR/TAF in PIREP-detail**: snapshot der weather-conditions zum flight-zeitpunkt (dep+arr+enroute)
8. **J3 — Navigraph charts integration**: link to navigraph.com/charts/<icao> per airport in booking-flow
9. **J4 — VATSIM/IVAO callsign-sync**: pilot connects VATSIM-id → vam-system zeigt online-status
10. **J5 — Real-time ATC-mode**: opt-in flag das PIREPs nur akzeptiert wenn pilot auf VATSIM angemeldet war
11. **J6 — Aircraft-failures simulation**: zufällige system-failures (engine-out, hydraulic-loss) während flight; pilot muss diversion erklären

### Welle K — Community & Social (5 options)

12. **K1 — Discord-bot integration**: bot postet PIREPs/awards in airline-channel mit rich-embed
13. **K2 — Pilot-blog**: jeder pilot bekommt `/blog/<callsign>` route für trip-reports + reflections
14. **K3 — Photo-of-the-week**: weekly-cron picks best uploaded photo, shown auf homepage
15. **K4 — Pilot-mentorship matching**: junior pilots matched mit senior pilots (rank-based eligibility)
16. **K5 — Inter-airline-trips**: pilot kann temporär für andere airline fliegen (jumpseat-extended)

### Welle L — Airline-Operations (5 options)

17. **L1 — Schedule-generator-v2**: smarter algorithm das hub-balance + aircraft-utilization optimiert
18. **L2 — Crew-pairings**: groupings von outbound+return-flights die der selbe pilot fliegt (~2-tage trip)
19. **L3 — Aircraft-maintenance schedule**: aircraft müssen periodisch grounded sein für maintenance; cron auto-generiert maintenance-events
20. **L4 — Dispatch-room**: shared-state-page für airline-dispatch-team zum koordinieren von operations
21. **L5 — NOTAM-system**: airline-admins können NOTAMs (notices to airmen) für ihre routes/hubs setzen

### Welle M — Economy v2 (5 options)

22. **M1 — Dynamic-pricing**: aircraft-leasing-costs ändern sich basierend auf demand (more bookings = higher)
23. **M2 — Maintenance-costs**: scheduled-maintenance kostet airline-wallet (siehe L3)
24. **M3 — Fuel-pricing per ICAO**: realistic fuel-prices die per-airport variieren (basierend auf real-world data)
25. **M4 — Cargo-flights**: aircraft können cargo statt passagiere fliegen, anderes revenue-modell
26. **M5 — Stock-market (VAMSE)**: airlines können shares ausgeben, pilots kaufen, dividends bei profit

### Welle N — Mobile / Cross-platform (5 options)

27. **N1 — Mobile-PWA cockpit-controls**: phone als ACARS-touchscreen während flight (radio-tune, transponder, etc.)
28. **N2 — Push-notifications**: native push-API für booking-reminders, PIREP-approval, follower-events
29. **N3 — Apple-Watch app**: flight-summary on watch (current-phase, time-to-toc/tod, fuel-remaining)
30. **N4 — Garmin-watch integration**: same für garmin-pilots (different watch-OS)
31. **N5 — Discord-mini-app**: vam in discord activities (view-stats, browse-bookings within discord)

### Welle O — Streaming & Content (5 options)

32. **O1 — Twitch-OAuth foundation**: pilot connects twitch-account, vam knows when they go live
33. **O2 — Live-stream embed**: pilot-profile shows live twitch-stream wenn streaming
34. **O3 — Stream-overlay v2**: extends E1 obs-overlay mit twitch-chat-integration + viewer-count
35. **O4 — Channel-points → tickets**: twitch-viewers können channel-points spenden für booking-slots des streamers
36. **O5 — Auto-clip on landing**: bei BLOCK_ON auto-trigger twitch-clip-API für landing-clip

### Welle P — AI / Smart Features (5 options)

37. **P1 — Auto-generated PIREP-summary**: claude-API generiert kurze flight-summary aus ACARS-data
38. **P2 — Route-recommendations**: per-pilot ML-model recommends routes basierend auf historical-flights
39. **P3 — Anomaly-detection on ACARS**: detect unusual flight-patterns (sudden alt-change, etc.) auto-flag
40. **P4 — Chat-assistant in app**: claude-API powered help-chat ("how do I book a flight?", "show me my next roster")
41. **P5 — Voice-ATC**: claude-API als ATC-simulator, voice-in voice-out via existing speech-stack (E2)

### Welle Q — Internationalization (4 options)

42. **Q1 — i18n foundation**: next-intl integration, de-DE als primary + en-US als secondary
43. **Q2 — Translation-management page**: admin-interface zum editieren von translations ohne code-changes
44. **Q3 — RTL-support**: arabic/hebrew language-support für UI-mirror
45. **Q4 — Localized airport-names**: city-names in user's locale (München vs Munich)

### Welle R — Performance & Polish (5 options)

46. **R1 — Database query-optimization sweep**: alle slow-queries aus admin/perf identifizieren + indexen oder umstrukturieren
47. **R2 — Image-CDN integration**: alle aircraft + airline-logos via cloudflare-images (auto-WebP, on-the-fly resize)
48. **R3 — Lighthouse 100/100 push**: dedicated effort für alle 4 categories (perf/a11y/best-practices/SEO) auf allen public pages
49. **R4 — Page-segment caching strategy review**: alle `export const revalidate` statements audit + tighten
50. **R5 — Bundle-size analysis**: webpack-bundle-analyzer run + identify+reduce top-10 biggest deps

---

## 7. Reihenfolge-empfehlung

Nach **dependency-graph** (was muss vor was kommen) + **impact-vs-effort** (was bringt am meisten pro stunde-arbeit):

### Phase 1 (sequenziell zum start)
1. **Welle G1-G4** (4 features) — direkte pilot-value, kein platform-foundation nötig
2. **Welle H1-H3** (3 features) — Welle E follow-ups, baut auf existing

### Phase 2 (parallele themen, in beliebiger reihenfolge)
3. **Welle I** (analytics) — niedriger aufwand, hoher pilot-value
4. **Welle L** (airline-ops) — admin-themen, builds auf Welle F
5. **Welle N** (mobile) — builds auf E3 mobile-PWA + H2 service-worker

### Phase 3 (advanced, brauchen mehr foundation)
6. **Welle K** (community) — braucht discord-bot (K1) als foundation
7. **Welle J** (realism) — externe APIs (navigraph, VATSIM) erfordern auth-handling
8. **Welle O** (streaming) — braucht twitch-OAuth (O1) als foundation

### Phase 4 (big-ticket items, lange roadmap)
9. **Welle M** (economy v2) — fundamentale economic-modeling, mehrwöchig
10. **Welle P** (AI features) — API-cost-management + UX-design für AI-features
11. **Welle Q** (i18n) — touches every UI-string, lange refactor-projekt
12. **Welle R** (performance) — kontinuierliche maintenance-arbeit

---

# TEIL E — STRATEGIE

## 8. Impact-vs-Aufwand-matrix

```
                Hoch-Impact
                     │
                     │
      F2,G1,G2,J1 ⬤  │  ⬤ P1,P5,M5
       (do soon)     │   (long-term big-bets)
                     │
                     │
    Niedrig ─────────┼───────── Hoch
       Aufwand       │           Aufwand
                     │
                     │
       F4,H2,N2 ⬤    │  ⬤ Q1,M4,L1
       (quick wins)  │   (avoid unless need)
                     │
                Niedrig-Impact
```

### Quick wins (do first wenn zeit knapp)
- **F4 onboarding-wizard** — small effort, big UX-improvement für neue members
- **H2 PWA-manifest** — couple-hour effort, enables homescreen-install on iOS+Android
- **N2 push-notifications** — leverages existing infra (sw.js, inbox)

### Big bets (do wenn fokus-session möglich)
- **G1 flight-replay** — wow-factor feature, viel pilot-engagement
- **M5 stock-market (VAMSE)** — fundamentally new game-layer, multi-month
- **P5 voice-ATC** — combines AI + voice-stack (E2), advanced realism

### Avoid for now (low impact, high effort)
- **Q1-Q4 i18n** — touches everything, no clear ROI bis user-base international ist
- **M4 cargo-flights** — adds complexity ohne clear demand-signal
- **L1 schedule-generator-v2** — current generator works, optimize wenn pain-points zeigen

## 9. Cross-repo-dependencies

```
VamAcarsClient                vam-system
──────────────                ─────────────
                              
Welle A ─────────────────►    (no dependency)
                              
                              ◄───── Welle B (server-features
                                      mostly server-side)
                              
Welle C5,C6 ─────────►        ◄───── Welle C1-C4
        (build pipeline,       (anti-cheat-server)
         rate-limit-gate)      
                              
Welle D5 ────────────►         (no server-dep)
        (demo mode)             
                              
Welle E1,E2 ─────────►        ◄───── Welle E3,E4,E5
        (overlay-server,        (mobile, cockpit-room,
         voice cmds)             heatmap)
                              
                              ◄───── Welle F (alles server)
                              
                              ◄───── Welle G (alles server)
                              
Welle H1,H3 ─────────►        ◄───── Welle H2
        (cockpit-room          (PWA-manifest)
         client, more voice)    
                              
                              ◄───── Welle I (analytics)
                              
Welle L (some) ──────►        ◄───── Welle L (most)
                              
                              ◄───── Welle M (economy)
                              
Welle N1,N3,N4 ──────►        ◄───── Welle N2,N5
        (cockpit-controls,      (push, discord-mini)
         watches)               
                              
Welle O3,O5 ─────────►        ◄───── Welle O1,O2,O4
        (stream-overlay,        (twitch-OAuth, embed,
         auto-clip)              channel-points)
                              
                              ◄───── Welle P,Q,R
                                     (server-only)
```

### Build-order-rules

1. **Server-only Wellen** (B, F, G, I, P, Q, R, plus most of K, M) können standalone vorangetrieben werden — kein VamAcarsClient-release nötig
2. **Client-only Wellen** (A, D) brauchen kein server-coordinate
3. **Cross-repo Wellen** (C, E, H, L, N, O) brauchen sync-deployment: server-features deployen erst wenn client-version mit feature-support live ist

### Release-strategie

- **vam-system**: continuous-deploy via cloudflared, jeder cc-experiment-merge ist live
- **VamAcarsClient**: tagged-releases, v0.X.Y bundle-pattern, mehrere Wellen pro release ok

Aktueller VamAcarsClient-release-status: v0.1.1 ist neueste public, v0.2.0 mit Welle A+C5+C6+D5+E1+E2 pending. Empfehlung: **vor Welle H1 release v0.2.0** damit client-foundation für H stabil ist.

---

> **Pflege dieses docs**:
> - Bei jedem letter-Welle-feature-commit: status-tabelle in §1 oder §3 updaten
> - Bei neuer brainstorm-idea: append zu passender §6-themen-Welle, oder neue Welle aufmachen
> - Bei reihenfolge-change: §7 priorisierung anpassen + rationale in commit-message
