# OBS-Overlay-System — Roadmap

> Vollständige Roadmap für das OBS-Browser-Source-Overlay-System.
> Pilots können ihre Live-Flugdaten als Stream-Overlay in Twitch/YouTube nutzen.
> Daten kommen aktuell aus VATSIM/IVAO Live-Tracking, später zusätzlich aus eigenem ACARS-Client.

**Status-Legende:**
- ✅ Fertig + committed
- 🟡 In Arbeit
- ⬜ Geplant, noch nicht angefangen
- 🔵 Future, größere Investition
- 💭 Idee, noch zu evaluieren

---

## Phase 1: Token-Infrastruktur ✅

**Commit:** `db21a73` (26.04.2026)

- [x] User-Schema: `overlayToken` Field (optional, unique)
- [x] Migration: `20260426145210_add_overlay_token`
- [x] Server-Action: `getOrCreateOverlayToken()` (lazy creation)
- [x] Server-Action: `rotateOverlayToken()` (für geleakte Tokens)
- [x] Settings-UI: URL-Anzeige + Copy-Button
- [x] Settings-UI: OBS-Setup-Anleitung (collapsible)
- [x] Settings-UI: Token-Rotation mit Confirm-Dialog

---

## Phase 2: Public-API-Endpoint ⬜

**Ziel:** Daten-Quelle für Overlay-Page, kein Auth, nur via Token.

- [ ] Schema: `NetworkType` Enum erweitern um `ACARS` (für später)
- [ ] Migration: `add_acars_network_type`
- [ ] API-Route: `GET /api/overlay/[token]/data`
  - [ ] Token-Format-Check via Regex (`^[a-f0-9]{32}$`)
  - [ ] User per Token in DB finden
  - [ ] Aktive `LiveSession` holen
  - [ ] Response: `{ active: true, pilot, flight }` oder `{ active: false }`
  - [ ] Header: `Cache-Control: no-store`
  - [ ] Header: `Access-Control-Allow-Origin: *` (CORS für OBS)
- [ ] Privacy-Check: nur Flight-Daten in Response, KEINE Email/Discord-ID/PIREPs
- [ ] Tests:
  - [ ] Invalid Token → 400
  - [ ] Unknown Token → 404
  - [ ] Valid Token, keine aktive Session → 200, `active: false`
  - [ ] Valid Token, aktive Session → 200, voller Flight-Payload

**Aufwand:** ~30 Min  
**Stop-Punkt:** Endpoint antwortet korrekt in allen 4 Test-Cases

---

## Phase 3: Overlay-Page (Live-Bar Layout) ⬜

**Ziel:** Die eigentliche OBS-Browser-Source. Transparent, oben am Bildschirm.

- [ ] Page: `apps/web/app/overlay/[token]/page.tsx`
  - [ ] Server-Component: initiale Daten holen via API
  - [ ] Pass-through zu Client-Component für Live-Updates
  - [ ] CSS: `body { background: transparent }` (für OBS-Transparenz)
  - [ ] Layout: ohne Header/Footer/Nav
- [ ] Component: `OverlayLiveBar.tsx` (Client)
  - [ ] State: aktuelle Flight-Daten
  - [ ] Polling: alle 5s `/api/overlay/[token]/data` aufrufen
  - [ ] Render bei `active=false`: dezent oder gar nichts
  - [ ] Render bei `active=true`:
    - [ ] Callsign (z.B. `DLH123`)
    - [ ] Route (`EDDF → LOWW`)
    - [ ] Flight-Level (`FL370`)
    - [ ] Ground Speed (`450 kt`)
    - [ ] ETA (berechnet aus Distance + Speed)
- [ ] Helper: Distance/ETA-Berechnung (Haversine, gleicher Code wie SessionSidebar)
- [ ] Smooth-Update via CSS transitions (kein Flicker bei neuen Daten)
- [ ] Position: oben, full-width, ~60px hoch
- [ ] Style: dunkler Hintergrund mit Blur, weiße Schrift, monospace
- [ ] Test: Browser-Tab öffnen ohne Login → Daten erscheinen
- [ ] Test: Live-Session in DB aktivieren → Bar zeigt Daten
- [ ] Test: In OBS als Browser-Source einbinden (1920x1080)

**Aufwand:** ~60 Min  
**Stop-Punkt:** Overlay funktioniert in OBS, Daten werden live aktualisiert

---

## Phase 4: Polish + Multi-Layout ⬜

**Ziel:** Mehr als ein Layout, schöner Look, gut dokumentiert.

- [ ] Layout-Switcher via URL-Param: `?layout=live-bar|cockpit|glassmorphism`
- [ ] Layout 2: "Cockpit-Style"
  - [ ] Schwarz mit cyan/grünen Lines
  - [ ] Monospace Font
  - [ ] Mehr Telemetrie sichtbar (Altitude, Speed, Heading)
  - [ ] Glass-Cockpit MFD-Look
- [ ] Layout 3: "Glassmorphism"
  - [ ] Halbtransparente Bubble mit Blur
  - [ ] Apple-Vision-Pro-Vibe
  - [ ] Mittig positioniert
- [ ] Settings-UI: Layout-Picker mit Vorschau-Iframe
- [ ] Settings-UI: "Open Preview" Button → öffnet Overlay in neuem Tab
- [ ] README/Docs: Streamer-Setup-Guide ergänzen
- [ ] Animation: Fade-in beim "active=false → active=true" Übergang

**Aufwand:** ~45 Min  
**Stop-Punkt:** User kann zwischen 3 Layouts wählen, alle funktional + hübsch

---

## Phase 5: Erweiterte Daten 🔵

**Voraussetzung:** Eigener ACARS-Client liefert mehr Telemetrie als VATSIM/IVAO.

**Ziel:** Mehr Detail im Overlay sobald die Daten verfügbar sind.

- [ ] Schema-Erweiterung in `LiveSession`:
  - [ ] `verticalSpeed: Int?` (Climb-/Descent-Rate, FPM)
  - [ ] `indicatedAirspeed: Int?` (IAS in Knots, ACARS only)
  - [ ] `mach: Float?` (Mach-Number, ACARS only)
  - [ ] `fuelKg: Int?` (Treibstoff verbleibend)
  - [ ] `flapsPercent: Int?` (Klappenstellung)
  - [ ] `gearDown: Boolean?` (Fahrwerk-Status)
  - [ ] `autopilotEngaged: Boolean?` (AP-Status)
  - [ ] `outsideAirTempC: Int?` (OAT)
  - [ ] `landingRateFpm: Int?` (Touchdown-Rate, Hard-Landing-Detection)
  - [ ] `windDirection: Int?` (Wind aus Sim, Grad)
  - [ ] `windSpeed: Int?` (Wind aus Sim, Knots)
  - [ ] `engineN1Avg: Float?` (Triebwerk-Last, Mittelwert)
- [ ] Migration: `add_acars_telemetry_fields`
- [ ] API-Erweiterung: alle neuen Felder optional in Response
- [ ] Backward-compatible: alte Clients ignorieren neue Felder
- [ ] Cockpit-Layout: zeigt mehr Telemetrie wenn verfügbar
- [ ] Live-Bar: bleibt minimal, ignoriert neue Felder
- [ ] "Hard-Landing"-Indicator: rot bei `landingRateFpm < -800`

**Aufwand:** ~1h (Migration + API + UI-Anpassungen)

---

## Phase 6: Push-Updates statt Polling 🔵

**Ziel:** Updates erscheinen sofort statt mit 5s Verzögerung.

**Aktuell:** Client polled alle 5s → bis 5s Lag bei Position-Updates  
**Ziel:** Server pushed Updates → sofort sichtbar im Overlay

- [ ] Vergleich: SSE vs. WebSocket
  - [ ] **Empfehlung:** SSE (Server-Sent Events)
    - [ ] Einfacher zu implementieren
    - [ ] Auto-Reconnect built-in (browser-native)
    - [ ] Funktioniert über CDN/Cloudflare
    - [ ] Reicht für 1-Way (Server → Overlay)
- [ ] API-Route: `GET /api/overlay/[token]/stream` (SSE-Endpoint)
  - [ ] Initial-Snapshot beim Connect
  - [ ] Push bei jeder neuen `LiveSessionPosition` (vom Bot-Tracker triggered)
  - [ ] Heartbeat alle 30s damit Connection nicht timeoutet
  - [ ] Graceful close bei `active=false`
- [ ] Bot-Anpassung: Pub/Sub-Mechanism für Position-Updates
  - [ ] Option: Redis Pub/Sub (wenn Redis eingeführt wird)
  - [ ] Option: Database-Triggers + Polling (simpler)
- [ ] Client-Anpassung: `EventSource` statt `fetch + setInterval`
- [ ] Fallback: bei SSE-Fehler auf Polling zurückfallen
- [ ] Test: Position-Update in DB → erscheint <1s im Overlay

**Aufwand:** ~1.5h  
**Stop-Punkt:** Updates sichtbar in <1s, kein Polling-Traffic

---

## Phase 7: Trail-Visualization im Overlay 🔵

**Ziel:** Mini-Map im Overlay zeigt geflogene Strecke.

- [ ] History-Endpoint: `GET /api/overlay/[token]/trail`
  - [ ] Letzte N Positionen aus `LiveSessionPosition`
  - [ ] Limitiert auf z.B. letzte 100 Punkte (Performance)
  - [ ] Format: GeoJSON LineString
- [ ] Mini-Map-Component im Overlay
  - [ ] Größe: ~200x100px, optional positionierbar
  - [ ] Optionen: SVG-Polyline (lightweight) oder Mapbox-Tile (schöner)
  - [ ] Empfehlung: SVG-Polyline (kein Mapbox-Token im public Overlay nötig)
- [ ] Layer: Polyline der Strecke
- [ ] Layer: aktueller Position als pulsierender Punkt
- [ ] Optional: Departure/Arrival-Marker mit ICAO-Label
- [ ] CSS: Map subtil halbtransparent, nicht ablenkend
- [ ] Toggle: Mini-Map nur bei `?map=on` URL-Param

**Aufwand:** ~1h  
**Stop-Punkt:** Streamer sieht eigene Strecke im Overlay

---

## Phase 8: Eigener ACARS-Client 🔵

**Ziel:** Eigene Desktop-App liest Daten direkt aus dem Sim, schickt an VAM-Server. Pegasus-Equivalent für vAMSYS, aber mit deinem Stack und deiner UX.

> **Strategie-Entscheidungen die zu treffen sind:**
> - Stack: Electron + node-simconnect (~12-15 Tage) **vs.** C# WPF/WinUI3 + SimConnect (~18-25 Tage)
> - Empfehlung: **Electron** für schnellere Iteration, gleicher Stack wie Web
> - Sim-Support: MSFS + P3D zuerst (SimConnect), X-Plane später (XPLM)
> - vmsACARS-Kompatibilität: **NICHT** anstreben — eigene Pilots, eigene App

### Sub-Phase 8.1: ACARS-API auf VAM-Server (~2-3 Tage)

- [ ] Schema: User += `acarsToken` (separater Token, nicht overlayToken)
- [ ] Schema: User += `acarsPairedAt` (Timestamp)
- [ ] Schema: `LiveSession` eventuell um `acarsClientVersion` erweitern
- [ ] API-Route: `POST /api/acars/heartbeat`
  - [ ] Bearer-Token-Auth (acarsToken)
  - [ ] Body: voller Telemetrie-Payload
  - [ ] Server upsertet `LiveSession` mit `network='ACARS'`
  - [ ] Server appended `LiveSessionPosition` für Trail
  - [ ] Rate-Limit: max 1 Heartbeat pro Sekunde
- [ ] API-Route: `POST /api/acars/pirep-final`
  - [ ] Bei Block-On: Auto-PIREP-Generierung
  - [ ] Mit allen Stats (Block-Time, Fuel-Used, Landing-Rate)
  - [ ] User reviewt Pirep im Web vor Submit
- [ ] API-Route: `POST /api/acars/pairing-code`
  - [ ] Generiert temporären 6-stelligen Code (15 Min gültig)
  - [ ] User gibt Code in App ein → App bekommt acarsToken
- [ ] API-Route: `GET /api/acars/status`
  - [ ] Health-Check für die App
- [ ] Settings-UI: ACARS-Section
  - [ ] Pairing-Code anzeigen mit Countdown
  - [ ] "Connected since X" wenn gepairt
  - [ ] "Disconnect" Button
  - [ ] Download-Link zur Desktop-App

### Sub-Phase 8.2: Settings-Page für ACARS (~2-3h)

- [ ] Pairing-Code-Generator-UI
- [ ] "App heruntergeladen?" CTA
- [ ] Connected-Status mit grüner LED
- [ ] Aktuelle Sim-Telemetrie als Preview (wenn gepairt + connected)
- [ ] "Disconnect" mit Confirm

### Sub-Phase 8.3: Electron-App MVP (~5-7 Tage)

**Stack:**
- [ ] Electron + React + TypeScript
- [ ] node-simconnect (npm) für MSFS + P3D
- [ ] Optional separater Build mit XPLM für X-Plane

**Features:**
- [ ] Login via Pairing-Code (kein Passwort in der App)
- [ ] SimConnect-Verbindung (auto-detect MSFS/P3D)
- [ ] Telemetrie-Lesung alle 1s
- [ ] HTTP-Heartbeat alle 2s zum Server
- [ ] UI: Status-LED, Aktuelle Daten, lokales Logbook
- [ ] Auto-Update via electron-updater
- [ ] Crash-Recovery (Sim crashed → reconnect, Server unerreichbar → queue)
- [ ] Tray-Icon mit Quick-Status
- [ ] Auto-Start mit Windows (optional)

### Sub-Phase 8.4: Auto-PIREP bei Landing (~2-3 Tage)

- [ ] Block-On-Detection
  - [ ] Engines off
  - [ ] On-Ground für >30s
  - [ ] ParkBrake on
- [ ] Lokales Logbook (SQLite in der App)
- [ ] PIREP-Submit zum VAM-Server
- [ ] Optional: SimBrief-Flightplan-Import vor dem Flug
- [ ] Pre-Flight-Check (richtiger Airport, richtiges Aircraft)
- [ ] Block-Time vs. Flight-Time (taxi vs. airborne)

### Sub-Phase 8.5: Polish + Distribution (~1-2 Tage)

- [ ] Code-Signing (Windows-Installer ohne SmartScreen-Warnung)
- [ ] GitHub-Releases als Auto-Update-Quelle
- [ ] NSIS-Installer für Windows
- [ ] User-Manual (Screenshots, Setup-Guide)
- [ ] Crash-Reporting (Sentry oder ähnliches)
- [ ] Beta-Tester aus Discord einladen

**Total Phase 8:** ~12-18 Tage

---

## Phase 9: Streamer-Erweiterungen 🔵

**Ziel:** Was sonst noch cool wäre für Twitch/YouTube-Streamer.

- [ ] Recent-Subscriber-Banner (via Twitch-API)
- [ ] Donation-Animation bei Streamer-Donations
- [ ] Follower-Goal als kleine Bar
- [ ] Custom-Branding pro User
  - [ ] Logo-Upload
  - [ ] Farben anpassbar
  - [ ] Custom-CSS für Power-User
- [ ] Sound-Alerts: konfigurierbare Sounds bei Events
  - [ ] Take-off
  - [ ] Top-of-Climb
  - [ ] Top-of-Descent
  - [ ] Touchdown
- [ ] Multi-Stream-Layout: Cam-Position-Anpassung
- [ ] "Now Playing"-Integration mit Spotify (für Stream-Music)
- [ ] Heatmap der geflogenen Routen über Zeit (Stream-Stats)
- [ ] Twitch-Chat-Integration: Viewer können Stats abfragen via Chat

**Aufwand pro Idee:** ~30 Min - 4h  
**Stop-Punkt:** kein "Done", das ist Endless-Polish

---

## Phase 10: Multi-Layout-Editor 💭

**Ziel:** User baut sich sein eigenes Overlay-Layout zusammen statt fertige zu wählen.

> **Evaluation nötig:** Hoher Aufwand, mittler Nutzen. 90% nutzen Standard-Layouts.
> Erst angehen wenn Beta-Feedback zeigt dass User wirklich custom Layouts wollen.

- [ ] Drag-and-Drop Layout-Editor in Settings
- [ ] Widget-System: Callsign, Speed, Position als einzelne Widgets
- [ ] User platziert Widgets per Drag-Drop
- [ ] Custom-CSS-Editor für Power-User
- [ ] Shareable Layouts (User können Layouts teilen)
- [ ] Marketplace für Layouts (Community-Sharing)

**Aufwand:** ~3-5 Tage  
**Komplexität:** Hoch

---

## Verwandte Features (nicht Teil des Overlay-Systems, aber verwoben)

### Twitch-Integration

- [ ] OAuth für Twitch-Account-Linking
- [ ] Stream-Status-Detection: pollt Twitch-API alle 60s
- [ ] In Live-Map: pulsierende Live-Indicator wenn Pilot streamt
- [ ] In Pilot-Profile: "Currently Streaming" Banner
- [ ] Discord-Bot postet in `#livestreams` Kanal wenn Pilot live geht

### YouTube-Integration

- [ ] OAuth für YouTube-Account-Linking
- [ ] Live-Stream-Detection
- [ ] Gleiche UX wie Twitch

### Awards-System (DB-Model existiert, UI fehlt)

- [ ] Awards-Page für User
- [ ] Admin-UI für Awards-Definition
- [ ] Auto-Award bei bestimmten Achievements
- [ ] Award-Anzeige im Overlay (optional)

---

## Notizen + Entscheidungen

### Privacy-Prinzip
Das Overlay-Endpoint liefert **NUR** Flight-Tracking-Daten. Niemals:
- Email-Adressen
- Discord-IDs
- PIREP-History
- Anderer User
- Awards/Sceneries

Begründung: Token sind in OBS-Browser-Source sichtbar im OBS-Setup. Nicht 100% privat.

### Token-Format
- 32 Zeichen, hex (16 Bytes Random Entropie)
- Generiert via `crypto.randomBytes(16).toString('hex')`
- 128 Bit Entropie = praktisch unmöglich zu brute-forcen
- Pro User EIN Token, lazy generated

### CORS
OBS-Browser-Source ist effektiv ein Browser. Cross-Origin-Requests gehen, aber:
- `Access-Control-Allow-Origin: *` ist OK weil Public-API
- Keine Cookies, keine Credentials
- Read-Only-Endpoint

### Cache
- `Cache-Control: no-store` zwingend
- Sonst zeigt OBS stale Daten
- Cloudflare cached normalerweise nichts mit no-store
