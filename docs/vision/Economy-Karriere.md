# Vision: Economy- & Karriere-System

> **Status**: Vision / Brainstorm / Architektur-Skizze
> **Datum**: 2026-05-03 (Tag 6 des Projekts)
> **Gilt als**: nicht-bindender Entwurf für künftige Implementation
> **Verwandt**:
> - `vam-master-roadmap.md` Track 5 (Business-Layer Strategic Bet) — **dieses Dokument ist der deep-dive dazu**
> - `twitch-to-sim-integration.md` — Sim-write-direction (viewer → sim-action). Komplementär: hier ist economy-revenue-direction (viewer → ticket-revenue)
> - `admin-dashboards-vision.md` Section 9.8 (Twitch-Innovations)
> **Strategischer Kontext**: Economy + Career sind die zwei Differentiator-Layer die VAM-System von "ein weiteres VA-Tool" zu "der Standard-Platform für Sim-Pilot-Communities" heben können.

Diese Doc beschreibt die **vollständige Vision** für ein Economy- und Karriere-System inkl. Stock-Market, Pilot-Lizenzen, Twitch-monetization, und einer Liste von Features die noch keine VA-Plattform hat. Komplexität und Aufwand werden bewusst **nicht limitiert** — das ist die Maximalvision, die Implementation wird in Phasen über 2-3 Jahre gehen.

---

## Inhaltsverzeichnis

### TEIL I — DESIGN-PRINZIPIEN
1. [Strategische Begründung](#1-strategische-begründung)
2. [Architektur-Prinzipien](#2-architektur-prinzipien)
3. [Per-User Opt-In Granularität](#3-per-user-opt-in-granularität)
4. [Realismus-Spektrum](#4-realismus-spektrum)

### TEIL II — ECONOMY-CORE
5. [Currency-Design](#5-currency-design)
6. [Wallet-System](#6-wallet-system)
7. [Revenue-Streams](#7-revenue-streams)
8. [Expense-Streams](#8-expense-streams)
9. [Aircraft-Economy](#9-aircraft-economy)
10. [Fuel-Economy](#10-fuel-economy)
11. [Maintenance-System](#11-maintenance-system)
12. [Insurance-System](#12-insurance-system)

### TEIL III — KARRIERE
13. [Lizenzen-System (FAA/EASA-Realistic)](#13-lizenzen-system)
14. [Flugschule](#14-flugschule)
15. [Rank-Progression](#15-rank-progression)
16. [Type-Ratings](#16-type-ratings)
17. [Pilot-Reputation](#17-pilot-reputation)
18. [Achievements & Badges](#18-achievements--badges)
19. [Recurrent-Training](#19-recurrent-training)

### TEIL IV — BÖRSE & FINANZMÄRKTE
20. [VAM Stock Exchange (VAMSE)](#20-vam-stock-exchange-vamse)
21. [Trading-Mechaniken](#21-trading-mechaniken)
22. [Bonds & Loans](#22-bonds--loans)
23. [Commodities-Markt](#23-commodities-markt)
24. [Insider-Trading-Rules](#24-insider-trading-rules)

### TEIL V — TWITCH & STREAMER-INTEGRATION
25. [Account-Linking & EventSub](#25-account-linking--eventsub)
26. [Channel-Points → Tickets](#26-channel-points--tickets)
27. [Subscriptions → VIP-Sitze](#27-subscriptions--vip-sitze)
28. [Bits → Cargo](#28-bits--cargo)
29. [Hype-Train-Multiplier](#29-hype-train-multiplier)
30. [Stream-Overlay-Integration](#30-stream-overlay-integration)
31. [Multi-Streamer-Events](#31-multi-streamer-events)
32. [Charity-Flights](#32-charity-flights)
33. [Non-Streamer-Fairness](#33-non-streamer-fairness)
34. [YouTube/Kick-Equivalents](#34-youtubekick-equivalents)

### TEIL VI — CARGO & PASSENGER-DEPTH
35. [Cargo-Types](#35-cargo-types)
36. [Cargo-Contracts](#36-cargo-contracts)
37. [Passenger-Classes & Load-Factor](#37-passenger-classes--load-factor)
38. [Catering-System](#38-catering-system)
39. [Special-Mission-Types](#39-special-mission-types)

### TEIL VII — MULTI-AIRLINE-MECHANIKEN
40. [Alliances](#40-alliances)
41. [M&A-Mechaniken](#41-ma-mechaniken)
42. [Subsidiaries](#42-subsidiaries)
43. [Codeshare-System](#43-codeshare-system)

### TEIL VIII — EVENTS & SEASONAL
44. [Real-World-Event-Mirror](#44-real-world-event-mirror)
45. [In-System-Events](#45-in-system-events)
46. [Disaster-Events](#46-disaster-events)
47. [Live-Multi-Pilot-Events](#47-live-multi-pilot-events)

### TEIL IX — SOZIAL & GAMIFICATION
48. [Crew-System](#48-crew-system)
49. [Daily-Quests & Streaks](#49-daily-quests--streaks)
50. [Seasonal-Pässe](#50-seasonal-pässe)
51. [Forums & Trip-Reports](#51-forums--trip-reports)
52. [Pilot-Mentorship](#52-pilot-mentorship)

### TEIL X — UNIQUE FEATURES (NIEMAND HAT DAS)
53. [USP-Catalog](#53-usp-catalog)

### TEIL XI — ARCHITEKTUR & ROLLOUT
54. [Schema-Vorbereitungs-Strategie](#54-schema-vorbereitungs-strategie)
55. [Module-Isolation](#55-module-isolation)
56. [Background-Jobs](#56-background-jobs)
57. [Anti-Cheat](#57-anti-cheat)
58. [Phasen-Roadmap](#58-phasen-roadmap)

### TEIL XII — RISIKEN & ABSCHLUSS
59. [Risiken & Mitigations](#59-risiken--mitigations)
60. [Out-of-Scope](#60-out-of-scope)
61. [Cross-References](#61-cross-references)

---

# TEIL I — DESIGN-PRINZIPIEN

## 1. Strategische Begründung

### 1.1 Warum Economy + Career UND nicht nur eines?

Die VA-Landschaft hat heute **zwei klar getrennte Lager**:

| Lager | Beispiele | Stärke | Schwäche |
|---|---|---|---|
| **VA-Tools** | phpVMS, vaCentral, VAMSYS | Solide pilot-management, hubs, fleet | Economy meist rudimentär oder fehlt |
| **Career-Sims** | OnAir, Air Hauler 2, Neofly | Tiefes economy + career | Single-player, keine VA-strukturen |

**Marktlücke:** Eine Plattform die **beides** vereint — VA-strukturen (airline, ranks, hubs, multi-pilot) PLUS deep economy (wallet, stocks, maintenance, fuel-market). Aktuell muss ein VA-pilot zwischen 2 systemen jonglieren.

### 1.2 Warum jetzt das Schema vorbereiten

Economy ist der **invasivste Layer** in jedem Software-System. Wenn man es nachträglich einbaut, muss jede table angefasst werden. Wenn man jetzt schon ein paar Felder vorbereitet (5 Boolean-flags + 3 enums), kostet das im Augenblick fast nichts und erspart später eine massive migration.

### 1.3 Streamer-First aber nicht Streamer-Only

Master-Roadmap-Entscheidung (siehe `vam-master-roadmap.md`): VAM ist **Content-Creator-First**. Aber:
- 80% der zielgruppe streamt **nicht** und soll voll funktional sein
- Streamer bekommen +Layer (twitch-tickets, overlays, multi-pilot-events)
- Streaming-bonus ist max **+30% revenue**, nicht 10× — verhindert pay-to-win-feeling

---

## 2. Architektur-Prinzipien

### 2.1 Layered Architecture

Economy ist ein **separater layer über** dem flight-system, nie ein in-place upgrade:

```
┌──────────────────────────────────────────────────────────────────┐
│  💰 ECONOMY LAYER (opt-in per user, opt-in per airline)          │
│     ─ Wallet, Transaction, Salary, Expense, Revenue              │
│     ─ Aircraft-ownership, Maintenance, Fuel-pricing              │
│     ─ Career: Licenses, Type-Ratings, Rank-Progression           │
│     ─ Stock-Market: Shares, Bonds, Trading-Engine                │
│     ─ Twitch-bridge: Channel-Point-Tickets, Sub-VIPs             │
│                                                                  │
│     ⬇ Liest aus Flight-Layer; schreibt nur in Economy-Tables.   │
├──────────────────────────────────────────────────────────────────┤
│  ✈️  FLIGHT LAYER (foundation, jetzt schon teilweise da)         │
│     ─ Route, Hub, Position, PIREP, Booking, Aircraft, Fleet      │
│     ─ Flight-Types: SCHEDULED/CHARTER/POSITIONING/TRAINING/FREE  │
│     ─ Funktioniert vollständig OHNE economy-layer.               │
├──────────────────────────────────────────────────────────────────┤
│  🔌 INTEGRATIONS LAYER (extern)                                  │
│     ─ ACARS-client, VATSIM-API, IVAO-API, SimBrief               │
│     ─ Twitch-EventSub, YouTube-Live-API, Kick-Webhooks           │
│     ─ Discord-Bot, OBS-Overlay-bridge                            │
└──────────────────────────────────────────────────────────────────┘
```

**Wichtig**: Flight-Layer kennt economy nicht. Economy-Layer kennt flight-layer aber nicht umgekehrt. Wenn morgen jemand das economy-modul disabled, läuft das flight-system perfekt weiter.

### 2.2 Backwards-Compatibility-Garantie

Existing pilots dürfen NIEMALS gezwungen werden economy zu nutzen. Alle Änderungen sind:
- **Additive** (neue felder, alle nullable/default)
- **Opt-in** (master-switch + granular)
- **Reversibel** (deactivate beendet feature ohne datenverlust)

### 2.3 Event-Driven Economy

Economy-events werden über event-bus propagiert, nicht direkt:

```typescript
// Bad — tight coupling
async function approvePirep(id) {
  await prisma.pirep.update(...);
  if (user.economyEnabled) {
    await calculateRevenue(...);  // economy-logic in flight-code!
    await payPilotSalary(...);
  }
}

// Good — event-driven
async function approvePirep(id) {
  await prisma.pirep.update(...);
  await eventBus.emit('pirep.approved', { pirepId: id });
}

// In economy-module:
eventBus.on('pirep.approved', async ({ pirepId }) => {
  const pirep = await loadWithUser(pirepId);
  if (!pirep.user.economyEnabled) return;
  await calculateRevenue(...);
  await payPilotSalary(...);
});
```

Vorteil: economy-modul kann offline genommen werden ohne flight-features zu brechen.

---

## 3. Per-User Opt-In Granularität

Master-switch + granular toggles. Realism-presets setzen sinnvolle defaults:

### 3.1 Settings-Schema (Vorschlag)

```prisma
model UserSettings {
  userId  String  @id
  user    User    @relation(fields: [userId], references: [id])

  // Master switches
  economyEnabled        Boolean @default(false)
  careerEnabled         Boolean @default(false)
  stockMarketEnabled    Boolean @default(false)
  twitchEnabled         Boolean @default(false)
  eventsEnabled         Boolean @default(true)

  // Granular economy toggles
  maintenanceEnabled    Boolean @default(false)
  fuelEconomyEnabled    Boolean @default(false)
  cargoEnabled          Boolean @default(false)
  insuranceEnabled      Boolean @default(false)

  // Granular career toggles
  licenseProgressionEnabled Boolean @default(false)
  recurrentTrainingEnabled  Boolean @default(false)
  rankRequirementsEnabled   Boolean @default(false)

  // Realism preset (overrides granular flags when changed)
  realismLevel          RealismLevel @default(CASUAL)

  // Streamer features
  twitchChannelId       String?
  showStreamOverlay     Boolean @default(false)
  ticketRevenueShare    Decimal @default(50)  // % to pilot vs airline

  // Privacy
  showOnLeaderboards    Boolean @default(true)
  showFinancialsPublic  Boolean @default(false)
}

enum RealismLevel {
  CASUAL      // Nichts, nur fliegen — economyEnabled=false
  STANDARD    // Basis-economy, salary, fuel — meiste flags an
  REALISTIC   // + maintenance, insurance, career-progression
  HARDCORE    // + cooldowns, type-rating-currency, recurrent-training-pflicht
}
```

### 3.2 Settings-UI

Tab-struktur in /settings/economy:

```
┌────────────────────────────────────────────────────────┐
│ ⚙️  Realismus-Modus                                    │
│ ○ Casual    ○ Standard    ● Realistic    ○ Hardcore   │
│                                                        │
│ ▾ Erweiterte Einstellungen                            │
│   ☑ Economy aktivieren                                │
│     ☑ Aircraft-Maintenance                            │
│     ☑ Dynamic Fuel-Pricing                            │
│     ☑ Cargo-Flights                                   │
│     ☐ Insurance-System                                │
│   ☑ Career-Progression                                │
│     ☑ License-System                                  │
│     ☐ Recurrent-Training-Pflicht                      │
│   ☐ Stock-Market                                      │
│   ☑ Live-Events                                       │
│                                                        │
│ ▾ Streaming                                            │
│   ☐ Twitch-Account verknüpfen                         │
│                                                        │
│ ⚠ Du kannst Einstellungen jederzeit ändern. Dein      │
│   Flight-Progress bleibt erhalten.                    │
└────────────────────────────────────────────────────────┘
```

### 3.3 Airline-Level Opt-In

Airline kann auch features deaktivieren — dann sehen ihre piloten die features nicht, auch wenn user-flag an:

```
showFeature(user, feature) =
  user.settings[feature] && airline.settings[feature]
```

Use-case: Eine "fun-airline" für freunde will keine economy. Die airline-admin disabled economy global, alle piloten dort sehen nur das flight-system.

---

## 4. Realismus-Spektrum

| Modus | Wer | Was wird simuliert |
|---|---|---|
| **CASUAL** | "Ich will nur fliegen" | Nur PIREPs + ranks (hours-based). Keine money, keine maintenance, alles frei. |
| **STANDARD** | Default für meiste | Basis-wallet, salary, fuel-cost. Aircraft sind airline-asset, kein wear. |
| **REALISTIC** | Engagierte VAs | + Maintenance, insurance, career-progression, type-ratings, dynamic-fuel-pricing |
| **HARDCORE** | OnAir-style hardcore | + Recurrent-training-pflicht, currency-rules (90-day-rule), pilot-credit-score, hub-cooldowns für jumpseat |

Realism-level setzt presets aber granular kann übersteuert werden. Ein "STANDARD"-pilot kann maintenance aktivieren ohne in REALISTIC zu wechseln.

---

# TEIL II — ECONOMY-CORE

## 5. Currency-Design

### 5.1 VAM$ als primary currency

- Eindeutiger name: **VAM$** (virtual airline management dollar)
- Nicht USD/EUR um real-money-confusion zu vermeiden
- Decimal-precision: 2 stellen (cent-accurate)
- Inflation-control über regular sinks

### 5.2 Inflation-Control-Mechanismen

EVE Online economist-lessons: Wenn du money druckst aber nicht zerstörst, wird die währung wertlos.

**Sources (money-creation):**
- Passenger-revenue (created by system)
- Cargo-revenue
- Stock-dividends
- Twitch-tickets

**Sinks (money-destruction):**
- Fuel-cost
- Maintenance
- Landing-fees
- Salary (wenn airline → pilot, wechselt nur owner; wenn airline → system, ist sink)
- Insurance-premiums
- Airport-slot-fees
- Stock-broker-fees (3% wie EVE)
- Aircraft-purchase (split: 80% sink, 20% to airline-fund)
- Type-rating-training-cost

**Monitoring:** Daily-job summiert sources vs sinks pro tag. Dashboard für system-admin um inflation zu erkennen. Wenn ratio > 1.1 für 7 tage → automatisches "fuel-crisis-event" (sink-multiplier).

### 5.3 Wallet-Owner-Types

```prisma
enum WalletOwnerType {
  USER        // Pilot's persönliches wallet
  AIRLINE     // Airline-operating-account
  AIRLINE_PAYROLL  // Separate für salary-runs (best-practice accounting)
  AIRLINE_MAINTENANCE  // Reserve für scheduled-checks
  SYSTEM      // VAM-system-treasury (für sinks)
}
```

Eine airline kann mehrere wallets haben (operating, payroll, maintenance, marketing) für realistic financial-segregation.

---

## 6. Wallet-System

### 6.1 Schema

```prisma
model Wallet {
  id            String          @id @default(cuid())
  ownerType     WalletOwnerType
  ownerUserId   String?
  ownerAirlineId String?
  walletType    String          @default("primary")  // "primary" | "payroll" | "maintenance" | "marketing"
  currency      String          @default("VAM$")
  balance       Decimal         @default(0) @db.Decimal(18, 2)
  createdAt     DateTime        @default(now())

  // Optional: credit-line / overdraft
  creditLimit   Decimal?        @db.Decimal(18, 2)

  transactions  Transaction[]

  @@unique([ownerType, ownerUserId, ownerAirlineId, walletType])
}

model Transaction {
  id           String          @id @default(cuid())
  walletId     String
  wallet       Wallet          @relation(fields: [walletId], references: [id])
  amount       Decimal         @db.Decimal(18, 2)  // signed: + income, - expense
  balanceAfter Decimal         @db.Decimal(18, 2)  // snapshot for audit
  category     String          // "fuel" | "salary" | "ticket-revenue" | ...
  type         TransactionType
  description  String
  pirepId      String?         // welcher flight (wenn relevant)
  bookingId    String?
  counterpartyWalletId String?  // für transfers
  metadata     Json?           // flexibel für extra-context
  createdAt    DateTime        @default(now())

  @@index([walletId, createdAt])
}

enum TransactionType {
  REVENUE_PASSENGER
  REVENUE_CARGO
  REVENUE_TICKET_TWITCH
  REVENUE_DIVIDEND
  EXPENSE_FUEL
  EXPENSE_LANDING_FEE
  EXPENSE_GROUND_HANDLING
  EXPENSE_CATERING
  EXPENSE_MAINTENANCE
  EXPENSE_INSURANCE
  SALARY_PAID
  SALARY_RECEIVED
  TRANSFER_OUT
  TRANSFER_IN
  PURCHASE_AIRCRAFT
  PURCHASE_TYPE_RATING
  PURCHASE_LICENSE_TRAINING
  STOCK_BUY
  STOCK_SELL
  STOCK_BROKER_FEE
  BOND_INTEREST
  LOAN_DISBURSE
  LOAN_REPAY
  TAX_PAID
  ADJUSTMENT_ADMIN
  ECONOMY_RESET
}
```

### 6.2 Immutable Audit-Log

Transactions sind **append-only**. Kein update, kein delete. Reversal = neue gegenläufige transaction.

Begründung: Audit-trail für anti-cheat und disputes. Wenn ein admin sagt "diese 50.000 VAM$ waren falsch" → adjustment-transaction erzeugen, original bleibt sichtbar.

### 6.3 Inter-Wallet-Transfers

```typescript
async function transfer(fromWalletId, toWalletId, amount, description) {
  await prisma.$transaction(async (tx) => {
    // Atomic: beide transactions oder keine
    await tx.transaction.create({
      walletId: fromWalletId,
      amount: -amount,
      type: 'TRANSFER_OUT',
      counterpartyWalletId: toWalletId,
      description,
    });
    await tx.transaction.create({
      walletId: toWalletId,
      amount: +amount,
      type: 'TRANSFER_IN',
      counterpartyWalletId: fromWalletId,
      description,
    });
    await tx.wallet.update({ where: {id: fromWalletId}, data: { balance: {decrement: amount}}});
    await tx.wallet.update({ where: {id: toWalletId}, data: { balance: {increment: amount}}});
  });
}
```

### 6.4 Loans & Credit

- Pilot kann loan aufnehmen (max 5× monthly-salary)
- Airline kann bonds issuen für expansion
- Interest-rate basiert auf reputation/credit-score
- Default → reputation-hit + collateral-seizure (aircraft repossessed)

---

## 7. Revenue-Streams

### 7.1 Passenger-Revenue (industry-standard formel)

Aus phpVMS-research, mit erweiterungen:

```
revenue_per_class = base_fare * (1 + per_mile_rate * distance_nm) * class_multiplier
                  * load_factor * seat_capacity
                  * route_popularity_modifier
                  * day_of_week_modifier
                  * season_modifier
                  * marketing_modifier
                  * pilot_reputation_modifier

total_revenue = sum(revenue_per_class for class in [economy, premium, business, first])
```

**Defaults (industry-research):**
- `base_fare = 50 VAM$`
- `per_mile_rate = 0.11`
- Multipliers: economy=1.0, premium=1.5, business=3.0, first=5.0
- `load_factor` default 62%, calculated based on:
  - Route-popularity (LH918 EDDF→EGLL = 85%, exotic = 30%)
  - Day-of-week (Mon-Tue business heavy +5%, Fri-Sun leisure +5%)
  - Season modifier (summer-EU heavy, winter-canaries heavy)
  - Marketing-budget (höhere ausgaben → +load-factor)

### 7.2 Cargo-Revenue

```
cargo_revenue = cargo_kg * rate_per_kg * urgency_multiplier * distance_modifier

rate_per_kg defaults:
  general:    0.50 VAM$
  perishable: 1.20 (refrigerated, time-pressure)
  hazardous:  2.00 (DGR-cert required)
  live:       3.00 (special handling)
  mail:       0.80 (government-contract)
  heavy:      0.40 (volume-based)
```

### 7.3 Special-Mission-Revenue

| Mission-Type | Revenue-Modell |
|---|---|
| **VIP-Charter** | Fixed-fee 50.000-500.000 VAM$ je nach client (politician, celebrity, executive) |
| **Government-Mail** | Fixed monthly-contract, route-restricted |
| **Sightseeing** | Per-passenger, route ist eine round-trip, premium-rate |
| **Medevac** | Time-bonus (faster = more) + risk-premium |
| **Search-and-Rescue** | Government-funded, fixed-fee + bonus für found-person |
| **Firefighting** | Seasonal (sommer), per-tank-drop + hazard-pay |
| **Aerial-Photography** | Specific routes (photograph X area), per-mission-fee |
| **Parachute-Drops** | Per-jumper-fee, GA-aircraft only |

### 7.4 Twitch-Tickets als revenue

Siehe Section 26-29 für details. Kurz:
- Channel-point-redemption → economy-ticket-revenue
- Tier-1-sub → economy-seat
- Tier-2-sub → business-seat
- Tier-3-sub → first-seat
- Bits → cargo

Diese werden als reguläre revenue-transactions geloggt, mit `type: REVENUE_TICKET_TWITCH` und metadata des viewer-namens.

---

## 8. Expense-Streams

### 8.1 Per-Flight-Expenses

```
total_flight_expense = fuel_cost
                     + landing_fee_arrival
                     + landing_fee_departure
                     + ground_handling_arrival
                     + ground_handling_departure
                     + catering_cost
                     + crew_cost (block-hour-rate)
                     + slot_fees (busy airports)
                     + overflight_fees (countries durchquert)
                     + maintenance_reserve (per-block-hour, accumulates)
```

**Detaillierung:**

| Expense | Defaults | Berechnung |
|---|---|---|
| **Fuel** | Dynamic per airport | `fuel_used_kg * price_per_kg_at_departure` |
| **Landing-fee** | Per airport-class | small=50, medium=200, large=800, hub=1500 VAM$ |
| **Ground-handling** | Per aircraft-class | GA=20, narrow-body=300, wide-body=800 VAM$ |
| **Catering** | Per passenger | snack=2, cold-meal=8, hot-meal=15, full-service=35 VAM$ |
| **Crew-cost** | Block-hour | basis pilot-salary × hours, plus FA-team |
| **Slot-fees** | Top-50 airports | 100-2000 VAM$ je nach time-slot (peak vs off-peak) |
| **Overflight** | Per country | europe ~200 VAM$, intercontinental ~500-2000 |

### 8.2 Recurring-Expenses (monthly)

| Expense | Wer zahlt | Defaults |
|---|---|---|
| **Aircraft-lease** | Airline | per aircraft-type, 50.000-500.000 VAM$/mo |
| **Hangar-rent** | Airline | per hub, per aircraft-slot |
| **Insurance-premium** | Airline+pilot | varies by reputation, value, hours |
| **Office-rent** | Airline | per hub, fixed |
| **Staff-salaries** | Airline | dispatchers, ground-crew, admin |
| **Marketing-budget** | Airline | optional, affects load-factor |
| **Recurrent-training** | Pilot | every 6 months, type-rating retention |
| **License-medical** | Pilot | annual, smaller cost |

### 8.3 One-Time-Expenses

| Expense | Defaults |
|---|---|
| **Aircraft-purchase** | 1M-300M VAM$ je nach type |
| **Type-rating-course** | 50.000-200.000 VAM$ |
| **License-training** | siehe Section 14 (Flugschule) |
| **Hub-opening** | 5M-50M VAM$ je nach airport-class |
| **D-Check** | 500.000-5M VAM$ je nach aircraft |

---

## 9. Aircraft-Economy

### 9.1 Aircraft-Ownership-Types

```prisma
enum AircraftOwnerType {
  AIRLINE          // Default, airline owns
  USER             // Pilot owns (für free-flights)
  LEASE_OPERATING  // Airline leases (monthly fee, no ownership)
  LEASE_FINANCE    // Airline financing → ownership-transfer am ende
  WET_LEASE        // Airline leases incl. crew (rare, complex)
}

model Aircraft {
  // ... existing
  ownerType        AircraftOwnerType @default(AIRLINE)
  ownerUserId      String?           // wenn USER
  ownerAirlineId   String?           // wenn AIRLINE
  acquisitionPrice Decimal?
  currentValue     Decimal?          // Depreciation tracked
  conditionPercent Float @default(100)  // 0-100 maintenance state
  hoursTotal       Float @default(0)
  cyclesTotal      Int   @default(0)
  lastACheckHours  Float @default(0)
  lastBCheckDate   DateTime?
  lastCCheckDate   DateTime?
  lastDCheckDate   DateTime?
}
```

### 9.2 Aircraft-Marketplace

**Buy/Sell:**
- New aircraft: gelistet von "manufacturer" (system-NPC). Fixed price (z.B. A320neo = 110M VAM$).
- Used aircraft: airlines/pilots können ihre verkaufen. Price-discovery via:
  - Manual list-price
  - Auction-system (highest-bid wins)
  - Buy-now-option
- Used-price-formula: `new_price * 0.7^(age_years/5) * (condition/100) * market_adjustment`

**Marketplace-UI:**
```
┌────────────────────────────────────────────────────┐
│ 🛩️ Aircraft-Marktplatz                            │
│ [Filter: Type ▼] [Age ▼] [Price ▼] [Condition ▼] │
├────────────────────────────────────────────────────┤
│ A320-200  D-AISL  EDDF  3.400h  85%  4.2M VAM$    │
│ B738      G-RYAB  EGSS  12.900h 67%  2.1M VAM$    │
│ CRJ900    OE-ICE  LOWW  900h    98%  9.8M VAM$    │
└────────────────────────────────────────────────────┘
```

### 9.3 Aircraft-Depreciation

- Linear über 25 jahre auf 10% residual
- Beschleunigt durch hard-landings (-5% condition each)
- Maintenance-quality wirkt auf depreciation-rate

### 9.4 Hangar-Storage

- Aircraft brauchen einen "home-base" (= existing `Aircraft.homeIcao` field, finally used!)
- Hangar-rent per slot per month
- Aircraft "outside" = +20% maintenance-cost (weather-exposure)
- Premium-hangars (climate-controlled) = -10% maintenance, höherer rent

---

## 10. Fuel-Economy

### 10.1 Dynamic Fuel-Pricing

```prisma
model FuelPrice {
  id          String   @id @default(cuid())
  airportId   String
  airport     Airport  @relation(fields: [airportId], references: [id])
  fuelType    FuelType
  pricePerKg  Decimal  @db.Decimal(10, 4)
  validFrom   DateTime
  validUntil  DateTime?
  source      FuelPriceSource

  @@index([airportId, fuelType, validFrom])
}

enum FuelType {
  JET_A1
  AVGAS_100LL
  MOGAS
  SAF       // Sustainable Aviation Fuel
}

enum FuelPriceSource {
  STATIC       // Default price-list per region
  REAL_WORLD   // Tied to actual jet-fuel index
  MARKET       // Player-driven (FBO-system)
  EVENT        // Forced by system-event (fuel-crisis)
}
```

### 10.2 Fuel-Price-Calculation

Daily-job updates prices basierend auf:
1. Base-price per region (NA/EU/AS/AF/OC/SA)
2. Airport-tier multiplier (large-hub +10%, remote +30%)
3. Real-world jet-fuel-index (wenn `REAL_WORLD` source enabled)
4. Random walk ±5% daily variance
5. Event-multiplier (fuel-crisis = 200%)

### 10.3 FBO-System (Player-Owned Fuel-Storage)

OnAir-inspired:
- Pilot oder airline kann FBO an einem airport bauen (10M-50M VAM$ initial)
- Buy fuel when cheap, store, sell when expensive
- Other pilots können dort tanken (player-set price + fee)
- Storage-limit per FBO (10.000-200.000 kg)
- FBO-maintenance-cost monthly

```prisma
model FBO {
  id              String   @id @default(cuid())
  airportId       String
  ownerType       WalletOwnerType  // USER | AIRLINE
  ownerId         String
  fuelType        FuelType
  storageCapacity Int      // kg
  currentStock    Int
  sellPrice       Decimal  @db.Decimal(10, 4)
  isPublic        Boolean  @default(true)  // andere können tanken
  monthlyRent     Decimal
  createdAt       DateTime @default(now())
}
```

### 10.4 Fuel-Hedging (advanced)

Stock-market-section, aber kurz: airlines können fuel-futures kaufen für price-stability. Wenn fuel-price steigt, hedge gewinnt. Wenn fällt, verloren.

---

## 11. Maintenance-System

### 11.1 Realistic Maintenance-Schedule

ICAO/FAA-realistic:

| Check | Intervall | Cost-range | Downtime |
|---|---|---|---|
| **Pre-flight** | Jeder flight | 0 (in ground-handling) | 0 |
| **A-Check** | 500 flight-hours | 50.000-100.000 VAM$ | 6-12 hours |
| **B-Check** | 6 monate | 100.000-200.000 VAM$ | 1-3 days |
| **C-Check** | 18-24 monate | 500.000-1.500.000 VAM$ | 1-2 weeks |
| **D-Check** | 6-10 jahre | 3M-10M VAM$ | 1-2 months |

(B-Check ist IRL phasing-out, aber für sim als step zwischen A und C nützlich.)

### 11.2 Maintenance-Bases

Nicht jeder airport kann jeden check. MRO-facilities:
- A-Check: alle medium+ airports
- B-Check: large airports + dedicated MRO
- C-Check: nur ~50 große airports global (LFBO Toulouse, EDDH Hamburg, OMDB Dubai, etc.)
- D-Check: nur ~10 spezial-MROs

Wenn aircraft check braucht aber falsch positioniert → ferry-flight nötig (POSITIONING-typ).

### 11.3 Unscheduled Maintenance

Random events basierend auf condition-percent:
- < 90%: 1% chance per flight für minor-issue
- < 70%: 5% chance, plus performance-degradation
- < 50%: 15% chance, AOG-risk (aircraft-on-ground)
- < 30%: Aircraft grounded bis fix

Issue-types:
- Engine-anomaly → reduce thrust 10% next flight
- Avionics-glitch → no-impact, must-fix
- Hydraulic-leak → safety-issue, AOG until fixed
- Tire-wear → routine
- Bird-strike → engine-inspection-required

### 11.4 Maintenance-Cost-Reserve

Jeder flight buchen eine reserve-amount in `AIRLINE_MAINTENANCE` wallet:
- Block-hour-cost × hours flown
- Default 200-500 VAM$/hour je nach aircraft-class
- Beim scheduled-check wird die reserve aufgebraucht
- Wenn reserve < cost → loan oder cash-flow-issue

---

## 12. Insurance-System

### 12.1 Hull-Insurance

Annual premium, varies by:
- Aircraft-value
- Pilot-experience (junior pilots = höhere premium)
- Airline-safety-record
- Aircraft-age
- Geography (war-zones premium, weather-exposed regions)

`premium = aircraft_value * base_rate * (1 + risk_modifiers)`

Defaults: base_rate = 2-5% pa des aircraft-value.

### 12.2 Liability-Insurance

Per-flight, mandatory für commercial:
- Per-passenger coverage (10M VAM$ per pax standard)
- Cargo-coverage
- Third-party (ground-property, other aircraft)

### 12.3 Claims-System

When pilot has incident (hard-landing, gear-collapse, hull-loss):
1. Auto-claim filed in system
2. "Investigation" period (3 days IRL)
3. Investigator-NPC (or admin) reviews PIREP-data
4. Payout oder denial
5. Reputation-impact

### 12.4 Pilot-Personal-Insurance

Optional separate für pilot's wallet (loss-of-license, disability). Like real-world pilot insurance.

---

# TEIL III — KARRIERE

## 13. Lizenzen-System

### 13.1 ICAO-Realistic License-Hierarchy

```
SPL (Student Pilot)
  ↓
PPL (Private Pilot)        — VFR, single-engine, day, no commercial
  ↓ (optional)
+ Night Rating
+ Instrument Rating (IR)
+ Multi-Engine Rating (ME)
  ↓
CPL (Commercial Pilot)     — kann für money fliegen, single-pilot ops
  ↓
+ Multi-Crew Cooperation (MCC)
+ Type Ratings              — per aircraft-class
  ↓
ATPL (Airline Transport Pilot) — captain für commercial-airlines
  ↓
+ TRI (Type Rating Instructor)  — kann andere ausbilden
+ TRE (Type Rating Examiner)    — kann checks abnehmen
```

### 13.2 Schema

```prisma
model PilotLicense {
  id             String         @id @default(cuid())
  userId         String
  user           User           @relation(fields: [userId], references: [id])
  type           LicenseType
  issuedAt       DateTime
  expiresAt      DateTime?      // PPL = lifetime, IR = 1 year, etc.
  issuingAuthority String       // "EASA" | "FAA" | "TCCA" | etc.
  certificateNumber String      @unique
  status         LicenseStatus  @default(ACTIVE)

  @@unique([userId, type])
}

enum LicenseType {
  SPL
  PPL
  NIGHT_RATING
  INSTRUMENT_RATING
  MULTI_ENGINE_RATING
  CPL
  MCC
  ATPL
  TRI  // Type Rating Instructor
  TRE  // Examiner
}

enum LicenseStatus {
  ACTIVE
  EXPIRED       // medical lapsed, recurrent missed
  REVOKED       // disciplinary
  SUSPENDED     // temporary
}

model TypeRating {
  id           String   @id @default(cuid())
  userId       String
  aircraftType String   // ICAO code: A320, B738, B748, A35K
  obtainedAt   DateTime
  expiresAt    DateTime?  // 12 months für meiste
  hoursOnType  Float    @default(0)
  lastFlownAt  DateTime?

  @@unique([userId, aircraftType])
}
```

### 13.3 License → Aircraft-Mapping

```typescript
function canPilotFlyAircraft(pilot, aircraft): boolean {
  const requirements = aircraftRequirements(aircraft.type);
  
  // Examples:
  // C172 → PPL (any non-revenue) or CPL (revenue)
  // A320 → CPL + Multi-Engine + IR + Type Rating A320
  // A350 → ATPL + Multi-Engine + IR + Type Rating A35K + MCC
  
  return requirements.every(req => pilot.hasLicense(req) && pilot.licenseValid(req));
}
```

Wenn pilot ohne required license fliegt:
- **Career-mode:** Booking blocked
- **Non-career:** Warnung, aber erlaubt
- **Hardcore:** Booking blocked + reputation-hit für versuch

---

## 14. Flugschule

### 14.1 Konzept

Flight-schools sind NPCs (oder later: player-betrieben) an specific airports. Pilot bezahlt für stunden, fliegt mit instructor (entweder NPC oder echter player), bekommt nach abschluss license-prüfung.

### 14.2 Schema

```prisma
model FlightSchool {
  id          String   @id @default(cuid())
  airportId   String
  airport     Airport  @relation(fields: [airportId], references: [id])
  name        String   // "Bristol Flight Center", "European Aviation Academy"
  rating      Float    @default(4.0)  // 1-5 stars (community-driven)
  
  // Welche licenses bietet sie an
  offers      LicenseType[]
  
  // Aircraft-fleet (training-aircraft)
  fleet       FlightSchoolAircraft[]
  
  // Pricing
  hourlyRateGround Decimal  // theory, sim
  hourlyRateAir    Decimal  // actual flying
}

model FlightSchoolEnrollment {
  id            String   @id @default(cuid())
  userId        String
  schoolId      String
  licenseType   LicenseType
  enrolledAt    DateTime @default(now())
  
  hoursTheory   Float    @default(0)
  hoursPractical Float   @default(0)
  hoursSim      Float    @default(0)
  
  status        EnrollmentStatus @default(IN_PROGRESS)
  examScheduledAt DateTime?
  examPassedAt    DateTime?
  examFailedAttempts Int  @default(0)
  
  totalCost     Decimal  @default(0)
}

enum EnrollmentStatus {
  IN_PROGRESS
  EXAM_SCHEDULED
  PASSED
  FAILED       // user gave up oder permanent fail
  WITHDRAWN    // user cancelled
}
```

### 14.3 License-Requirements

| License | Theory-Hours | Practical-Hours | Min Sim-Hours | Exam-Cost | Total Cost (typ.) |
|---|---|---|---|---|---|
| **PPL** | 100h | 45h flight | 5h sim | 1.500 VAM$ | 25.000 VAM$ |
| **Night Rating** | 5h | 5h | 0 | 500 | 5.000 |
| **IR** | 200h | 50h | 30h | 3.000 | 50.000 |
| **ME** | 30h | 15h | 5h | 1.500 | 20.000 |
| **CPL** | 200h | 100h cross-country | 20h | 5.000 | 80.000 |
| **MCC** | 25h | 0 | 20h sim | 2.500 | 15.000 |
| **ATPL** | 750h theory | 250h flight | 50h sim | 10.000 | 200.000 |
| **Type Rating (B738)** | 70h | 0 | 64h sim + 6 base-flights | 5.000 | 80.000 |

Flight-hours können gesammelt werden durch tatsächliches fliegen (PIREPs während enrollment counts), oder gepaid durch flight-school (instructor-flights).

### 14.4 Exam-Mechanik

**Theory-Exam:** Multiple-choice quiz im UI, 80% pass-mark. Frages aus echtem aviation-knowledge (regulations, weather, aerodynamics, systems).

**Practical-Exam:** Specific PIREP-route mit specific maneuvers (z.B. "PPL exam: KSGT - touch-and-go - LFKB - VOR-approach - back to KSGT"). PIREP wird gegen criteria gecheckt:
- Landing-rate within parameter
- Altitude-deviation under 100ft on approach
- Heading-deviation under 5° on cruise
- Touchdown-zone hit
- Communication (if VATSIM)

Pass criteria are configurable, harder for higher licenses.

**Failed exam:** Pay 50% retry-fee, wait 7 days IRL, retry. After 3 fails, mandatory 20h additional training.

### 14.5 Scholarship-Programs

Kostenfreie schools für anfänger (system-funded, limited slots monthly). VAs können scholarships sponsern für recruiting (zahlt training, pilot verpflichtet sich zu X jahren).

---

## 15. Rank-Progression

### 15.1 Rank-Hierarchy (configurable per airline)

Default-template:

| Rank | Hours-Min | Required-Licenses | Flying |
|---|---|---|---|
| Trainee | 0 | SPL | Sim only |
| Cadet | 30 | PPL | Single-engine, day |
| Junior FO | 200 | CPL + IR | Right-seat narrow-body |
| First Officer | 500 | CPL + IR + ME | Right-seat narrow-body |
| Senior FO | 2.000 | CPL + IR + ME + MCC | Right-seat any |
| Captain | 5.000 | ATPL | Left-seat narrow-body |
| Senior Captain | 10.000 | ATPL + 2 type-ratings | Left-seat any |
| Training Captain | 12.000 | + TRI | + can train others |
| Chief Pilot | 15.000 + admin-promote | + TRE | + chief decisions |

Each airline can customize ranks (different names, different requirements).

### 15.2 Auto-Promotion vs Manual

**Auto-Promotion:** When pilot meets all requirements, auto-promoted. Notification + cosmetic-change (rank-stripe in profile).

**Manual-Promotion:** Airline-admin must approve. For enterprise-VAs that want check-ride before promotion.

Settings per airline.

### 15.3 Demotion

- Rare, but possible
- Triggers: prolonged inactivity, repeated incidents, license expiration
- Always requires admin-action (no auto-demotion)

### 15.4 Salary-Bumps per Rank

Salary-formula:
```
hourly_rate = base_rate[rank] * type_multiplier * seniority_years_multiplier * airline_pay_scale
```

Real-world-research-based defaults (in VAM$, scaled):
- Trainee: 0 (no pay during training)
- Cadet: 25 VAM$/hour
- Junior FO: 50
- FO: 92 (matches Delta junior FO real-rate)
- Senior FO: 130
- Captain: 200
- Senior Captain (wide-body): 330 (matches Delta captain wide-body)
- Training Captain: 380
- Chief Pilot: 450

---

## 16. Type-Ratings

### 16.1 ICAO Type-Rating Groups

ICAO doc 8643 — aircraft are grouped, one rating covers a family:
- **A320 Family** (A318/A319/A320/A321 all variants)
- **A330 Family**
- **A350 Family** (A350-900, A350-1000)
- **B737 Family** (737NG, but 737MAX is separate IRL)
- **B747 Family**
- **B777 Family**
- **CRJ Family** (CRJ-200/700/900/1000)
- **C172** (single-pilot, no rating needed)
- etc.

### 16.2 Currency-Rules (für hardcore-mode)

Real-world: pilot must have 3 takeoffs + landings in last 90 days on type to remain current. If lapsed: re-currency-training needed (5h sim, ~5.000 VAM$).

In hardcore-mode: enforced. Can't book aircraft if not current.
In realistic-mode: warning shown, no block.
In standard-mode: ignored.

### 16.3 Type-Rating-Cost

| Aircraft-Class | Initial-Type-Rating-Cost |
|---|---|
| GA single-engine | 5.000 VAM$ |
| GA twin-engine | 12.000 |
| Regional turboprop (Q400, ATR) | 30.000 |
| Regional jet (CRJ, E-Jet) | 50.000 |
| Narrow-body (A320, B738) | 80.000 |
| Wide-body (A330, B777) | 150.000 |
| Mega-airliner (A380, B748) | 250.000 |

Recurrent-training every 12 months: 30% des initial-cost.

### 16.4 Sponsorship

VA can sponsor type-rating für recruited pilot, in exchange for X-jahre commitment. If pilot leaves early, must repay pro-rated.

---

## 17. Pilot-Reputation

### 17.1 Composite Score (0-100)

```typescript
reputation = 
  0.30 * landing_rate_quality
  + 0.20 * on_time_percentage
  + 0.15 * fuel_efficiency
  + 0.15 * passenger_satisfaction
  + 0.10 * safety_record  // bonuses for incident-free streaks
  + 0.10 * hours_quality_modifier  // experienced pilots stable
```

### 17.2 Sub-Metrics

**Landing-Rate-Quality:**
- Best: -200 to -100 fpm (smooth)
- Good: -100 to -50 fpm
- Acceptable: -300 to -200 fpm
- Hard: > -300 fpm
- Crash: > -600 fpm (major reputation-hit + incident-investigation)

**On-Time-Percentage:**
- Block-time vs scheduled-time
- < 15 min = on-time
- 15-30 min = delayed (minor)
- > 30 min = significantly delayed
- Cancelled = worst

**Fuel-Efficiency:**
- Compare actual fuel vs SimBrief-planned
- > 110% = wasteful
- 90-110% = normal
- < 90% = efficient

**Passenger-Satisfaction:**
- Calculated from: smooth-flight, on-time, no-divert, catering-class
- Random ±10% variance (passengers are unpredictable)

**Safety-Record:**
- Days since last incident
- Streak-bonuses at 90/365/1000 days

### 17.3 Reputation-Impact

| Score | Effect |
|---|---|
| 90-100 | "Top Pilot" badge, insurance -20%, salary +15%, eligible for rare type-ratings |
| 75-89 | "Reliable Pilot", normal terms |
| 60-74 | "Average Pilot", normal terms |
| 40-59 | Insurance +30%, salary -10%, no promotion-eligibility |
| < 40 | Insurance +100%, mandatory retraining, possible suspension |

---

## 18. Achievements & Badges

### 18.1 Hours-Milestones

- 10 hours, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000

### 18.2 Landings-Milestones

- 10, 50, 100, 500, 1000, 5000

### 18.3 Special-Achievements

| Badge | Requirement |
|---|---|
| **Continent-Conqueror EU** | Land at every airport with `scheduledService=true` in Europe |
| **Hard-Airport Master** | Land at all 10 famous "hard" airports (LSGS, EGLC, TGPY, VNLK, MMSD, KCYS, MHTG, PAKT, PALA, SBSP) |
| **Type-Rating-Collector** | Hold 5+ active type-ratings |
| **Atlantic-Crosser** | 100 transatlantic flights |
| **Pacific-Crosser** | 50 transpacific flights |
| **Round-the-World** | Visit all 6 continents in 30 days |
| **Night-Owl** | 100 night-flights |
| **Iron-Pilot** | 30 days streak with daily flight |
| **Smooth-Operator** | 100 landings under -100 fpm |
| **Cargo-Tycoon** | 10.000 tons cargo carried |
| **Frequent-Flyer-Magnet** | 10.000 passengers carried |
| **VATSIM-Ace** | 1000 hours on VATSIM |
| **IVAO-Ace** | 1000 hours on IVAO |
| **First-Off-the-Block** | 100 inaugural-flights |
| **Charity-Champion** | 10 charity-flights flown |
| **Streamer-Star** | 1000 viewers across stream-flights |

### 18.4 Hidden/Easter-Egg-Achievements

- "Friday-13th-Pilot" — fly on every Friday-the-13th
- "December-25-Santa" — Christmas-day-flight in red livery
- "Birthday-Flight" — fly on your real-birthday
- "404-Not-Found" — divert to 4 different alternates in one month
- "Wright-Brothers-Tribute" — fly KFFA on Dec 17

### 18.5 Display

Profile-page shows badges as collectible-cards. Sortable by rarity. Public-facing.

---

## 19. Recurrent-Training

### 19.1 Mandatory-Cycle

- Type-rating recurrent: every 12 months
- License-medical: every 6-12 months je nach license
- Crew-resource-management (CRM): every 24 months
- Emergency-procedures: every 6 months

### 19.2 Training-Cost

5-30% des initial-cost je nach training-type.

### 19.3 Failure-Consequences

- Hardcore-mode: license/rating-suspension, can't fly until current
- Realistic-mode: warning + reputation-hit, can fly with degraded-status
- Standard-mode: warning only, no block

---

# TEIL IV — BÖRSE & FINANZMÄRKTE

## 20. VAM Stock Exchange (VAMSE)

### 20.1 Konzept

Airlines können public gehen (IPO). Pilots (und andere airlines) können shares kaufen/verkaufen. Aktienkurs basiert auf airline-performance-metriken.

### 20.2 Listing-Anforderungen

Airline darf nur listed werden wenn:
- Mindestens 1 jahr aktiv (anti-pump-and-dump)
- Mindestens 5 active pilots
- Mindestens 100 PIREPs total
- Positive net-income last 30 days
- Mindestens 1M VAM$ in operating-wallet (substance-test)

### 20.3 IPO-Mechanik

```
1. Airline declares IPO intent
2. Roadshow-period (7 days IRL): admin-airline writes prospectus, sets target-price
3. Subscription-period: pilots can pre-order shares at IPO-price
4. If oversubscribed: pro-rated allocation
5. If undersubscribed: IPO cancelled, refund
6. Listing-day: trading begins, real-time-price discovery
```

### 20.4 Stock-Price-Calculation

Daily-close price recalc basierend auf:
```
fundamental_value = revenue_30d * P/E_multiple
                  + assets_value
                  - liabilities

market_adjustment = active_pilots_growth_rate * 0.10
                  + reputation_score * 0.05
                  + sentiment_modifier  // recent news/events

price = (fundamental_value * 0.7) + (last_close * 0.2) + (market_adjustment * 0.1)
        ± random_walk(2%)  // simulates daily volatility
```

Real-time-price during trading-hours influenced by buy/sell-pressure.

### 20.5 Schema

```prisma
model AirlineListing {
  id              String   @id @default(cuid())
  airlineId       String   @unique
  ticker          String   @unique  // "DLH", "BAW", "AFR"
  ipoDate         DateTime
  ipoPrice        Decimal
  totalShares     BigInt
  publicFloat     BigInt   // shares not held by airline-treasury
  currentPrice    Decimal
  lastUpdated     DateTime
}

model ShareHolding {
  id           String   @id @default(cuid())
  ownerType    WalletOwnerType  // USER | AIRLINE
  ownerId      String
  ticker       String
  shares       BigInt
  avgCostBasis Decimal  // for P&L tracking
}

model StockOrder {
  id           String      @id @default(cuid())
  ownerType    WalletOwnerType
  ownerId      String
  ticker       String
  orderType    StockOrderType  // MARKET | LIMIT | STOP_LOSS
  side         OrderSide       // BUY | SELL
  shares       BigInt
  limitPrice   Decimal?
  status       OrderStatus     // OPEN | FILLED | PARTIAL | CANCELLED | EXPIRED
  filledShares BigInt          @default(0)
  avgFillPrice Decimal?
  createdAt    DateTime        @default(now())
  expiresAt    DateTime?
}
```

---

## 21. Trading-Mechaniken

### 21.1 Order-Types

EVE-inspired:
- **Market Order:** Buy/sell immediate at best available price
- **Limit Order:** Specify max-buy-price oder min-sell-price
- **Stop-Loss:** Auto-sell when price drops below threshold
- **Take-Profit:** Auto-sell when price reaches target
- **Iceberg:** Large order shown in chunks (avoid moving market)

### 21.2 Trading-Hours

VAMSE follows real-world-style hours:
- Open: Mon-Fri 09:00-17:30 UTC
- Pre-market: 07:00-09:00 (limited liquidity)
- After-hours: 17:30-19:00 (limited)
- Closed: weekends + holidays

Outside trading-hours: orders queue but don't execute.

### 21.3 Broker-Fees

EVE-style:
- Standard rate: 2.5% per transaction
- Reduced via "Trading Skill" (career-feature, max 0.5%)
- VIP-account-tier: 1% (premium-subscribers)

Fees go to SYSTEM wallet (sink, helps inflation-control).

### 21.4 Daily-Trading-Limits

To prevent market-manipulation:
- Max 10% of daily-volume per pilot per stock
- Max 50% of stock-float can be traded by one wallet
- Wash-trading (buy from yourself) blocked

### 21.5 Trading-UI

```
┌──────────────────────────────────────────────────────────┐
│ DLH — Lufthansa Virtual                                  │
│ Last: 142.50 ▲ 2.30 (+1.65%)                            │
│ Vol: 25.4K  Avg-30d: 138.20                             │
├──────────────────────────────────────────────────────────┤
│ [Chart: 1D | 1W | 1M | 3M | 1Y | All]                   │
│                                                          │
│ ┌── Buy ────────┐  ┌── Sell ───────┐                    │
│ │ Shares: ____  │  │ Shares: ____  │                    │
│ │ Type: Market │  │ Type: Market │                    │
│ │ Est: ___ VAM$│  │ Est: ___ VAM$│                    │
│ │ [BUY]        │  │ [SELL]       │                    │
│ └──────────────┘  └──────────────┘                    │
│                                                          │
│ Order Book:                                              │
│  Sell  142.80  500                                      │
│  Sell  142.60  1200                                     │
│  Sell  142.55  300                                      │
│  ────────────────                                       │
│  Buy   142.45  800                                      │
│  Buy   142.40  1500                                     │
│  Buy   142.35  600                                      │
└──────────────────────────────────────────────────────────┘
```

---

## 22. Bonds & Loans

### 22.1 Pilot-Loans

For aircraft-purchase oder license-training:
- Unsecured: max 5× monthly-salary
- Secured (aircraft as collateral): up to 80% of aircraft-value
- Term: 12-60 months
- Interest: based on credit-score (5-25% APR)

### 22.2 Airline-Bonds

Airline issues bonds for expansion:
- Fixed-coupon: e.g., 5% annual interest
- Maturity: 1, 5, or 10 years
- Bullet-payment vs amortized
- Pilots/airlines can buy

### 22.3 Bond-Rating

S&P-style:
- AAA: established airlines, lowest interest required to attract buyers
- AA, A, BBB: investment-grade
- BB, B: speculative
- CCC, CC, C: junk
- D: defaulted

Rating-agency = system-NPC, factors:
- Revenue-stability
- Debt-to-equity ratio
- Hub-diversity
- Pilot-retention

### 22.4 Default-Mechanik

If airline can't make bond-payment:
1. Grace-period (30 days IRL)
2. Restructuring-attempt (negotiate with bondholders)
3. Default → bondholders get partial recovery (asset-liquidation)
4. Airline-bankruptcy possible (chapter-11-style reorganization)

---

## 23. Commodities-Markt

### 23.1 Fuel-Futures

Hedge against fuel-price-volatility:
- Buy futures-contract: lock-in fuel-price for X tons at airport Y, deliverable Z months
- If real-price > futures-price at delivery: profit
- Otherwise: loss

### 23.2 Aircraft-Lease-Forwards

Lock-in lease-rate for future aircraft delivery:
- Useful when expanding fleet, want price-certainty
- Counterparty: lessor-airline or system-NPC

### 23.3 Maintenance-Slot-Futures

C-Check + D-Check require booking maintenance-slots months in advance. Slot-futures allow pre-booking with price-lock.

---

## 24. Insider-Trading-Rules

### 24.1 Rule-Set

Airline-admins (and pilots with high-rank) have material non-public information about their airline. Trading on this is unfair.

**Restricted-window rule:**
- Insiders can only trade their own airline's stock during specific 7-day windows after quarterly-reports
- Outside window: blocked
- Violation: profits seized + reputation-damage + temp-suspension

### 24.2 Detection

Auto-detection:
- Pattern: large pre-announcement trades followed by big news
- Cross-reference: trader's airline-affiliation
- System flags suspicious activity for admin-review

### 24.3 SEC-Equivalent (System-Admin)

Disputes go to system-admin who acts as regulator. Sanctions:
- Profit-disgorgement
- Trading-suspension
- Public-shaming (on-record)
- Severe: lifetime trading-ban

---

# TEIL V — TWITCH & STREAMER-INTEGRATION

## 25. Account-Linking & EventSub

### 25.1 OAuth-Flow

Same pattern as existing VATSIM/IVAO:
- `User.twitchUserId Int? @unique`
- `User.twitchAccessToken String? @db.Text`
- `User.twitchRefreshToken String? @db.Text`
- `User.twitchTokenExpiresAt DateTime?`
- `User.twitchUsername String?`

OAuth-callback at `/api/auth/twitch/callback`.

Required scopes:
- `channel:read:redemptions` (channel-points)
- `channel:read:subscriptions` (subs)
- `bits:read` (bits)
- `channel:read:hype_train` (hype-trains)
- `user:read:email` (account-link verify)

### 25.2 EventSub-Subscriptions

When pilot connects twitch:
1. Subscribe to channel-events via EventSub WebSocket
2. Subscribe-types:
   - `channel.channel_points_custom_reward_redemption.add` — viewer redeem channel-points
   - `channel.subscribe` — new sub
   - `channel.subscription.gift` — gifted sub
   - `channel.subscription.message` — resub with message
   - `channel.cheer` — bits cheer
   - `channel.hype_train.begin/progress/end` — hype-train events
   - `stream.online` — pilot started stream
   - `stream.offline` — pilot ended stream

### 25.3 Real-time-Bridge

```
Twitch Server
   │ WebSocket EventSub
   ▼
VAM-System Background-Service
   │ (transforms event → economy-action)
   ▼
Database transaction
   │ + revalidate path
   ▼
Pilot's overlay/UI updates real-time
```

---

## 26. Channel-Points → Tickets

### 26.1 Custom-Rewards

Pilot creates custom-rewards on their Twitch-channel via VAM-system UI:
- "Buy Economy Ticket on Next Flight" — 5.000 channel-points
- "Buy Business Ticket" — 25.000 channel-points
- "Buy First-Class Ticket" — 100.000 channel-points
- "VIP-Charter Seat" — 250.000 channel-points (rare)

VAM creates these via Twitch API automatically when pilot enables feature.

### 26.2 Redemption-Flow

```
1. Viewer redeems "Buy Economy Ticket"
2. Twitch EventSub fires
3. VAM checks: pilot has active flight? 
   - YES → add ticket to flight-passenger-list, log revenue
   - NO  → queue for next flight, notify viewer
4. Stream-overlay updates: "@viewer123 boarded! +50 VAM$"
5. After flight: revenue-transaction filed in pilot-wallet
```

### 26.3 Revenue-Calc per Ticket

```
ticket_revenue = base_class_fare * twitch_multiplier
twitch_multiplier = 1.0  // Default — 1 channel-point ticket = 1 normal economy seat
```

Configurable per pilot. Some prefer twitch-tickets pay more (incentive viewers), some less (anti-inflation).

### 26.4 Pilot/Airline-Split

Configurable in pilot-settings:
- Default: 50/50 split pilot ↔ airline
- Can override: 100% to pilot (free-flight mode), 80/20 (airline-favor), etc.
- Airline-admin can set minimum split

---

## 27. Subscriptions → VIP-Sitze

### 27.1 Sub-Tier-Mapping

| Sub-Type | Auto-Action | Revenue |
|---|---|---|
| **Tier 1** ($4.99) | Economy-seat | 50 VAM$ |
| **Tier 2** ($9.99) | Business-seat | 200 VAM$ |
| **Tier 3** ($24.99) | First-class-seat | 800 VAM$ |
| **Gifted Sub** | Same as recipient-tier, both get badges | normal |
| **Resub (e.g. 12-month)** | Bonus VIP-charter-credit | +500 VAM$ |
| **Prime Sub** | Same as Tier 1 | 50 VAM$ |

### 27.2 VIP-Passenger-List

Subs are flagged as "VIPs" in passenger-manifest:
- Display in stream-overlay with crown-emoji
- Special-passenger-handling notification
- Pilot can give shoutouts in stream

### 27.3 Long-time-Sub-Recognition

Resub at 6/12/24/60 months:
- "Loyalty-Charter" event
- Special badge on VAM-profile (visible to all)
- Sub gets named-aircraft (their twitch-name in fleet for 1 month)

---

## 28. Bits → Cargo

### 28.1 Mapping

```
1 bit = 1 kg cargo
100 bits → 100 kg
1000 bits → 1 ton
10000 bits → 10 tons (significant cargo!)
```

### 28.2 Big-Cheer-Events

Special handling for large cheers:
- 10.000+ bits → "Celebrity-Charter" event triggered
  - Special PIREP-flag
  - Bonus revenue
  - Featured on system-news-feed
- 50.000+ bits → "Mega-Charter" event
  - Press-release-style notification to all VAs
  - 5× revenue-multiplier on this flight
  - Achievement unlock for both pilot and viewer

---

## 29. Hype-Train-Multiplier

### 29.1 Mechanik

When viewer's twitch-channel triggers hype-train:
- Level 1: +10% revenue on current+next flight
- Level 2: +20%
- Level 3: +35%
- Level 4: +50%
- Level 5: +75%
- "Golden Kappa": +100% (rare)

### 29.2 Flight-PIREP-Tag

Flight during hype-train gets special "Hype-Train-Flight" badge in PIREP-history. Visible on profile.

### 29.3 Leaderboard

Monthly leaderboard: "Most Hype-Train Flights". Streamer-only. Cosmetic prize.

---

## 30. Stream-Overlay-Integration

### 30.1 Browser-Source

OBS browser-source URL: `https://vam.kevindrack.de/overlay/{pilot-id}/stream`

Shows real-time:
- Aircraft-position-map
- Current-passenger-list (twitch-names with badges)
- Ticket-counter ("47 tickets sold")
- Sub-goal-progress
- Hype-train-status
- Live-revenue-counter
- Aircraft-status (altitude, speed, fuel)
- Estimated-arrival
- Stream-uptime
- Top-supporters-list (most channel-points donated this stream)

### 30.2 Customization

Pilot can choose:
- Layout (top-bar, bottom-bar, sidebar, full-overlay)
- Colors (airline-livery-matching)
- Visible-modules (toggle each)
- Animations on/off
- Audio-cues for events

### 30.3 OBS-Integration

Beyond browser-source:
- WebSocket-API für scene-switching (future)
- Event-triggered actions (e.g., "play sound on landing")
- Twitch-chat-bot integration (commands like `!flight`, `!eta`)

---

## 31. Multi-Streamer-Events

### 31.1 Co-Pilot-Streams

Two streamers fly same flight (one captain, one FO):
- Both PIREPs link
- Combined viewership
- Revenue-split 50/50
- Special "Co-Stream" badge

### 31.2 Multi-Stream Race-Events

3-5 streamers race route X to Y:
- All viewers can switch between streams via official multi-view
- Winner gets: $cash-prize (sponsor), reputation-bonus, achievement
- Total viewer-engagement counts toward leaderboard

### 31.3 Group-Tour-Events

10+ streamers fly formation-flight (e.g., commemorative event):
- Coordinated take-off
- Cross-stream features
- Combined-viewership-boost-event for all
- Special group-achievement

---

## 32. Charity-Flights

### 32.1 Konzept

Pilot designates flight as "charity-flight":
- All revenue (twitch-tickets + sub-revenue) goes to real-world-charity
- VAM-system tracks donation
- Viewers can directly donate via integrated stripe/twitch-bits
- Charity-flag visible on flight-page + leaderboard

### 32.2 Verified-Charities

Pre-approved charity-list (e.g., Red Cross, MSF, animal-charities). System-admin curated.

### 32.3 Recognition

- "Charity Champion" badge after 10 charity-flights
- Annual "Most-Donated" leaderboard
- Annual community-recognition event

---

## 33. Non-Streamer-Fairness

### 33.1 Anti-Pay-to-Win-Prinzip

Streaming gives **engagement/community-bonus**, not absolute-numbers:
- Twitch-tickets are part of normal load-factor (% of seats), not on top
- Streaming-bonus capped at +30% revenue (not 10×)
- Solo-pilot earnings competitive with streamer earnings at same activity-level

### 33.2 Separate Leaderboards

Two leaderboards:
- **Solo-Pilot-Leaderboard** (no twitch-multiplier counted)
- **Streamer-Leaderboard** (twitch-events counted)

Both equally prominent. Achievements can be earned in either.

### 33.3 No Twitch-Only Achievements

Every twitch-achievement has a non-twitch equivalent:
- "Streamer-Star" (1000 viewers) ↔ "Community-Star" (1000 PIREPs)
- "Hype-Train-Master" ↔ "Reliability-Master" (100% on-time month)

### 33.4 Opt-Out für Streamer-Visibility

Solo-pilots can hide streamer-content from feeds if it bothers them:
- Settings: "Hide twitch-related events from feed"
- Settings: "Don't show streamer-leaderboards"

---

## 34. YouTube/Kick-Equivalents

### 34.1 YouTube Live

Equivalent mappings:
- SuperChats → channel-point-equivalent
- Memberships → sub-equivalent
- Members-Only premieres → exclusive-flight-events

### 34.2 Kick

Kick-API integration when stable:
- Subscribers → VIP-seats
- Predictions → flight-betting (in-game money only)

### 34.3 Future: Generic-Streaming-API

Abstraction-layer so adding new platforms is plugin-style:
```typescript
interface StreamingPlatformProvider {
  authUrl(): string;
  onEvent(eventType: string, callback: (event) => void);
  // Standard event-types: SUBSCRIPTION, DONATION, REWARD_REDEMPTION, ...
}
```

---

# TEIL VI — CARGO & PASSENGER-DEPTH

## 35. Cargo-Types

### 35.1 Categories

```prisma
enum CargoType {
  GENERAL          // Standard boxes, packages
  PERISHABLE       // Refrigerated (food, flowers, pharma)
  HAZARDOUS        // DGR-rules apply, special handling-fee
  LIVE_ANIMALS     // Special crates, limited routes
  MAIL             // Postal contracts
  HEAVY_MACHINERY  // Industrial equipment
  VEHICLES         // Auto-shipping
  HUMAN_REMAINS    // Special handling, respect-tag
  VALUABLES        // Gold, art — armed-escort optional
  WEAPONS          // Government-only contracts, restricted
  AID_SUPPLIES     // Disaster-relief — bonus reputation
}
```

### 35.2 Per-Type-Constraints

| Type | Aircraft-Required | Special-Handling |
|---|---|---|
| GENERAL | Any | None |
| PERISHABLE | Refrigerated cargo-hold (most modern aircraft) | Time-limit (delay → spoilage → revenue-loss) |
| HAZARDOUS | DGR-cert pilot + airline | +50% handling-fee, restricted routes |
| LIVE_ANIMALS | Pressurized hold | Limited stops, special documentation |
| MAIL | Any | Government-rate-card |
| WEAPONS | Specific approval | Government-only |

---

## 36. Cargo-Contracts

### 36.1 Contract-Types

```prisma
enum CargoContractType {
  SPOT          // One-time, immediate
  RECURRING     // Daily/weekly/monthly route X→Y
  LONG_TERM     // 12-month commitment, volume-discount
  GOVERNMENT    // Postal/military, fixed-rate
  CHARTER       // Ad-hoc, premium-rate
}

model CargoContract {
  id            String   @id @default(cuid())
  airlineId     String
  customerName  String   // "DHL", "Amazon", "US Postal", etc.
  type          CargoContractType
  routeId       String?  // Or flexible route
  cargoType     CargoType
  weightKg      Int
  ratePerKg     Decimal
  startsAt      DateTime
  endsAt        DateTime?
  status        ContractStatus
  createdAt     DateTime @default(now())
}
```

### 36.2 Marketplace

`/cargo/marketplace` — list of available contracts:
- Filterable by type, route, value
- Bid-system für large-contracts
- Random-NPC-customers generate spot-contracts daily

### 36.3 SLA & Penalties

Contracts have on-time-requirements:
- Late delivery → reduced payment
- Major delay → contract-breach-fee
- Repeated breaches → contract-cancellation, customer-blacklist

---

## 37. Passenger-Classes & Load-Factor

### 37.1 Load-Factor-Formel

```
load_factor = base_load_factor (62%)
            + day_of_week_modifier (-10% to +10%)
            + season_modifier (-15% to +20%)
            + route_popularity_modifier (-30% to +30%)
            + marketing_modifier (0% to +15%, depending on spend)
            + pilot_reputation_modifier (-5% to +10%)
            + airline_reputation_modifier (-10% to +15%)
            + random_variance (-10% to +10%)

clamped to [10%, 95%]
```

### 37.2 Class-Mix per Aircraft

Configurable per aircraft (different liveries can have different layouts):
- A320 standard: 12 business + 138 economy = 150 total
- A320 high-density: 0 business + 180 economy = 180
- A350 wide-body: 8 first + 32 business + 32 premium-eco + 252 economy = 324

### 37.3 Class-Demand-Differential

Different classes have different load-factors:
- Economy: 62% default, scales with route
- Premium-Eco: 55%, more sensitive to route-popularity
- Business: 45%, business-route-skewed
- First: 30%, only popular on premium-routes

---

## 38. Catering-System

### 38.1 Catering-Tiers

| Tier | Cost-per-Pax | Satisfaction-Boost |
|---|---|---|
| **None** | 0 | -5% |
| **Snack** | 2 VAM$ | 0% |
| **Cold-Meal** | 8 VAM$ | +3% |
| **Hot-Meal** | 15 VAM$ | +6% |
| **Full-Service (multi-course)** | 35 VAM$ | +10% |
| **Premium (champagne, lobster)** | 80 VAM$ | +15% |

Per-class differentiation:
- Economy usually snack/cold-meal
- Business usually hot-meal/full-service
- First always premium

### 38.2 Special-Diets

- Vegetarian, vegan, halal, kosher, gluten-free options available
- Cost +20% per special-meal
- Reputation-bonus for offering all options

### 38.3 Wine/Beverage-Service

- Premium-economy/business/first include wine-service
- Wine-quality affects satisfaction
- "Sommelier-airline" badge for top-rated

---

## 39. Special-Mission-Types

### 39.1 Medevac

- Emergency medical transport
- Time-pressure (revenue scales with time-saved)
- Specific airports = hospitals
- Reputation-bonus für saved-lives

### 39.2 Search-and-Rescue

- Government-funded
- Search-pattern-flying (specific waypoints)
- Find-bonus for "located" objective (random-success)

### 39.3 Firefighting

- Seasonal (sommer northern-hemisphere)
- Specific aircraft (water-bombers: CL-415, B747-supertanker, etc.)
- Per-tank-drop revenue
- Hazard-pay-bonus

### 39.4 Aerial Photography

- Specific routes flying over photogenic areas
- Per-mission-fee
- Combine with sightseeing

### 39.5 Skydiving-Operations

- Repeat short flights to drop-altitude
- Per-jumper-fee
- GA-aircraft only (Cessna Caravan typical)

### 39.6 Banner-Towing

- Slow-flight at low-altitude
- Specific events (sports-games, beaches)
- Niche but fun

### 39.7 Crop-Dusting

- Agricultural areas
- Low-altitude precision-flying
- Seasonal

---

# TEIL VII — MULTI-AIRLINE-MECHANIKEN

## 40. Alliances

### 40.1 Alliance-Concept

Real-world alliances (Star Alliance, Oneworld, SkyTeam) — fictional VA-equivalents:

```prisma
model Alliance {
  id          String   @id @default(cuid())
  name        String   @unique  // "VAM Star Alliance"
  logo        String?
  founded     DateTime
  members     AllianceMembership[]
}

model AllianceMembership {
  airlineId   String
  allianceId  String
  joinedAt    DateTime @default(now())
  role        AllianceRole  // FOUNDING | FULL | ASSOCIATE
}
```

### 40.2 Alliance-Benefits

- Codeshare-flights (sell each other's seats)
- Frequent-flyer-program-cross-recognition
- Lounge-access at all member-hubs
- Coordinated-routes (avoid overlap)
- Shared-purchasing (bulk-aircraft-orders for discount)

### 40.3 Alliance-Governance

- Member-vote-system for decisions
- Annual alliance-fee
- Code-of-conduct enforcement
- Expulsion-mechanism

---

## 41. M&A-Mechaniken

### 41.1 Acquisition-Types

- **Friendly Acquisition:** Target airline-CEO agrees, board-vote
- **Hostile Takeover:** Buy controlling-share without consent
- **Merger of Equals:** Two airlines combine, new entity formed

### 41.2 Mechanik

```
1. Acquirer announces tender-offer at premium-price (e.g., +30% over current)
2. Target-shareholders vote: accept oder reject
3. If majority accepts → acquisition completes
4. Target dissolves (or becomes subsidiary)
5. Pilots transfer to new entity
6. Routes/aircraft consolidated
```

### 41.3 Anti-Trust

System-admin (regulator) can block mergers:
- Excessive market-concentration
- Hub-monopoly creation
- Anti-competitive practices

### 41.4 Pilot-Rights in M&A

- Severance-package option (leave with cash)
- Stay-bonus for retention
- Seniority-merge-rules (configurable)

---

## 42. Subsidiaries

### 42.1 Hub-and-Spoke + Subsidiary-Model

Real-world pattern (DLH + Eurowings + Brussels Airlines):
- Mainline (DLH) operates wide-body international
- Regional-subsidiary (Eurowings) operates short-haul + low-cost
- Pilots can move between airlines within group

### 42.2 Schema

```prisma
model Airline {
  // ... existing
  parentAirlineId  String?
  parentAirline    Airline? @relation("Subsidiary", fields: [parentAirlineId], references: [id])
  subsidiaries     Airline[] @relation("Subsidiary")
}
```

### 42.3 Cross-Airline-Operations

- Pilots can fly for any airline in group
- Aircraft can be transferred between subsidiaries
- Revenue can flow up to parent
- Combined consolidated-financials

---

## 43. Codeshare-System

### 43.1 Konzept

Airline X sells seat on airline Y's flight under X's flight-number.

### 43.2 Schema

```prisma
model CodeshareAgreement {
  id              String   @id @default(cuid())
  marketingAirlineId String  // "Sells the ticket"
  operatingAirlineId String  // "Operates the flight"
  routeId         String   // Specific route covered
  marketingFlightNumber String  // X's flight-number
  revenueShare    Decimal  // % to marketing airline
  startsAt        DateTime
  endsAt          DateTime?
}
```

### 43.3 Ticket-Display

Passenger sees flight-number from marketing-airline, but actual aircraft + crew is operating-airline. Common in alliances.

---

# TEIL VIII — EVENTS & SEASONAL

## 44. Real-World-Event-Mirror

### 44.1 Konzept

System-events synchronize with real-world-aviation-events:
- Holiday-rushes → real christmas/easter/thanksgiving
- Olympics-host-city → boost route-popularity
- World-cup-host → boost
- Hajj-period → KSA-routes massive-volume
- Major-conferences (CES, MWC) → city-specific boost

### 44.2 Implementation

Background-job pulls from real-world-event-API (custom curated):
- Updates `route_popularity_modifier` for affected airports
- Notifies pilots ("Event in your hub: World Cup → expect 30% load-factor boost")
- Bonus-objectives ("Fly 10 flights to host-city → bonus")

### 44.3 Real-World Fuel-Index

Optional toggle: VAM-fuel-prices follow real-world jet-fuel-index (with delay):
- Pulls from public commodity-data
- Smoothed over 7-days (avoid daily-shock)
- Adds realism for hardcore-pilots

---

## 45. In-System-Events

### 45.1 Founder's-Day

Each airline gets annual founder's-day:
- Free-flight-day for all members
- 2× revenue-multiplier
- Special PIREP-badge

### 45.2 Inaugural-Flight

When airline opens new route:
- "Inaugural Flight" event
- First pilot to fly = special-badge
- Press-release-style notification system-wide
- 3× revenue-multiplier on first flight

### 45.3 Aircraft-Retirement-Tour

When aircraft type is "retired" from airline-fleet:
- Last 5 flights are "retirement tour"
- Special PIREP-tags
- Memorial-photo-collection

### 45.4 Group-Flight-Mondays

System-event: every monday a different route is featured. All pilots flying it get bonus:
- 1.5× revenue
- Special PIREP-badge
- Combined-leaderboard for the day

---

## 46. Disaster-Events

### 46.1 Volcanic-Eruption

Inspired by Eyjafjallajökull 2010:
- Random rare event (system-admin-triggered)
- Affected-region: all flights cancelled for X days
- Insurance-claims-processing
- Re-routing opportunities for unaffected airlines

### 46.2 Pandemic-Event (Optional Opt-In Per Airline)

Sensitive — opt-in only for airlines who want this realism:
- 70% load-factor reduction
- Cargo-routes boost (medical supplies)
- Some airports closed for civilian
- Multi-month event

### 46.3 Fuel-Crisis

Random rare event (1-2× per year):
- Fuel-prices 200% for 1-2 weeks
- Fuel-hedge-contracts pay off
- Airline-financial-stress-test

### 46.4 Weather-Events

- Hurricane-season (Caribbean/Gulf): airports closed, divert-events
- Winter-storms (NA/EU): delays
- Fog-events (specific airports famous for): low-vis-approach challenges

### 46.5 ATC-Strike

- Specific country/region affected
- All flights in/out delayed/cancelled
- Real-world-mirror when actual strikes happen

### 46.6 Cyber-Attack

Rare event:
- Airline's systems "compromised"
- Reduced-operations for 48h
- Recovery-cost
- Reputation-hit

---

## 47. Live-Multi-Pilot-Events

### 47.1 Round-the-World Challenge

- Annual event
- 20 pilots, 20 days, fly around world
- Sponsor-prizes
- Stream-coverage

### 47.2 Berlin-Airlift-Recreation

- Historical-recreation event
- 100+ pilots fly cargo to EDDB over 24 hours
- Community-objective: deliver X tons
- Multi-stream coverage

### 47.3 Cargo-Olympics

- Quarterly competition
- Pilots compete in: most-tons-delivered, hardest-airport, etc.
- Multi-category winners

### 47.4 Formation-Flight Spectacles

- Pre-coordinated formation-flying
- Special airshow-events
- Multi-stream documentation

---

# TEIL IX — SOZIAL & GAMIFICATION

## 48. Crew-System

### 48.1 Cockpit-Crew

- Captain + First Officer
- Some flights require specific qualifications (long-haul = 2 captains rotating)
- Crew-rest-rules (max-duty-hours, mandatory-rest)

### 48.2 Cabin-Crew

- Per-aircraft-class minimum (regulations)
- Purser (lead), Senior-FAs, Junior-FAs
- Hire/fire/training as airline-asset
- Salaries

### 48.3 Crew-Pairing

- Multi-pilot-flight: shared-credits, shared-revenue
- Specific friendships ("regular crew")
- Crew-stability bonus (same crew = better-coordination)

### 48.4 Schema

```prisma
model CrewMember {
  id            String   @id @default(cuid())
  type          CrewMemberType  // PILOT | FA | DISPATCHER
  userId        String?  // If real player
  npcName       String?  // If NPC-crew
  airlineId     String
  rank          String
  hourlyRate    Decimal
  qualifications Json    // type-ratings, language, certifications
}

model FlightCrewAssignment {
  flightId     String  // PIREP or Booking
  crewMemberId String
  role         String  // "Captain" | "First Officer" | "Purser" | etc.
}
```

---

## 49. Daily-Quests & Streaks

### 49.1 Daily-Quest-Examples

- "Fly 1 flight today" → 100 VAM$
- "Land at 3 different airports" → 250
- "Achieve >85% on-time" → 500
- "Carry >100 passengers" → 200

### 49.2 Weekly-Challenges

- "Fly 10 hours" → 2.000
- "Visit 5 new airports" → unlock cosmetic
- "Cargo-volume 100 tons" → 3.000

### 49.3 Streaks

- Daily-flight-streak: bonus increases per day (1× → 1.1× → 1.2× ... up to 2× at 30 days)
- Weekly-perfect-landing-streak
- Monthly-on-time-streak

### 49.4 Streak-Protection

- "Streak Freeze" item: pause streak for 1 day (limited use)
- Real-life events shouldn't punish casual players

---

## 50. Seasonal-Pässe

### 50.1 Konzept

Battle-pass-style seasonal-progression:
- 3-month seasons
- Free-tier: cosmetic rewards (liveries, hangar-decorations)
- Premium-tier (optional real-money or VAM$): more cosmetics
- All gameplay-rewards in free-tier (no pay-to-win)

### 50.2 Progression

- XP earned from flights, missions, daily-quests
- 100 levels per season
- Each level = 1 reward

### 50.3 Theme

Each season has theme:
- "Winter Operations" (snow-related rewards)
- "Pacific Adventure" (Asia-Pacific routes)
- "Golden-Age Aviation" (vintage liveries)

---

## 51. Forums & Trip-Reports

### 51.1 Per-Airline-Forum

- Airline-internal discussion
- Members-only by default
- Moderated by airline-admin

### 51.2 Per-Route-Forum

- Discussion thread for each popular route
- Tips, tricks, weather-history, beautiful-photos
- Cross-airline

### 51.3 Aircraft-Type-Forums

- A320-family thread, B777-family, etc.
- Type-rating-tips
- Performance-discussions

### 51.4 Trip-Reports

- Auto-generated from PIREPs (with photos if uploaded)
- Edit + share publicly
- Featured-trip-reports on homepage

### 51.5 Photo-Galleries

- Per-flight photo-uploads
- Per-airport galleries
- Best-of-month curation

---

## 52. Pilot-Mentorship

### 52.1 Mentor-Mentee-System

- Senior-pilots (rank Captain+) can opt-in as mentors
- Junior-pilots can request mentor
- Mentor sees mentee's progress, offers guidance
- Mutual-benefits: mentor gets reputation-bonus, mentee gets faster-progression

### 52.2 Mentorship-Activities

- Joint-flights (mentor flies as instructor)
- Q&A messaging
- Goal-setting tracker
- Mentor's-corner-events (group-flights with multiple mentees)

### 52.3 Mentor-Recognition

- "Mentor of the Month" leaderboard
- Special badge
- Counts toward Training-Captain promotion

---

# TEIL X — UNIQUE FEATURES (NIEMAND HAT DAS)

## 53. USP-Catalog

Was VAM-System einzigartig macht — Features die KEIN anderes VA-Tool oder Career-Sim heute hat:

### 53.1 Bidirektionale Twitch-Integration

(Detailliert in `twitch-to-sim-integration.md`):
- Viewer redeem channel-points → triggers IN-SIM action (engine-failure, lights, etc.)
- VAM bridges twitch ↔ SimConnect
- Plus revenue-side (this doc): viewer buys ticket → revenue

**Niemand sonst hat write-direction.** Tools wie FlightSimTrack sind read-only.

### 53.2 Per-User Modular Opt-In

Jedes feature ist einzeln aktivierbar. Pilot definiert seine erfahrung. **Andere systems sind monolithisch on/off.**

### 53.3 Hub + Free-Flight Hybrid

Gleichzeitig hub-strict UND free-flight möglich. **Andere systems wählen eines.**

### 53.4 Stock-Market mit Airline-IPOs

Player-airlines können public gehen, shares getradet. **Niemand hat das.**

### 53.5 Real-World-Event-Mirror

Real fuel-prices, real airport-closures, real-pandemic-events automatisch in-game eingespiegelt. **Niemand hat das auf diesem level.**

### 53.6 Multi-Source-Position-Tracking

ACARS + VATSIM + IVAO + manual + jumpseat — system handhabt alle quellen mit precedence-rules. **Meiste haben nur eine.**

### 53.7 Multi-Streamer Co-Flights

Mehrere streamer fliegen gleichen flight, viewers können zwischen streams switchen. **Innovativ, niemand hat das.**

### 53.8 Charity-Flight-Mode

Real-world-donation-tie-in über stripe + verified-charities. **Niemand sonst hat das integriert.**

### 53.9 Anti-Cheat über Cross-Source-Validation

ACARS-position vs VATSIM-position cross-check. SimBrief-fuel vs actual-fuel-burn. **Selten in VA-systems.**

### 53.10 Pilot-License-Progression mit Echten Flugschule-Stunden

Akkumulierte sim-stunden + theory + practical-exams. **OnAir hat XP-perks aber keine echte license-simulation.**

### 53.11 Dynamic Inflation-Control

Sources/sinks-monitoring mit auto-events bei imbalance. **EVE Online hat das, kein VA-tool.**

### 53.12 Sustainable Aviation Fuel als Premium-Layer

Eco-friendly-operations bonus + carbon-credit-economy. **Real-world relevant, kein VA hat es.**

### 53.13 NFT-Style-Profile-Cards (ohne echte NFTs)

Sammelbare profile-cards mit pilot-stats, tradeable. **Innovativ, ohne crypto-stigma.**

### 53.14 Voice-Acted ATC-Bot für Non-VATSIM-Pilots

AI-generated voice-ATC für offline-pilots. **Sehr innovativ.**

### 53.15 Aircraft-Livery-Designer In-System

Browser-based livery-designer mit export to MSFS-paint-format. **Standalone-tools existieren, integriert nirgends.**

### 53.16 Sponsor-Deals

Real fictional sponsors zahlen für logo auf aircraft tail. Reputation-driven sponsorship. **Niemand hat sponsor-mechanics.**

### 53.17 Aircraft-Hijacking-Event

Rare dramatic event mit story-driven scenario. **Bold, niemand wagt das.**

### 53.18 Pilot-Property-Ownership

Kaufen sie ein house in EDDF — shows on profile. Lifestyle-feature. **Pure flavor, niemand hat es.**

### 53.19 Black-Market-Cargo

Illegal cargo wie smuggling — high reward, high risk (fines if caught). **Edgy, gameplay-deep.**

### 53.20 Airline-CEO-Roleplay

Player-CEO of airline, board-of-directors-system, shareholder-meetings, IPO-roadshow. **Ultimate roleplay-depth.**

### 53.21 Recurrent-Training-Pflicht in Hardcore-Modus

Wirklich expired type-ratings = wirklich nicht fliegbar. **Andere systems bauen das nicht durch.**

### 53.22 Pilot-Credit-Score

Financial-responsibility-tracker, affects loan-rates, airline-hire-decisions. **Innovativ.**

### 53.23 Aircraft-Spawning aus Used-Market-Auktionen

Periodische auktionen für used-aircraft. EVE-style market-discovery. **Niemand hat used-aircraft-economy.**

### 53.24 Airline-Bond-Rating (S&P-style)

Rating-agency-system. Bonds, ratings, defaults. **Tiefe finanz-simulation.**

### 53.25 Government-Charters

Military, diplomatic, special-mission-types mit höheren security-clearance requirements. **Plot-driven.**

### 53.26 Apprenticeship-Programs

Junior-pilot follows senior on flights, earns reduced. Real-life-mirror. **Niemand hat das.**

### 53.27 Charter-Broker-Player-Role

Player-role: takes booking-requests, matches with airlines for commission. **Adds new role-type.**

### 53.28 Airline-Uniform-Designer

Cosmetic für crew-system. Customize flight-attendant-uniforms, captain-stripes. **Brand-immersion.**

### 53.29 Spotify-Integration

Pilot's chosen music während boarding via spotify. **Streamer-friendly innovation.**

### 53.30 Smart-Watch-Integration

Apple Watch app mit basic-stats, notifications. **Modern lifestyle-tie-in.**

### 53.31 VR-Airport-Tours

Vor flight, see your hub in VR (browser-WebVR). **Cutting-edge.**

### 53.32 Crash-Investigation-Community-System

Bei crash → community-investigation, learn-points für insights. **Community-driven safety-learning.**

### 53.33 Insurance-Claims-Mini-Game

Pilot crashes → claim filed → investigation → payout or denial. Active gameplay around incidents. **Adds depth.**

### 53.34 Loyalty-Programs für Frequent-Flyer

Frequent-flyer-miles, status-tiers, lounge-access. Cross-airline-recognition. **Real-world-mirror.**

### 53.35 Carbon-Credit-Economy

Eco-friendly operations get bonus credits, tradeable. SAF + efficient-routing rewarded. **Future-relevant.**

---

# TEIL XI — ARCHITEKTUR & ROLLOUT

## 54. Schema-Vorbereitungs-Strategie

### 54.1 Was JETZT ins schema (Phase 0)

Felder die jetzt schon hinein können, weil sie billig sind und später migration-pain ersparen:

```prisma
model User {
  // ... existing
  economyEnabled Boolean @default(false)
}

model UserSettings {
  userId String @id
  // ... siehe Section 3.1
}

model Airline {
  // ... existing
  economyEnabled Boolean @default(false)
  primaryHubIcao String?
}

model Pirep {
  // ... existing
  flightType FlightType @default(SCHEDULED)
  passengerCount Int?  // Nullable, populated wenn economy on
  cargoKg Int?
}

model Booking {
  // ... existing
  flightType FlightType @default(SCHEDULED)
}

enum FlightType {
  SCHEDULED
  CHARTER
  POSITIONING
  TRAINING
  FREE
}
```

### 54.2 Was SPÄTER kommt (Phase 1+)

Alle wallets, transactions, stocks, licenses, etc. — eigene tables die unabhängig hinzugefügt werden.

### 54.3 Migration-Sicherheit

Jede neue economy-table:
- Hat keine FK-cascades zu existing-tables (loose coupling)
- Kann komplett gedropped werden ohne flight-system zu brechen
- Hat eigene migration-files (clean rollback möglich)

---

## 55. Module-Isolation

### 55.1 Package-Struktur

```
packages/
  db/                    # existing
  economy/               # NEW: wallet, transactions, revenue/expense
    src/
      wallet.ts
      transaction.ts
      revenue.ts
      expense.ts
      events.ts          # event-handlers für pirep.approved etc.
  career/                # NEW: licenses, ranks, type-ratings
    src/
      license.ts
      flight-school.ts
      rank.ts
      type-rating.ts
  market/                # NEW: stock-exchange, bonds
    src/
      stock.ts
      order-engine.ts
      bond.ts
  integrations-twitch/   # NEW: twitch-bridge
    src/
      eventsub.ts
      reward-handler.ts
      sub-handler.ts
      bits-handler.ts
  integrations-youtube/  # FUTURE
  integrations-kick/     # FUTURE
```

### 55.2 Import-Rules

- `apps/web` can import from any `packages/`
- `packages/economy` can import from `packages/db`, NOT from `packages/career`
- `packages/career` can import from `packages/db` + `packages/economy`
- `packages/market` can import from `packages/db` + `packages/economy`
- `packages/integrations-*` can import from `packages/db` + `packages/economy`

### 55.3 Lazy-Loading

User without economy enabled → economy-package never imported in their request-context. Reduces bundle-size for casual-users.

---

## 56. Background-Jobs

### 56.1 Job-Catalog

| Job | Frequency | Purpose |
|---|---|---|
| `update-fuel-prices` | Daily 00:00 UTC | Recalc fuel-prices per airport |
| `recalc-stock-prices` | Hourly | Stock-price updates |
| `pay-monthly-salaries` | Monthly 1st | Run payroll |
| `process-monthly-leases` | Monthly 1st | Aircraft-lease-payments |
| `recalc-pilot-reputation` | Daily | Updated reputation scores |
| `recalc-airline-reputation` | Daily | Updated airline scores |
| `check-license-expiry` | Daily | Notify for upcoming expiry |
| `check-maintenance-due` | Daily | Notify aircraft-near-maintenance |
| `inflation-monitor` | Daily | Sources/sinks ratio check |
| `process-bond-coupons` | Quarterly | Pay bond-interest |
| `event-spawner` | Random | Trigger random-events |
| `twitch-eventsub-reconnect` | On-disconnect | Twitch-WebSocket-resilience |
| `cleanup-expired-orders` | Daily | Stock-orders past expiry |
| `weekly-leaderboard-snapshot` | Weekly Sun 23:59 | Snapshot for "this week" rankings |

### 56.2 Job-Infrastructure

- BullMQ + Redis (industry-standard for Node)
- Per-job retry-policies
- Dead-letter-queue for failed jobs
- Admin-dashboard for job-monitoring

---

## 57. Anti-Cheat

### 57.1 Cross-Source-Validation

Wenn pilot connected zu VATSIM während ACARS-flight:
- Compare ACARS-position vs VATSIM-position every 5 min
- Drift > 50 NM → flagged for review
- Persistent drift → PIREP rejected

### 57.2 PIREP-Validation

Already partially implemented — extend für economy:
- Fuel-burn vs aircraft-published-rate (±20% tolerance)
- Block-time vs distance/cruise-speed (sanity-check)
- Landing-rate from ACARS vs claimed
- Teleport-detection (impossible position-changes)
- Refuel-during-flight detection (fuel-quantity-spike)

### 57.3 Stock-Market-Anti-Manipulation

- Pump-and-dump-detection (rapid buy → coordinated message → rapid sell)
- Wash-trading (buy from yourself, even via shell-accounts)
- Insider-trading-window-enforcement
- Manual review of suspicious-patterns

### 57.4 Twitch-Fraud

- Self-redemption (pilot redeems own channel-points): allowed but logged, doesn't double-count
- Bot-redemption (purchased viewers): pattern-detection, auto-revoke
- Fake-streams (no real audience): viewer-count-validation

### 57.5 Audit-Log Everything

Every significant action logged immutably:
- All transactions
- All position-updates
- All admin-actions
- All system-overrides

For dispute-resolution and security-investigation.

---

## 58. Phasen-Roadmap

### 58.1 Estimation-Bands

Each phase has effort-band (low/medium/high/very-high):

| Phase | Inhalt | Effort | Calendar |
|---|---|---|---|
| **Phase 0** *(jetzt)* | Hub + free-flight + flight-types + economy-flags | Medium | 1-2 wochen |
| **Phase 1** | Economy-MVP (wallet + transactions + simple revenue/expense) | High | 2-3 wochen |
| **Phase 2** | Career basics (license-system, ranks, type-ratings) | High | 3-4 wochen |
| **Phase 3** | Aircraft-economy (ownership, marketplace, depreciation) | High | 2-3 wochen |
| **Phase 4** | Maintenance + insurance | Medium | 2 wochen |
| **Phase 5** | Fuel-economy + FBOs | Medium | 2 wochen |
| **Phase 6** | Cargo + passenger-depth + catering | Medium | 2-3 wochen |
| **Phase 7** | Twitch MVP (channel-points, subs, bits, basic-overlay) | High | 3-4 wochen |
| **Phase 8** | Stock-market (VAMSE basics, buy/sell, charts) | Very High | 4-6 wochen |
| **Phase 9** | Bonds + commodities + fuel-futures | Medium | 2-3 wochen |
| **Phase 10** | Multi-airline (alliances, M&A, codeshare, subsidiaries) | Very High | 4-6 wochen |
| **Phase 11** | Events + seasonal-content | Medium | ongoing |
| **Phase 12** | Social-layer (crew, forums, mentorship) | High | 3-4 wochen |
| **Phase 13** | Achievements + gamification + seasonal-pass | Medium | 2-3 wochen |
| **Phase 14** | YouTube/Kick-equivalents | Medium | 2 wochen |
| **Phase 15** | Mobile-companion-app | Very High | 6-8 wochen |
| **Phase 16** | VR + smart-watch + voice-ATC | Very High | open |
| **Phase 17** | Charity-system + sustainability + carbon-credits | Medium | 2-3 wochen |
| **Phase 18** | Anti-cheat-tooling + audit-dashboard | Medium | 2-3 wochen |
| **Phase 19** | Polish + documentation + community-onboarding | Medium | ongoing |

### 58.2 Total-Estimate

**Conservative:** 2-3 jahre für komplette vision (mit casual hobby-pace)  
**Aggressive:** 12-18 monate (mit dedicated full-time)  
**MVP-with-WOW-factor:** 6 monate für Phase 0-7 (foundation + economy + career + twitch)

### 58.3 Strategic Sequencing

**Track-Modell statt linear:**
- Track A: Pilot-experience (Phase 0, 1, 2)
- Track B: Streamer-features (Phase 7, 14)
- Track C: Tycoon-deep (Phase 3, 4, 5, 8, 9, 10)
- Track D: Community (Phase 11, 12, 13, 17)

Tracks parallel laufen lassen. Jeder track shipped independent value.

---

# TEIL XII — RISIKEN & ABSCHLUSS

## 59. Risiken & Mitigations

### 59.1 Komplexitäts-Explosion

**Risiko:** System wird zu komplex, casual-pilots verlassen.  
**Mitigation:**
- Realism-presets (CASUAL default)
- Progressive-disclosure (advanced features hidden until requested)
- Onboarding-flow (3-step setup mit defaults)
- Granular opt-out für jedes feature

### 59.2 Inflation

**Risiko:** VAM$ wird wertlos durch over-creation.  
**Mitigation:**
- Sources/sinks balanced
- Inflation-monitor-job
- Auto-events bei imbalance (fuel-crisis = increase sinks)
- Periodic system-admin-tuning

### 59.3 Cheating

**Risiko:** Pilots manipulieren PIREPs für money/rank.  
**Mitigation:**
- ACARS-validation
- Cross-source-checks (VATSIM vs IVAO vs ACARS)
- Audit-log immutable
- Community-reporting + admin-review
- Severe-cheats = permanent-ban

### 59.4 Twitch-API-Changes

**Risiko:** Twitch ändert API, breaks integration.  
**Mitigation:**
- Abstraction-layer
- Other streaming-platforms als fallback
- Graceful-degradation (still works without twitch)

### 59.5 Real-Money-Controversy

**Risiko:** Pay-to-win-vorwürfe.  
**Mitigation:**
- Cosmetic-only monetization
- No-stat-boost-from-purchase
- Free-tier fully-functional
- Transparent-pricing

### 59.6 Server-Load von Background-Jobs

**Risiko:** Jobs-explosion crashes system.  
**Mitigation:**
- BullMQ priority-queues
- Rate-limiting
- Horizontal-scaling-ready
- Job-monitoring + alerting

### 59.7 Twitch-Spam/Botting

**Risiko:** Cheap viewer-bots manipulieren ticket-revenue.  
**Mitigation:**
- Twitch's-own-anti-bot-mechanisms
- Pattern-detection (sudden 1000-viewer-spike)
- Manual-review für outliers
- Streamer-leaderboard-validation

### 59.8 Stock-Market-Crash-Cascade

**Risiko:** One airline-bankruptcy triggers system-wide-panic.  
**Mitigation:**
- Circuit-breakers (trading-pauses on major-drops)
- Insurance-funds für investor-protection
- Limited-leverage-rules
- Stress-tests via system-admin

### 59.9 Real-World-Event-Sensitivity

**Risiko:** Pandemic-event triggered during real-pandemic = bad-taste.  
**Mitigation:**
- All real-world-events opt-in per airline
- System-admin-curated-only
- Sensitive-events have "off-by-default" + warning

### 59.10 Career-System-Burnout

**Risiko:** Pilots feel forced into mandatory-training-grind.  
**Mitigation:**
- Realism-presets allow skipping
- Casual-mode = no career-pressure
- Career features rewards, not punishments

---

## 60. Out-of-Scope

Bewusst NICHT in dieser vision:

- **Real-money-trading** (RMT) zwischen pilots — illegal, brings TOS-issues
- **Crypto-integration** (NFT, blockchain-coins) — buzzword-fatigue, no clear value
- **AI-pilots competing with humans** — hostility-risk, kills community
- **Auto-PIREP-generation ohne sim-input** — undermines whole premise
- **Real-airline-licensing** (use real DLH/BA names) — trademark-issues
- **Multi-currency-system** (EUR, USD, ISK) — over-engineering, VAM$ enough
- **Player-vs-Player-combat** — wrong genre
- **Mobile-as-primary** — flight-sim is desktop-bound, mobile-companion only
- **Replacement of MSFS/X-Plane** — we're a supplement, not the sim itself

---

## 61. Cross-References

### 61.1 Verwandte Vision-Docs (existing)

- **`vam-master-roadmap.md`** — Track 5 (Business-Layer) ist die übergeordnete strategische einbettung dieser vision. Lesen vor diesem doc empfohlen.
- **`twitch-to-sim-integration.md`** — Bidirektionale twitch-integration auf sim-write-ebene. KOMPLEMENTÄR zu Section 25-34 hier (welche revenue-side covered).
- **`admin-dashboards-vision.md`** — Section 9.8 hat first-touches zu twitch-innovations.
- **`platform-layout-redesign.md`** — UX-foundation für die settings-pages und tab-strukturen die hier erwähnt sind.

### 61.2 Verwandte Architektur-Docs

- **`acars-architecture.md`** — Position-tracking-foundation für anti-cheat (Section 57.1) und auto-position-updates.
- **`pirep-analysis-page.md`** — PIREP-validation-foundation für economy-revenue-trigger.
- **`weather-provider-strategy.md`** — Weather-events (Section 46.4) brauchen weather-data-pipeline.
- **`simconnect-data-catalog.md`** — Welche sim-data ist verfügbar für anti-cheat-validation.

### 61.3 Schema-Files

- `packages/db/prisma/schema.prisma` — alle hier vorgeschlagenen schema-änderungen müssen dort migriert werden

### 61.4 Implementation-Decision-Records

- `docs/decisions/` — Architectural decisions sollten hier dokumentiert werden wenn implementation startet

---

## Schluss-Bemerkung

Dieses dokument ist die **Maximal-Vision**. Nicht jedes feature wird gebaut, und definitiv nicht in dieser reihenfolge. Es dient als:

1. **Inspirations-katalog** für was möglich ist
2. **Schema-vorbereitungs-leitfaden** für Phase 0 entscheidungen die jetzt getroffen werden
3. **Marketing-narrative** für VAM-system als "der ambitionierteste VA-Platform-versuch"
4. **Onboarding-doc** für mitstreiter die verstehen wollen wo wir hin wollen

Die Realität wird sein dass wir 30-50% dieser features tatsächlich bauen, in einer reihenfolge die durch echte user-feedback und market-validation getrieben wird. Aber:

**Wenn du das schema heute schon economy-ready aufsetzt, kostet das fast nichts und macht alle diese zukünftigen features 10× einfacher.**

Das ist die wichtigste lesson aus diesem doc.

---

*Generated by Claude Opus 4.7 (1M context) — basierend auf research zu phpVMS, OnAir, FSAirlines, Air Hauler 2, EVE Online economy-design, Twitch EventSub-API docs, real-world airline-pilot-salary-data 2026.*

*Dokument-version: 1.0 — initial vision-draft*
