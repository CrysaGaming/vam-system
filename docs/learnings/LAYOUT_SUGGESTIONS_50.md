# 50 Layout-Optimierungen — Sidebar + Dashboard

Backlog von Verbesserungsideen für `apps/web/components/AppShell.tsx`
(Sidebar) und `apps/web/app/dashboard/page.tsx` (Hauptbereich).

Jede Suggestion hat eine grobe Aufwandsschätzung — die ist Pre-Calibration,
also mit Faktor 2-3 für Implementation rechnen. Suggestions sind nach
Wirkung × Aufwand sortiert: ganz oben = höchster Impact, geringster
Aufwand. Reihenfolge im Block ist Empfehlung, nicht zwingend.

## A. Sidebar — Struktur & Hierarchie

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 1 | collapsible-sections | 35min | FLYING / AIRLINE / ADMIN per Klick auf section-header ein/ausklappen. Persistiert in localStorage. Useful wenn Sidebar später viele links hat. |
| 2 | section-reordering | 60min | Drag-and-drop um sections umzusortieren. Mit `react-beautiful-dnd` oder native HTML5-DnD. Persistierung in user-prefs (DB) statt localStorage damit cross-device. |
| 3 | collapsed-rail-mode | 50min | Toggle-button um Sidebar von 240px auf 64px zu kollabieren — nur Icons sichtbar, Text auf hover/popover. Mehr Fläche fürs Dashboard. |
| 4 | active-section-only | 25min | Standardmäßig nur die section ausgeklappt die zur aktiven Route gehört. Andere kollabiert. Reduziert visual noise. |
| 5 | breadcrumb-in-sidebar | 30min | Über dem aktuellen Pfad einen kleinen breadcrumb anzeigen: "AIRLINE > Piloten > #42". Spart das eigene breadcrumb in jedem page-header. |

## B. Sidebar — Visuelle Verbesserung

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 6 | icons-as-svg | 35min | Emojis (🏠 ✈️ 📋) durch lucide-react SVG-icons austauschen. Konsistenter look, scaleable, theme-aware. Bundle-impact ~5KB für 10 icons. |
| 7 | active-link-pulse | 15min | Active link bekommt einen subtilen `animate-pulse` auf dem indigo-border-accent-strip. Visual cue für "du bist hier". |
| 8 | sidebar-gradient-bg | 10min | Subtler vertical gradient von gray-950 → gray-900 statt flat color. Macht die Sidebar weniger "flat". |
| 9 | section-dividers | 10min | Zwischen sections eine subtile horizontal divider-line (border-gray-800/50). Trennt visually ohne extra space-y zu brauchen. |
| 10 | brand-airline-color | 25min | Wenn user.airline einen brand-color hat, den als accent für active-links + brand-block-strip nutzen statt indigo. Schema-erweiterung: `airline.brandColor String?`. |

## C. Sidebar — Funktionalität

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 11 | command-palette | 90min | Cmd+K öffnet floating search/command input. Sucht über Routen, Piloten, Routen-codes. Pattern wie raycast/linear. |
| 12 | quick-action-fab | 30min | Floating-action-button unten rechts neben dem Abmelden-Link für die häufigste Aktion (Neuen Flug einreichen). |
| 13 | notification-badges | 35min | Roter dot oder count-badge auf Sidebar-Links wenn dort was wartet. PIREPs (admin pending), Bookings (deine offenen), neue Routen. |
| 14 | keyboard-shortcuts | 60min | `g d` → Dashboard, `g b` → Bookings, etc. Mit `?` ein Cheatsheet-Modal. Hotkey-listener im AppShell. |
| 15 | recent-pages | 45min | Section "Recent" mit den 3-5 zuletzt besuchten Seiten. Useful für deep-links wie `/pireps/123`. localStorage-history. |

## D. Sidebar — Information Density

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 16 | inline-stats | 30min | Hinter "Bookings" zeigen "(3)" für deine offenen, hinter "PIREPs" "(12)" für total. Live-counts. |
| 17 | user-block-stats | 25min | User-Block bekommt eine kleine Zeile: "1.3h · 1 Flug". Schnell-übersicht ohne Dashboard. |
| 18 | airline-color-strip | 15min | 4px farbiger streifen am linken sidebar-rand in airline-brand-color. Identitäts-marker. |
| 19 | rank-progress-mini | 30min | Im user-block eine 2px progress-bar zum nächsten Rang. "Trainee → First Officer (3%)". |
| 20 | online-status-dot | 25min | Grüner dot am avatar wenn user `lastActiveAt > 5min ago`. Schema: `User.lastActiveAt DateTime?` updaten on every server action. |

## E. Sidebar — Mobile/Responsive

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 21 | slide-out-drawer | 60min | Auf mobile (< lg) Hamburger-Button oben links → slide-in drawer-overlay mit der Sidebar. Aktuell: kein nav auf mobile. |
| 22 | bottom-nav-mobile | 70min | Statt drawer eine fixed bottom-nav-bar mit 4-5 wichtigsten Links als icons. Native-app-feel. |
| 23 | swipe-from-edge | 45min | Touch-gesture: vom linken rand wischen → öffnet drawer. Mit `framer-motion` drag handlers. |
| 24 | tablet-icon-mode | 35min | Auf md (768-1024px) Sidebar nur als Icon-Rail (siehe #3). Auf lg+ erst die volle Version. |
| 25 | drawer-backdrop | 20min | Wenn mobile-drawer offen, transparent-dark backdrop hinter dem drawer. Klick schließt. |

## F. Dashboard — Hero/Welcome

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 26 | personalized-greeting | 15min | "Guten Morgen/Tag/Abend, [Name]" basierend auf Tageszeit statt fix "Willkommen zurück". Einzeiler. |
| 27 | next-flight-hero | 60min | Wenn aktive Booking existiert: prominent oben "Dein nächster Flug: LH918 EDDF→EGLL in 2h 15min" mit CTA "Open SimBrief". |
| 28 | weather-widget | 90min | Wetter am home-airport (user.airline.hubIcao). API: open-meteo (kein key nötig). Klein in der hero-zeile. |
| 29 | goal-of-the-month | 25min | "Ziel: 5 Flüge im Mai · 1/5 done" mit progress-bar. Configurable goal in user settings. |
| 30 | streak-counter | 35min | "🔥 3-Tage-Streak" wenn user heute + die letzten 2 Tage geflogen ist. Berechnet aus PIREPs. |

## G. Dashboard — Stat Cards

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 31 | sparkline-cards | 60min | Stat-cards (Flugstunden, Flüge) bekommen mini sparkline der letzten 30 Tage. Mit `recharts` ResponsiveContainer 60px height. |
| 32 | stat-deltas | 30min | "1.3 h · ↑ +0.8h vs letzte Woche". Schnelle Kontextualisierung ob's vorwärts geht. |
| 33 | rank-celebration | 40min | Wenn user gerade einen rank erreicht hat (rank-up in letzten 7 Tagen): celebration-banner mit confetti. Mit `canvas-confetti`. |
| 34 | reorderable-cards | 90min | Dashboard-cards drag-droppable, layout in user-prefs gespeichert. Power-user feature. |
| 35 | collapsible-cards | 35min | Pfeil oben rechts in jeder section, klick → collapse to header. Persistiert. |

## H. Dashboard — Recent Activity

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 36 | timeline-view | 50min | Letzte Flüge als vertical timeline statt liste — Datums-marker links, flight-card rechts. Visually interesting. |
| 37 | recent-flights-map | 70min | Mapbox mini-map (250px height) mit den letzten 5 Flugrouten als polylines. Static, kein interaction. |
| 38 | flight-card-actions | 35min | Hover über recent-pirep-card → 3 quick-actions: View / Clone / Delete. Aktuell nur klick = view. |
| 39 | activity-feed | 60min | Mixed-feed: deine Flüge + airline-news + pirep-approvals (für admin). Wie Github-feed. |
| 40 | filter-chips | 40min | Über letzte-flüge: chips "Alle | Heute | Diese Woche | Letzter Monat". Pure client-side filter. |

## I. Dashboard — Layout/Grid

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 41 | density-toggle | 25min | Toggle "Compact / Comfortable" — verändert padding/spacing global im Dashboard via CSS-var. |
| 42 | 2-column-on-wide | 30min | Auf 2xl (>1536px) Dashboard in 2 Spalten splitten: links flying-stats, rechts admin/quick-actions. |
| 43 | sticky-section-headers | 25min | Beim scrollen bleiben section-headers oben kleben (sticky top-0). Für Orientierung in langen Dashboards. |
| 44 | skeleton-loading | 35min | Während Prisma-queries laufen, skeleton-shimmer statt blank. Mit `loading.tsx` route segment. |
| 45 | dashboard-tabs | 60min | Tabs oben: "Übersicht | Statistiken | Activity | Admin". Splittet das aktuelle long-scroll dashboard. |

## J. Dashboard — Engagement

| # | Name | Aufwand | Beschreibung |
|---|------|---------|--------------|
| 46 | welcome-tour | 90min | First-login: Spotlight-tour durch sidebar + dashboard. Mit `react-joyride` oder selber bauen. Cookie-flag hideToured. |
| 47 | achievement-badges | 75min | "Erster Flug ✓ · 10h Marke ✓ · Erster Long-haul ✗". Schema: `Achievement` + `UserAchievement`. Visual badges-grid section. |
| 48 | interactive-leaderboard | 50min | Top-piloten: hover → tooltip mit details. Klick → /pilots/[id]. Aktuell ist leaderboard read-only. |
| 49 | calendar-heatmap | 70min | Github-style contribution-heatmap: jede zelle = ein tag, intensität = flugstunden. 12-monats-view. Mit `react-calendar-heatmap`. |
| 50 | action-suggestions | 90min | "Du warst 2 Wochen nicht geflogen — clone last flight?". KI-light: rules-based suggestions im hero-banner. |

---

## Reihenfolge wenn ich was implementieren würde

Sortiert nach impact ÷ aufwand, top 10:

1. **#26 personalized-greeting** (15min) — winzig, charmanter
2. **#7 active-link-pulse** (15min) — visual polish
3. **#9 section-dividers** (10min) — visual polish
4. **#8 sidebar-gradient-bg** (10min) — visual polish
5. **#16 inline-stats** (30min) — sehr nützlich
6. **#13 notification-badges** (35min) — sehr nützlich  
7. **#27 next-flight-hero** (60min) — high-value, geht weit
8. **#11 command-palette** (90min) — power-user feature
9. **#21 slide-out-drawer** (60min) — mobile users
10. **#36 timeline-view** (50min) — schöner als die liste

## Reihenfolge wenn der user "alles polish" will

1-25 zuerst (alle sidebar), dann 26-50 (alle dashboard). Die A-J
gruppierung erlaubt einen "ein-block-am-tag" approach.

## Aktueller status

Implementiert in dieser Phase: **0 / 50**.
Pending — Backlog für Day-5+.
