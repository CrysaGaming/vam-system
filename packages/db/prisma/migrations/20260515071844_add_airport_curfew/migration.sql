-- CreateTable
CREATE TABLE "AirportCurfew" (
    "id" TEXT NOT NULL,
    "airportIcao" VARCHAR(4) NOT NULL,
    "timezone" VARCHAR(40) NOT NULL,
    "curfewStartLocalMin" INTEGER NOT NULL,
    "curfewEndLocalMin" INTEGER NOT NULL,
    "dayMask" INTEGER NOT NULL DEFAULT 127,
    "source" VARCHAR(200),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportCurfew_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AirportCurfew_airportIcao_key" ON "AirportCurfew"("airportIcao");

-- ─────────────────────────────────────────────────────────────────────────
-- Welle P / P3 — Seed: Major curfew airports (LEAV Aviation primary market)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Seeded inline into the migration so the data ships with the schema
-- and is present on fresh-database setups. Admin-UI for adding/editing
-- curfews is v2; for v1 these values are the source of truth.
--
-- All German fields below have full 7-day curfews (dayMask=127). Times
-- are stored as local-time minutes since midnight (e.g. 23:00 = 1380).
-- The helper converts to/from UTC at runtime via Intl.DateTimeFormat
-- with the IANA timezone, so DST is handled correctly year-round.

INSERT INTO "AirportCurfew" ("id", "airportIcao", "timezone", "curfewStartLocalMin", "curfewEndLocalMin", "dayMask", "source", "notes", "createdAt", "updatedAt") VALUES
  -- Frankfurt — the famous BVerfG 2011 ruling: hard curfew 23:00-05:00
  ('seed_curfew_eddf', 'EDDF', 'Europe/Berlin', 1380, 300, 127, 'Frankfurt Nachtflugverbot (BVerfG 2011)', 'Hard ban 23:00-05:00 local; no exceptions for scheduled commercial ops.', NOW(), NOW()),

  -- Düsseldorf — 22:00-06:00, fairly strict
  ('seed_curfew_eddl', 'EDDL', 'Europe/Berlin', 1320, 360, 127, 'Düsseldorf Nachtflugverbot', 'Quiet hours 22:00-06:00 local. Limited exemptions for delayed scheduled flights to 23:00.', NOW(), NOW()),

  -- München — limited cap, treated as 00:00-05:00 for the strict night-window
  ('seed_curfew_eddm', 'EDDM', 'Europe/Berlin', 0, 300, 127, 'München Nachtflugverbot', 'Strict ban 00:00-05:00 local; quota system for shoulder hours 22:00-00:00 + 05:00-06:00.', NOW(), NOW()),

  -- Hamburg — 23:00-06:00
  ('seed_curfew_eddh', 'EDDH', 'Europe/Berlin', 1380, 360, 127, 'Hamburg Nachtflugverbot', 'Quiet hours 23:00-06:00 local; delayed-arrival exemption window to 24:00 by approval.', NOW(), NOW()),

  -- Stuttgart — 23:30-06:00
  ('seed_curfew_edds', 'EDDS', 'Europe/Berlin', 1410, 360, 127, 'Stuttgart Nachtflugverbot', 'Quiet hours 23:30-06:00 local. Stricter than the German federal default.', NOW(), NOW()),

  -- Köln-Bonn — 22:00-06:00 PASSENGER ops; cargo is unrestricted
  ('seed_curfew_eddk', 'EDDK', 'Europe/Berlin', 1320, 360, 127, 'Köln-Bonn Passagier-Nachtflugverbot', 'Passenger flights restricted 22:00-06:00 local. Cargo ops uneingeschränkt (note: helper applies the curfew uniformly in v1).', NOW(), NOW()),

  -- Tegel (Berlin) — closed 2020, but kept here as a historical curfew reference;
  -- the airport is no longer operational so the row has no live effect.
  -- (Skipped — would only confuse the dispatch board.)

  -- London Heathrow — 23:30-06:00 night quota
  ('seed_curfew_egll', 'EGLL', 'Europe/London', 1410, 360, 127, 'London Heathrow Night Quota', 'Restricted operations 23:30-06:00 local. Movements counted against an annual noise quota.', NOW(), NOW());
