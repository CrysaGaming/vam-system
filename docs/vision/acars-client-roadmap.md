# VAM ACARS-Client Roadmap

> **Dokument-Typ**: Operative ACARS-Client Roadmap (Was-jetzt-vs-Was-als-nächstes für VamAcarsClient repo)
> **Stand**: 2026-05-13
> **Repo**: [github.com/CrysaGaming/vam-acars-client](https://github.com/CrysaGaming/vam-acars-client) — branch `master`
> **Aktuelle Version**: 0.1.1
>
> **Zweck**:
> 1. Single source of truth für **was am ACARS-Client schon fertig ist**
> 2. **Wellen-strukturierte roadmap** für die nächsten 1-12 monate
> 3. Cross-references zu architektur-docs und SimConnect-catalog
> 4. Successor zu Welle 9 in der [Wellen-Roadmap](./Wellen-Roadmap.md) — die Welle 9 "Phase 2-5" ist im kern-scope abgeschlossen, diese roadmap deckt das post-MVP territory ab.
>
> **Verwandte Docs**:
> - [`acars-architecture.md`](../acars-architecture.md) — System-design + Server-side architecture (Network/DataSource/ACARS-trennung, Pairing-flow, edge-cases)
> - [`simconnect-data-catalog.md`](../simconnect-data-catalog.md) — Welche SimVars werden gelesen
> - [`weather-provider-strategy.md`](../weather-provider-strategy.md) Section 5 — ACARS-Coupling als premium-feature
> - [`Wellen-Roadmap.md`](./Wellen-Roadmap.md) — Operative master-wellen-roadmap für vam-system
> - [`pirep-analysis-page.md`](../pirep-analysis-page.md) — Was mit ACARS-daten visualisiert wird

---

## Inhaltsverzeichnis

### TEIL A — STATUS-BILANZ
1. [Was bereits erledigt ist](#1-was-bereits-erledigt-ist)
2. [Tech-Stack-Realität](#2-tech-stack-realit%C3%A4t)
3. [Release-Geschichte](#3-release-geschichte)

### TEIL B — ROADMAP (Operative Wellen)
4. [Wellen-Konzept](#4-wellen-konzept)
5. [Welle A: Polish & Hardening](#welle-a-polish--hardening--%EF%B8%8F-empfohlener-next)
6. [Welle B: PIREP-Enrichment](#welle-b-pirep-enrichment--soon)
7. [Welle C: Anti-Cheat & Reliability](#welle-c-anti-cheat--reliability--soon)
8. [Welle D: Plattform-Expansion](#welle-d-plattform-expansion--later)
9. [Welle E: Advanced Features](#welle-e-advanced-features--vision)

### TEIL C — STRATEGIE
10. [Reihenfolge-empfehlung](#10-reihenfolge-empfehlung)
11. [Aufwand-tabelle](#11-aufwand-tabelle)
12. [Cross-airline-strategie](#12-cross-airline-strategie)

---

# TEIL A — STATUS-BILANZ

## 1. Was bereits erledigt ist

### 1.1 Milestones M1-M6 (Foundation) — ✅ ALLE DONE

Ursprünglich in [acars-architecture.md](../acars-architecture.md) als phasen-roadmap geplant. Realität: alle phasen kern-funktionalität abgeschlossen.

| Milestone | Scope | Status | Key commits |
|---|---|---|---|
| **M1** | Pairing-Handshake mit DPAPI-Token-Storage | ✅ DONE | `715e409` |
| **M2** | SimConnect read-loop mit telemetry-struct | ✅ DONE | `86ab693` |
| **M3** | Heartbeat-sender mit replay-queue | ✅ DONE | `f23701c` |
| **M3.5** | Runtime-config via `appsettings.json` | ✅ DONE | `dea6d42` |
| **M3.6** | Structured logging (Serilog + MS.Extensions) | ✅ DONE | `856be24` |
| **M3.7** | Server-resolved phase in console + log | ✅ DONE | `3b22408` |
| **M3.8** | TITLE simvar für aircraft-type pattern-match | ✅ DONE | `ad1f394` |
| **M4 Skeleton** | WPF tray-app projekt (icon, status, bootstrap) | ✅ DONE | `0406014` |
| **M4 Phase 2** | SimConnect+Heartbeat im WPF-UI wire | ✅ DONE | `ee96422` |
| **M4 Phase 3** | Auto-start mit Windows toggle | ✅ DONE | `81c8163` |
| **M4 Phase 4** | Dynamic tray-tooltip per connection-state | ✅ DONE | `fa2dafa` |
| **M5 Phase 1** | Velopack auto-update integration | ✅ DONE | `4afbf2c` |
| **M5 Phase 2** | Manual "Auf Updates prüfen" button | ✅ DONE | `31e2d74` |
| **M5 Phase 3** | Confirm update-install while connected | ✅ DONE | `2f246a3` |
| **M6** | BLOCK_ON → PIREP auto-trigger | ✅ DONE | server-side: `apps/web/lib/acars/auto-pirep.ts` + `generate-pirep.ts` (in vam-system repo). client-side: `3da5cca` (BLOCK_ON event emission mit rich payload) |

**M6-Detail**: Auto-PIREP wurde nach option #19 (Welle Track-5) so umgebaut dass PIREPs als **Draft** erstellt werden (nicht Submitted). Pilot reviewt + submitted manuell auf `/pireps/[id]`. Discord-emit + rank-promotion fire erst beim manual-submit, nicht beim auto-create. Begründung: false-positives aus heuristik-splice (sim-rate flags, replay-flags) sollen vor dem #pireps-broadcast korrigierbar sein.

### 1.2 Feature-Options #3-#14 — ✅ ALLE DONE

Nach M-Milestones wurden iterativ optionen ausgewählt + implementiert. Lücken in der nummerierung (#1, #2, #6-9) sind nicht ungesetzte features sondern history-artefakte.

| # | Feature | Commit | Date |
|---|---|---|---|
| #3 | "Gerät neu koppeln" button in EINSTELLUNGEN | `358c047` | — |
| #4 | Live phase-time display "Cruise — 0:42" | `9d1e28e` | — |
| #5a | Client-side BLOCK_ON event mit rich payload | `3da5cca` | — |
| #5b | Audio cue on phase transitions | `f18499d` | — |
| #10 | Pre-flight-checklist als connect-gate | `b9e373a` | — |
| #11 | Aircraft auto-detection vor verbinden | `5605d62` | — |
| #12 | OFP-import-card (SimBrief/FlightAware/PFPX) | `75e1f17` | — |
| #13 | Crash-recovery mit session-marker | `6cb7b41` | — |
| #14 | Multi-sim-detection (MSFS 2020/2024, FSX, P3D) | `4d50ad6` | — |
| post-#14 | In-app pairing dialog (HasToken=False handling) | `caee3ee` | latest |

### 1.3 Infrastructure — ✅ DONE

| Item | Status | Reference |
|---|---|---|
| GitHub auto-release on tag push | ✅ DONE | `c448bfb` |
| `release.ps1` (Velopack pack + optional GH upload) | ✅ DONE | repo root |
| README mit install + pairing + daily-flow + build-instructions | ✅ DONE | `ca460de` |
| 0.1.0 → 0.1.1 published als Velopack-packages | ✅ DONE | `Releases/` folder + GH-releases |

### 1.4 Was ist NICHT done

Genauer: was **explizit** in den existing docs erwähnt aber noch nicht gebaut wurde.

- Aus `acars-architecture.md` Section 9 "Edge-Cases":
  - ✅ Sim-Crash-Recovery → done (option #13)
  - ⏳ Network-Loss-Recovery → partial (replay-queue da, UI-feedback unscharf)
  - ✅ Multiple Sims → done (option #14)
  - ❌ Anti-Cheat (Time-Acceleration, Position-Jump) → roadmap Welle C
  - ❌ Token-Leak-UI (rotate-button separate von disconnect) → roadmap Welle A

- Aus `acars-architecture.md` Section 11 "Erweiterungen":
  - ❌ Wetter-Vergleich (Sim vs Real METAR) → roadmap Welle B
  - ❌ ATC-Integration (COM-Freq tracking) → roadmap Welle B
  - ❌ Heatmap aller pilots → roadmap Welle E

- Aus `acars-architecture.md` Section 14 "Open Questions":
  - ❌ Multi-Device-Support → roadmap Welle D
  - ✅ Token-storage via DPAPI → done
  - ✅ PIREP-Auto-Submit vs Review → done (Draft seit #19)
  - ❌ Demo-Mode ohne pairing → roadmap Welle D
  - ❌ White-Label per airline → roadmap Welle D
  - ❌ Aircraft-substitution-flow → roadmap Welle B
  - ❌ Code-Signing-Cert → roadmap Welle D
  - ❌ X-Plane support (Phase 2) → roadmap Welle D

- Aus `weather-provider-strategy.md` Section 5 "ACARS-Coupling":
  - ❌ User-position-aware tile-requests → roadmap Welle B (server-side)
  - ❌ Pre-caching basierend auf flight-plan → roadmap Welle B (server-side)

---

## 2. Tech-Stack-Realität

> **WICHTIG**: Die [`acars-architecture.md`](../acars-architecture.md) sagt unter Section 13 "Tech-Stack: Electron + React + TypeScript + node-simconnect". Das ist VERALTET. Die echte implementation hat einen anderen weg genommen.

### 2.1 Was tatsächlich verwendet wird

```
Project: VamAcarsClient
├── VamAcarsClient.Tray/      (WPF, .NET 10, OutputType=WinExe, AssemblyName=VamAcarsClientTray)
├── VamAcarsClient.Cli/       (Headless CLI, .NET 10, für mode-1 pairing + scripted runs)
├── VamAcarsClient.Core/      (Shared library: HeartbeatService, SimConnectClient, OfpParser, SessionMarker)
├── external/simconnect/      (Vendored SimConnect.dll + managed wrapper)
├── publish/                  (dotnet publish output, self-contained win-x64)
├── Releases/                 (Velopack nupkg + Setup.exe artifacts)
└── release.ps1               (Velopack release pipeline)
```

**Stack:**
- **UI**: WPF (XAML + code-behind), nicht Electron/React
- **Runtime**: .NET 10 self-contained (kein system-installed .NET 10 nötig — Velopack ships die runtime mit)
- **SimConnect**: managed wrapper aus `external/simconnect/` (nicht node-simconnect)
- **Logging**: Serilog + Microsoft.Extensions.Logging
- **Config**: `appsettings.json` (runtime-overridable)
- **Distribution**: Velopack (statt Squirrel/electron-updater)
- **Token-Storage**: Windows DPAPI (statt OS-Keychain — DPAPI ist die windows-native variante)
- **Auto-start**: registry-key `HKCU\...\Run` toggle (statt electron-auto-launch)

### 2.2 Warum der wechsel von Electron zu WPF/.NET sinnvoll war

- **node-simconnect** ist ein community-maintained npm package — single-point-of-failure bei MSFS-updates
- **.NET SimConnect.dll** ist von Microsoft direkt (offizieller managed wrapper) — survives MSFS-updates direkt
- **Bundle-size**: Electron ~140 MB, WPF self-contained ~70 MB (siehe Setup.exe size)
- **Memory-footprint**: WPF tray-app idle ~80 MB, Electron-äquivalent wäre ~250 MB
- **Native windows-integration**: tray-icon, auto-start, DPAPI alles ohne extra deps
- **Tradeoff**: weniger cross-platform (X-Plane braucht separate XPLM-plugin in C++) — siehe Welle D1

### 2.3 Build-rules (carry forward)

- Build per `.csproj`, NICHT per `.slnx` solution-file
- Vor jedem build: `taskkill -F -IM VamAcarsClientTray.exe` (file-lock auf VamAcarsClientTray.dll)
- `release.ps1` kümmert sich darum + macht `dotnet publish` self-contained win-x64
- Version-source-of-truth ist `<Version>` element im Tray .csproj — `vpk pack` liest das automatisch
- Bei manuellem version-bump: `release.ps1 -Version 0.2.0`
- Für GitHub-publish: `release.ps1 -Publish` mit `$env:GITHUB_TOKEN` gesetzt (fine-grained PAT mit `contents: write` auf CrysaGaming/vam-acars-client)

### 2.4 Win11-Quirks (carry forward)

- **Tray-icon-cache-bug**: `explorer.exe` cached tray-icons by `NotifyIcon`-GUID. `NIM_MODIFY` (`NIF_ICON`) returns success aber rendert nicht. Workaround: nur tooltip dynamisch (`NIF_TIP` wird honored), icon static. Reference: `App.xaml.cs` `StatusTooltipMap`-docstring.
- **SmartScreen-warning**: Installer ist nicht code-signed → "More info" → "Run anyway" nötig. Roadmap-fix in Welle D4.

---

## 3. Release-Geschichte

| Version | Date | Highlights |
|---|---|---|
| **0.1.0** | ~8. Mai 2026 | Erste M5-shipped build — full M1-M5 stack, Velopack-installer funktioniert |
| **0.1.1** | ~9. Mai 2026 | No-scroll layout (window height 620 → 960 px so dass alle cards ohne scroll passen), bugfixes |
| **0.1.x-pending** | tbd | option #10-#14 + caee3ee in-app pairing dialog noch nicht released — accumulated für 0.2.0 |

**Kanal**: GitHub Releases (private kein public installer-cdn) — Velopack pollt das GH-releases-feed via `vpk download github` für update-checks.

**CI**: tag-push auf `v*` triggert auto-release via `.github/workflows/` (siehe `c448bfb`). Manual-release: `release.ps1 -Version X.Y.Z -Publish`.

---

# TEIL B — ROADMAP (Operative Wellen)

## 4. Wellen-Konzept

Diese roadmap folgt dem **Wellen-pattern** der [Wellen-Roadmap.md](./Wellen-Roadmap.md) — jede welle ist ein zusammenhängender themenblock mit klarer definition-of-done, nicht eine sammlung loser todos.

### Status-Symbole

| Symbol | Bedeutung |
|---|---|
| ⭐️ **EMPFOHLENER NEXT** | Welle die als nächstes angegangen werden sollte |
| 🔵 SOON | In den nächsten 2-8 wochen, nach der current welle |
| 🔵 LATER | 2-6 monate horizont, requires preparation |
| 💭 VISION | Long-term, einige monate+ entfernt |

### Pro Welle dokumentiert

- **Scope** — Was umfasst diese welle (eine prägnante zusammenfassung)
- **Features** — Konkrete deliverables, jede mit eigenem ID (A1, A2, ...) damit referenziert werden kann
- **Dependencies** — Was muss VOR dieser welle stehen (server-side, andere wellen)
- **Risk-Tag** — 🟢 niedrig / 🟡 mittel / 🟠 hoch / 🔴 sehr hoch
- **Effort-Band** — Realistisch geschätzte zeit (kalibriert mit Wellen-Roadmap calibration-faktor 0.27-0.49)
- **Definition of Done** — Wann ist die welle abgeschlossen

---

## Welle A: Polish & Hardening — ⭐️ EMPFOHLENER NEXT

**Scope:** Stabilisiert was schon da ist. Telemetry-sichtbarkeit, recovery-edge-cases, sicherheit. Schnelle wins die das tägliche use-experience deutlich besser machen ohne neue capability-flächen aufzumachen.

**Why this welle:** Vor 0.2.0-release sollte die existing capability poliert werden. 90+ commits an features, aber UX-edge-cases noch dünn. Network-loss messaging ist unscharf, kein view auf heartbeat-queue, keine token-rotate-action separat von disconnect.

**Risk:** 🟢 niedrig — alles additive UI-arbeit, kein neuer code-pfad in der heartbeat-pipeline

### Features

#### A1: Telemetry-tab in tray-app
- Erweitert die `HEARTBEATS` card um:
  - Last-heartbeat-latency (ms) als sparkline (last 60s rolling)
  - Queue-depth display (wieviele heartbeats sind aktuell in der replay-queue)
  - Failure-rate (last 5 min) als percentage
  - Network-status-indicator (online/degraded/offline mit color)
- Pure read-only, daten kommen aus `HeartbeatService` instrumentation
- Ein-klick-toggle "details anzeigen" damit casual-user nicht von den details erschlagen werden

#### A2: Network-loss recovery UX
- Aktuell: bei network-failure wird stillen weiter retried, kein UI-feedback
- Soll: status-pill wechselt zu gelb "Wiederverbinde…" + countdown-timer bis nächster retry
- Bei recovery: kurzer green-flash + "Wieder verbunden, X heartbeats nachgesendet"
- Code-änderung in `AcarsClientService.cs` event-flow plus UI-binding

#### A3: Token-rotate button (separat von disconnect)
- Aktuell: nur "Gerät neu koppeln" via #3 → invalidiert token und braucht erneutes pairing
- Welle-A neu: "Token rotieren" button — re-generiert token serverseitig OHNE pairing-flow (user-action: "Token rotate" in settings → server invalidiert alten, generiert neuen, schickt zurück, client speichert)
- Server-endpoint `POST /api/acars/token/rotate` (auth via aktuellem Bearer-token)
- Für paranoide user die nach jedem flight rotieren wollen

#### A4: In-app changelog viewer
- Bei first-start nach update: modal mit "Was ist neu in 0.X.Y?"
- Liest aus CHANGELOG.md vom GitHub-release (oder bundled markdown im `Resources/`)
- Skip-button + "Don't show again until next update"
- Bei manual-check-for-updates: link "View changelog"

#### A5: Structured error-reporting + bug-report template
- Errors die im tray-app passieren werden lokal in `%LOCALAPPDATA%\VamAcarsClient\errors\` rotiert
- "Bug melden" button in settings: öffnet GitHub-issues-page mit pre-filled template:
  - App version
  - .NET version + OS-build
  - Letzte 50 log-lines (von Serilog)
  - Active sim (MSFS 2024 etc.)
  - User-beschreibung-feld
- Sensitive daten (token, pairing-code) werden im template redacted

#### A6: Improved sim-quit detection
- Aktuell: bei sim-quit bricht SimConnect ab, recovery-loop kickt in
- Welle-A: explizit "Sim wurde geschlossen" als event detecten + UI zeigt "Sim getrennt - bitte zurück zum sim" statt "Verbindung verloren"
- Vermeidet user-confusion ("warum versucht das tool was zu reconnecten?")

#### A7: Logs-cleanup-job
- Aktuell: serilog rolling-file-appender wächst potenziell unbegrenzt (per default ~30 tage retention)
- Welle-A: konfiguriere max-size + max-files in `appsettings.json`
- "Logs öffnen" button in settings (windows-explorer zu log-folder)
- "Logs leeren" button mit confirm

### Dependencies
- Nichts — alles im client-repo machbar
- A3 (token-rotate) braucht 1 neuen vam-system endpoint (~30 zeilen)

### Definition of Done
- Tray-app zeigt heartbeat-telemetry sichtbar
- Network-loss erzeugt klares UI-feedback statt stille reconnect
- Token kann ohne re-pair rotiert werden
- User sieht changelog nach update
- Bug-melden-flow funktioniert end-to-end (button → GH-issue mit redaktion)

### Effort-Band: ~3-4 tage coding (7 features, im schnitt 4-5h pro feature mit testing) — **1-2 wochen kalender-zeit**

### Welle-A definition of release: nach allen 7 features kommt **0.2.0 release** mit changelog-entry + GitHub-release notes.

---

## Welle B: PIREP-Enrichment — 🔵 SOON

**Scope:** Erweitert die PIREP-daten die der ACARS-client liefert. Mehr context im post-flight, bessere comparison-features, optionale OFP-bindungen. Auch user-position-aware weather-coupling (server-side aber triggered durch ACARS-data).

**Why this welle:** ACARS liefert heute "good-enough" telemetrie für auto-PIREP. Die nächste evolution ist **mehr semantische daten** — wo war ATC, war das wetter im sim realistisch, welche aircraft-substitution lief. Macht die `/pireps/[id]/page.tsx` (siehe `pirep-analysis-page.md`) zu einer richtigen analyse-tool statt nur einer report-page.

**Risk:** 🟡 mittel — server-side coordination nötig, mehrere new endpoints, datenmodell-änderungen

### Features

#### B1: Wettervergleich (Sim-METAR vs Real-METAR)
- ACARS sendet bereits wind/oat/pressure aus `simconnect-data-catalog.md` Section 7
- Server fetched real-METAR für departure/arrival/cruise-region zum gleichen zeitpunkt
- PIREP-page bekommt neue "Weather Comparison" section (siehe acars-architecture.md Section 11.1)
- Provider-strategie schon in [`weather-provider-strategy.md`](../weather-provider-strategy.md) Section 5 dokumentiert
- Effort: ~2-3 tage

#### B2: ATC-Frequenz-Tracking
- Client sendet zusätzlich `com1Active`, `com1Standby`, `nav1Active` in heartbeat-payload
- Server hat zugriff auf VATSIM-ATC-datafeed (bot polled das schon — einfach erweitern)
- Server matched freq+position auf ATC-station und persistiert pro session
- PIREP-page bekommt neue "ATC Sessions" section: "12:42 EDDF_GND 121.6 (5 Min)..."
- Cooler stat für VATSIM-pilots, zeigt engagement mit ATC
- Effort: ~3-4 tage (heartbeat-schema erweitern + bot-ATC-fetch + UI)

#### B3: Replay-export als .vam-replay file
- Aktuell: replay-daten leben nur in der DB (`LiveSessionPosition` rows)
- Welle-B: post-flight-action "Replay-file exportieren" im tray
- Format: `.vam-replay` (JSON oder MessagePack mit positions + events + metadata)
- Anwendung: offline-analyse, share-with-friends, future-import in einen visualizer
- Effort: ~2 tage

#### B4: Aircraft-substitution-flow
- Szenario: pilot bucht A320, fliegt B737 (häufig wegen aircraft-livery-issues)
- Aktuell: kein UI-hinweis, PIREP wird ohne flag erstellt
- Welle-B: pre-flight-checklist erkennt mismatch (#11 auto-detection war schon da)
- Bei mismatch: dialog "Du hast B737 geladen aber A320 gebucht. Was ist absicht?"
  - "Das war absicht - PIREP mit B737 filen" (mit reason-field optional)
  - "Falsch geladen - sim schließen und neu starten"
  - "Buchung ist falsch - mit B737 fortfahren + admin-flag"
- Effort: ~2 tage

#### B5: Per-airline route-suggestions im OFP-import
- Aktuell: OFP-import (#12) ist generisch — pilot lädt SimBrief-OFP für ANY route
- Welle-B: server schickt liste der airline-routes im pairing-handshake (cached)
- Beim OFP-import: tray vergleicht imported callsign mit airline-routes
  - Match: green tick "Verfügbare route gefunden — auto-Booking erstellen?"
  - Kein match: yellow warning "Diese route ist nicht in deiner airline — admin um genehmigung bitten?"
- Effort: ~3 tage (server-endpoint + tray-UI + booking-link)

#### B6: Server-side: User-position-aware weather-coupling
- Aus weather-provider-strategy.md Section 5.2
- Wenn ACARS-user eingeloggt: weather-tile-requests priorisieren provider basierend auf user-position
- Pre-cache tiles für die nächsten 15 min flight-path
- KEIN client-change nötig — pure server-side
- Effort: ~2 tage (vam-system-arbeit, nicht client-arbeit)

### Dependencies
- ✅ M3+M4 (heartbeat-stack) für payload-erweiterungen
- ⚠️ B2 (ATC) braucht VATSIM-ATC-datafeed im bot — schon geplant in Wellen-Roadmap Welle 9
- ⚠️ B6 (weather-coupling) bestehende weather-provider-strategy implementation muss da sein

### Definition of Done
- PIREP-page zeigt weather-comparison wenn ACARS-flight
- PIREP-page zeigt ATC-sessions wenn VATSIM-flight
- Replay-files können exportiert werden
- Aircraft-substitution wird sauber gehandled
- OFP-import erkennt airline-routes
- Weather-provider nutzt user-position

### Effort-Band: ~12-16 tage coding (6 features) — **3-5 wochen kalender-zeit**

### Welle-B definition of release: **0.3.0 release** mit "PIREP-enrichment" als major-theme.

---

## Welle C: Anti-Cheat & Reliability — 🔵 SOON

**Scope:** Detection-systeme für fishy patterns (time-acceleration, position-jumps, suspicious sim-rate). Plus CI-hardening damit kein broken release shipt.

**Why this welle:** Reliability-stats (#30 Track 5 No-Show feature) basieren auf "der pilot hat den flight gemacht". Ohne anti-cheat können false-positive-positives entstehen (pilot hat sim-rate auf 16x → 4h flight in 15 min → "completed"). Macht das system trustworthy für leaderboards und ranks.

**Risk:** 🟡 mittel — false-positive-management ist tricky, kann unfair für legitime piloten sein wenn aggressive

### Features

#### C1: Time-Acceleration-Detection
- Client sendet `simRate` simvar in heartbeat (schon dokumentiert in `simconnect-data-catalog.md` Section 10)
- Server-side: 3 aufeinanderfolgende heartbeats mit simRate > 1.0 → flag "TIME_ACCELERATION_DETECTED"
- PIREP wird trotzdem erstellt aber mit warning-icon im admin-review
- Pilot sieht warning auf eigener PIREP-page

#### C2: Position-Jump-Detection
- Server-side: distance(lastPos, currentPos) > speed × elapsed × 2 → flag "POSITION_JUMP_DETECTED"
- Tolerant am flight-start (spawn-in-flight nach crash-recovery legitim)
- Klassifizierung: minor (>2× erlaubt), major (>5× erlaubt)

#### C3: Pause-Detection
- Server-side: tracking total-pause-seconds during flight (sum aus heartbeat-gaps die offiziell als pause gemarkt sind)
- Wenn > 30% der flight-zeit in pause: flag "EXCESSIVE_PAUSE"
- Kein automatic-reject — admin-review

#### C4: Admin-review-queue für flagged sessions
- Neue page `/airline/admin/flagged-pireps` (vam-system)
- Listet PIREPs mit anti-cheat-flags
- Pro PIREP: flag-details + telemetry-charts + approve/reject/comment-actions
- Audit-trail (wer hat wann entschieden, mit was-für-grund)
- Effort: ~3 tage (UI + actions + history)

#### C5: Pairing-Smoketest als GitHub-actions CI
- CI-job: build acars-client → run CLI in mode-1 → auto-pair via test-account → send 10 heartbeats → validate auto-PIREP-creation
- Stellt sicher dass kein release ein broken pairing-flow shippt
- Test-credentials in GH-actions-secrets, ephemeral test-airline-context
- Effort: ~3 tage (workflow + test-fixtures + cleanup)

#### C6: Heartbeat-rate-limiting verfeinerung
- Aktuell: 1 req/sec rate-limit pro user
- Welle-C: graceful-degradation bei rate-limit-hit (queue + retry-with-backoff statt drop)
- Plus rate-limit-headers im server-response für client-side awareness
- Effort: ~1 tag

### Dependencies
- ✅ M3 (heartbeat-stack) — simRate-field hinzufügen ist additiv
- ⚠️ C4 (review-queue) braucht admin-action-foundation (existiert)

### Definition of Done
- Time-acceleration wird erkannt + flagged
- Position-jumps werden erkannt + flagged
- Admin kann flagged PIREPs reviewen mit voller info
- Pairing-smoketest läuft in CI auf jedem PR + tag-release
- Heartbeat-rate-limit ist graceful, kein silent-drop

### Effort-Band: ~8-10 tage coding (6 features) — **2-3 wochen kalender-zeit**

---

## Welle D: Plattform-Expansion — 🔵 LATER

**Scope:** Öffnet die ACARS-plattform für neue user-gruppen — X-Plane-piloten, multi-device-user, andere virtual-airlines via white-label, end-user die SmartScreen-warning fürchten.

**Why this welle:** ACARS ist heute MSFS-only und LEAV-only-target. Wenn die plattform wachsen soll (langfristig viel mehr piloten), sind X-Plane + white-label + code-signing die enabler.

**Risk:** 🟠 hoch — substantial new platforms (XPLM-plugin), business-decisions (code-signing-cert kosten), schema-änderungen (multi-device)

### Features

#### D1: X-Plane Support
- Eigenes project `VamAcarsClient.XPlane/` als XPLM-plugin (C++, X-Plane SDK)
- Liest X-Plane datarefs anstelle MSFS-simvars (mapping in `simconnect-data-catalog.md` Section 12)
- Schickt heartbeats an gleichen server-endpoint
- Build-pipeline: x-plane-sdk + cmake + cross-compile (wenn auf windows-machine entwickelt)
- Distribution: zipped plugin + installation-anleitung in vam-platform-settings
- Effort: ~2-3 wochen (pioneer-arbeit, eigenes ecosystem)

#### D2: Multi-Device-Support
- Aktuell: 1 token = 1 device per user
- Welle-D: Devices als entity. Schema: `AcarsDevice { id, userId, name, lastSeenAt, currentToken, isActive }`
- 1 user kann mehrere devices haben (z.B. MSFS-PC + P3D-laptop)
- Aktive-session: nur 1 active session pro user, aber multiple registered devices
- Settings-UI: device-liste + revoke-per-device
- Effort: ~1-2 wochen (schema-migration + UI + client-side device-id)

#### D3: White-Label-ACARS
- Per-airline branding (logo, primary-color, accent-color, name "VAM ACARS" → "LH Virtual ACARS")
- Build-pipeline: `release.ps1 -Airline lufthansa-virtual` produziert custom-branded binary
- Resources werden zur build-zeit substituted (icon, splash-screen, app-name in registry)
- VAM-server-side: airlines können in admin-settings ihre branding-assets uploaden
- Effort: ~1-2 wochen (build-customization + asset-pipeline + admin-UI)

#### D4: Code-Signing-Cert
- Acquire EV cert (DigiCert/Sectigo/SSL.com) — ~$200-500/year
- Integration in `release.ps1` via `signtool` post-build
- Velopack-signing-support (vpk pack supports `--signing-cert` flag)
- Eliminates Windows SmartScreen-warning bei install
- Plus: cert-rotation-plan (1-3 year-lifecycle)
- Effort: ~3-5 tage (cert-acquisition wartezeit eingeschlossen, technical-work ~1 tag)

#### D5: Demo-Mode ohne pairing
- Aktuell: app braucht pairing → token → heartbeats
- Welle-D: optionaler demo-mode (in settings: "demo-mode aktivieren")
- Heartbeats werden NICHT gesendet — alles bleibt lokal
- Showcases UI + phase-detection ohne server-side-impact
- Für: streamer die ACARS-tool zeigen wollen ohne account, evaluators die das tool ausprobieren
- Effort: ~2 tage

### Dependencies
- D2 (multi-device) requires server-side schema-migration
- D3 (white-label) requires admin-UI in vam-system für branding-management
- D4 (code-signing) ist business-decision + budget

### Definition of Done
- X-Plane-pilot kann ACARS-XPLM installieren und pair-en
- User kann mehrere devices registrieren + per-device-revoke
- Andere VA kann mit eigenem branding installer bauen
- Code-signed installer hat kein SmartScreen-warning
- Demo-mode funktioniert end-to-end ohne server-traffic

### Effort-Band: ~5-8 wochen coding (5 features, mehrere substantial) — **2-3 monate kalender-zeit**

---

## Welle E: Advanced Features — 💭 VISION

**Scope:** Premium-features die ACARS zu einem differentiator machen. Live-streaming integration, voice, mobile, multi-pilot-cockpits. Vision-territory.

**Why this welle:** Wenn Wellen A-D done sind ist ACARS schon ein vollwertiges produkt. Welle E ist "wow-factor"-features für streamer und enthusiasts.

**Risk:** 🔴 sehr hoch — substantial new platforms (mobile, voice), unklare market-fit

### Features

#### E1: Live-streaming sidecar (OBS-overlay direkt aus tray)
- Statt vam.kevindrack.de/overlay/[token] in OBS: lokaler HTTP-server in tray-app
- Pre-rendered overlay-HTML mit live-data ohne web-roundtrip
- Latency: ~50 ms statt 3-5 sek (current polling-interval)
- Effort: ~1 woche (HTTP-server in tray + asset-pipeline)

#### E2: Voice-commands
- "Connect" / "Set callsign LH918" / "Set departure EDDF" voice-controls
- Windows speech-recognition API (eingebaut in .NET)
- Wichtig: opt-in, kein always-listening
- Effort: ~1-2 wochen

#### E3: Mobile-companion-app
- Reagiert auf active-flight, zeigt: ETA, current phase, fuel-remaining
- Push-notifications bei flight-events (touchdown, BlockOn, etc.)
- Build: React-Native (cross-platform iOS+Android)
- Reads vom vam-server, nicht direkt vom tray
- Effort: ~3-6 wochen (separates project)

#### E4: Multi-pilot-cockpit support
- Captain + First-Officer accounts gemeinsam an einer flight
- Beide pair-en mit gleichem flight-context
- Server-side: shared-session-model mit role-flag
- PIREP wird auf BEIDE pilots gefilet
- Use-cases: charter-VAs mit crew-flights, training mit instructor+student
- Effort: ~2 wochen

#### E5: Heatmap aller pilots auf VAM-Platform
- Aggregation aller PIREPs ergibt heatmap der populärsten routes
- Live-map toggle "Heatmap zeigen"
- Color-coded: blau (1-10 flights), gelb (10-50), rot (50+)
- Plus: touchdown-heatmap pro airport ("wo touchen pilots typically auf RWY 25R EDDF?")
- Effort: ~1 woche (server-aggregation + Mapbox-HeatmapLayer)

### Dependencies
- Alle vorherigen wellen stable

### Effort-Band: 2-4 monate (5 features, alle substantial)

---

# TEIL C — STRATEGIE

## 10. Reihenfolge-Empfehlung

### 10.1 Kurzfristig (nächste 2-4 wochen)

**Empfehlung: Welle A komplett → 0.2.0 release**

```
Welle A (Polish & Hardening) — 7 features, ~3-4 tage coding
  ↓
0.2.0 release packen + publishen
  ↓
Beobachten was sich in der täglichen nutzung als nächster painpoint zeigt
```

**Begründung:**
- Welle A hat den höchsten "ratio von wirkung pro stunde" — kleine änderungen, große UX-improvements
- 0.2.0 release ist schon overdue (5 features seit 0.1.1, plus pairing-dialog)
- Schließt observation-cycle: nach welche features hat user wirklich missing-felt?

### 10.2 Mittelfristig (4-12 wochen)

**Drei plausible pfade:**

**Pfad α (Stats-Tiefe):** Welle B (PIREP-Enrichment) → 0.3.0
- Für VATSIM-fokus, mehr cooles data-display, deepens das system

**Pfad β (Fairness):** Welle C (Anti-Cheat) → 0.3.0
- Wenn reliability-stats relevant werden, leaderboard-fairness wichtig wird

**Pfad γ (Platform):** Welle D (X-Plane / Multi-Device / White-Label) → 0.3.0/0.4.0
- Wenn user-base wachsen soll, X-Plane öffnet eine neue cohort

**Entscheidungshilfe:**
- Wachsende user-base + VATSIM-fokus → **Welle B**
- Konflikte zwischen pilots oder admin-aufwand zu hoch → **Welle C**
- Single-VA-fokus reicht aktuell → **kein Welle D nötig**

### 10.3 Langfristig (3-12 monate)

```
0.2.0 → Welle A done
   ↓
0.3.0 → eine von Welle B/C/D (je nach kurzfristiger entscheidung)
   ↓
1.0.0 → alle vorherigen wellen stable + welle D (code-signing als prerequisit für 1.0)
   ↓
Welle E features als optionale add-ons über quartale
```

---

## 11. Aufwand-tabelle

Konsolidiert für quick-reference. Calibration-faktor 0.27 (additive) bis 0.49 (refactor) aus Wellen-Roadmap.

| Welle | Features | Coding-tage | Kalender-zeit | Risk | Release-target |
|---|---|---|---|---|---|
| **A** Polish & Hardening | 7 | 3-4 | 1-2 wochen | 🟢 | 0.2.0 |
| **B** PIREP-Enrichment | 6 | 12-16 | 3-5 wochen | 🟡 | 0.3.0 |
| **C** Anti-Cheat & Reliability | 6 | 8-10 | 2-3 wochen | 🟡 | 0.3.0 |
| **D** Plattform-Expansion | 5 | 25-40 | 2-3 monate | 🟠 | 0.4.0-1.0.0 |
| **E** Advanced Features | 5 | 60-120 | 2-4 monate | 🔴 | post-1.0 |

**Total alle wellen:** ~30 features, ~108-190 coding-tage, **7-12 monate** kalender-zeit für die volle vision.

---

## 12. Cross-Airline-Strategie

Für die zukunft: wie wird ACARS für andere VAs nutzbar?

### Heute (single-tenant)
- ACARS ist hardcoded auf vam.kevindrack.de
- LEAV Aviation ist der einzige real-world-target
- README sagt "ships unbranded" aber config-loading ist VAM-spezifisch

### Morgen (Welle D3 white-label)
- Per-airline build mit custom branding-assets
- Server-URL konfigurierbar (vam.example.com etc.)
- Eigene cert-signing pro VA möglich

### Übermorgen (vision)
- VAM-platform als multi-tenant SaaS
- N airlines auf gleicher infrastructure
- Pro airline: eigener acars-build aus vam-platform-admin
- Pilot-experience: 1× ACARS install, switch zwischen airlines via dropdown

---

## Schluss-Bemerkung

**Wo wir heute stehen (13. Mai 2026):**
- M1-M6 alle done, 90+ commits gepusht
- 0.1.0 + 0.1.1 released
- 5 features (option #10-#14) + pairing-dialog accumulated für 0.2.0
- Welle A (Polish & Hardening) ist der empfohlene next-step

**Operative empfehlung für nächste sessions:**
1. **Welle A starten** mit A1 (telemetry-tab) oder A3 (token-rotate) — beide self-contained
2. **Welle A komplett shippen** + 0.2.0 release packen
3. **Pause, observation** — welche features melden sich als nächster painpoint?
4. **Entscheidung pfad α/β/γ** für welle B/C/D

**Tracker-hinweis:**
Wenn eine welle abgeschlossen ist, status hier auf ✅ ändern, commit-references hinzufügen, release-version eintragen. Dieses dokument ist die single source of truth für ACARS-roadmap going forward.

---

*Dokument-version: 1.0 — initial ACARS-client-roadmap.*
*Authored on 13. Mai 2026 basierend auf vollständiger .md-analyse + git-log von vam-acars-client (~30 commits since 0.1.0).*
*Cross-referenced gegen: acars-architecture.md, simconnect-data-catalog.md, weather-provider-strategy.md, Wellen-Roadmap.md, pirep-analysis-page.md, VamAcarsClient/README.md.*
