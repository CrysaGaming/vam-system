# Estimation Calibration — VAM-System

Konsolidierte Daten aus 4 Sessions (Day-2 bis Day-4) zur Schätzungs-Kalibrierung.
Nutzung: Wenn Claude oder Kevin eine neue Aufgabe einschätzt, hier zuerst
nachschlagen welche Faktoren historisch für ähnliche Aufgaben galten und EST
entsprechend anpassen.

## Aggregierte Datenpunkte

Alle Faktoren = ACT/EST. **Niedriger Faktor = EST war zu hoch.**

| Session | Task                                          | Type                                    | EST     | ACT     | Faktor |
| ------- | --------------------------------------------- | --------------------------------------- | ------- | ------- | ------ |
| Day-2   | Phase 2 #4 — `scheduledDeparture`             | additive (schema + UI)                  | 145min  | ~35min  | **0.24** |
| Day-3   | SimBrief username suggestion                  | scope-pivot (broad → narrow)            | 30min*  | ~7min   | **0.23** |
| Day-3   | OfpSummary refactor (file-move + reuse)       | additive + refactor                     | 41min   | ~20min  | **0.49** |
| Day-4   | Phase B Cancel-Booking UI                     | mostly-pre-existing + dev-debug         | 45min   | ~23min  | **0.51** |
| Day-4   | Phase D Popup-prefill verify                  | pure E2E test (XML decode)              | 3min    | ~5min   | **1.7** ⚠ |
| Day-4   | Phase A Override-Hierarchie                   | architecture addition (Zod+DB+builder)  | 100min  | ~36min  | **0.36** |
| Day-4   | Phase 5 Edge-cases assessment                 | code-read survey                        | 15min   | ~5min   | **0.33** |
| Day-4   | Phase 5 Fleet card + shared extract           | new component + refactor                | 60min   | ~25min  | **0.42** |
| Day-4   | Phase 5 Aircraft + Route cards                | clone-and-adapt × 2                     | 50min   | ~20min  | **0.40** |
| Day-4   | Phase 5 TOC CollapsibleSection                | new component + page integration        | 30min   | ~15min  | **0.50** |
| Day-4   | Phase 5 Live-test (browser e2e)               | full save-cycle through UI              | 10min   | ~8min   | **0.80** |

\* Pivoted EST. Original broad EST war 1-2d → effective Faktor ~0.005 vs broad.

## Median + Bandbreite

- **Median Faktor**: ~0.40
- **Range**: 0.23 – 1.7
- **Standard-Annahme für Schätzung**: EST × 0.4 = realistic ACT
- **Sicherheits-Aufschlag**: × 0.6 für externe Variablen (debugging, scope-creep)

## Kategorien-Faktoren

Je nach Aufgaben-Typ andere Multiplikatoren. Nutze die spezifischere Kategorie
wenn möglich.

| Kategorie | Faktor-Range | Typische Anwendung |
| --- | --- | --- |
| **Pure additive feature** | 0.20 – 0.30 | Schema-only, neuer Endpoint, isoliertes UI-Element |
| **Additive + small refactor** | 0.40 – 0.50 | Component move, shared-module extract |
| **Architecture addition** | 0.35 – 0.45 | New domain concept (Override-Hierarchie, neuer DB-Model) |
| **Mostly-pre-existing + polish** | 0.50 – 0.55 | Bestehender Code + Bugfix + Doku |
| **Clone-and-adapt N-th instance** | 0.40 (steady) | 2nd, 3rd Variante eines bekannten Patterns |
| **Greenfield component (1st of kind)** | 0.50 – 0.60 | Neues Pattern, kein vorheriges Beispiel |
| **Pure E2E test** | 1.0 – 2.0 ⚠ | Tests laufen oft länger als erwartet |
| **Live browser-test (manual)** | 0.80 | E2E-walk-through dauert ~Plan |

## Inflation-Faktoren (wann EST realistisch oder zu niedrig)

Wenn eine dieser Bedingungen zutrifft, **EST nicht reduzieren** — eventuell
sogar erhöhen. Sortiert nach Stärke des Effekts.

1. **Erste Begegnung mit unbekannter Library**: EST × 3
   *Beispiel*: Wenn Day-X mal eine neue Library wie tRPC oder a new ORM
   eingeführt wird, drei-fach EST erwartet.
2. **New external integration** (API, OAuth, third-party SDK): EST × 2
   *Beispiel*: Pattern Z war initial × 2 wegen SimBrief-API-Discovery.
3. **Cross-cutting concerns** (auth, middleware, error-handling): EST × 1.5
   *Beispiel*: Multi-tenant-scoping verifications berührten alle list-pages.
4. **Refactor mit call-site-propagation**: EST normal lassen
   *Beispiel*: OfpSummary-move musste 2 Caller updaten + neue Imports.
5. **Pure E2E test**: EST normal lassen oder × 1.5
   *Beispiel*: Day-4 Phase D Popup-prefill war 5min ACT für 3min EST.
6. **Debugging-Slot in EST einbauen**: ~30% Aufschlag bei nicht-trivialen
   features. *Beispiel*: Phase A Override hatte schema-rename-fix nach
   bug-discovery — der war nicht in EST.

## Compression-Faktoren (wann EST × 0.2 ist realistisch)

1. **Schema-only changes** (1 Field add): 1min, nicht 10min
2. **Toolchain-warm code edits** (Tag-2+): EST / 3 oder / 4
3. **Commit + push routine**: ~1min steady, nicht 10min wie früher
4. **Pre-existing patterns**: Wenn 80% des Codes Copy-and-adapt ist, EST × 0.3
5. **Agentic execution**: Wenn Claude die ganze Aufgabe parallel-tool-call
   bearbeiten kann, reale ACT typischerweise 0.2-0.4× initial-EST.

## Heuristiken für die Schätzung

### Vor jeder neuen Aufgabe — die 3 Fragen:

1. **"Habe ich das schon einmal gemacht?"**
   - Ja, im selben Session-Context (toolchain-warm) → Faktor 0.4
   - Ja, aber Tage her (toolchain-cold) → Faktor 0.5-0.6
   - Nein → Faktor 0.5 + Inflations-Faktoren prüfen

2. **"Ist es additive oder berührt es bestehenden Code?"**
   - Pure additive → Faktor 0.25
   - Mit refactor → Faktor 0.45
   - Cross-cutting → Faktor 0.6 + Inflation × 1.5

3. **"Sind alle Annahmen valid? Bin ich sicher über den scope?"**
   - Wenn du dir nicht sicher bist → erst scope-discovery (10min)
     **bevor** du EST machst. Scope-pivots können Faktor von 0.005 bis
     0.5 schwanken lassen.

### Kalibrierungs-Loop

Wenn EST über mehrere Tasks systematisch zu hoch ist (Faktor < 0.3),
**halbiere die Default-Annahme**. Das passiert hier — ursprünglich
schätzte Claude noch ~10min für commit+push, real ist es ~1min. Solche
Veränderungen über die Zeit signalisieren dass die mentale Baseline
veraltet ist.

## Lessons aus den Sessions

### Day-2 — Initial Calibration

> *"Schema-only changes: 1 min, nicht 10. Toolchain-warm code edits:
> divide EST by 3-4. Commit + push fast immer ~1 min, nicht 10."*

Erste explizite Messung. Faktor 0.24 für eine pure-additive feature war
die Eröffnung. Hat etabliert dass die Default-mentale-Baseline veraltet
ist und die kalibrierte Realität ~25% des bisherigen estimate ist.

### Day-3 — Scope-Pivot Pattern

> *"Wenn die ursprüngliche scope-Annahme bei der ersten code-discovery
> falsch ist, dann compress 1-2d Annahmen auf ~30min realistic scope.
> Scope-discovery vor code-write ist die hochwertigste Stunde des Tages."*

Eindrücklicher Datapunkt: Original-EST 1-2d, realistic-EST 30min, ACT
7min. Faktor 0.005 vs broad. Lesson: bevor man irgendwas schätzt, immer
erst 5-10min mit dem code reden um die scope-Annahmen zu validieren.

### Day-3 — Refactor-Component Cost

> *"Pure additive features: factor ~0.27. Additive + refactor: factor
> ~0.49. Pure refactor: wahrscheinlich faktor ~0.6-0.8."*

Erste Datapunkt mit refactor. Cross-route-imports und file-move
verdoppeln die Edit-Zeit gegen pure-additive features. Cost ist
material aber overall noch deutlich unter EST.

### Day-4 Phase A — Architecture Addition Faktor 0.36

> *"A factor 0.36 ist remarkable für eine Architecture-Addition mit:
> neuem Zod-Schema (21 fields), neuem DB-model (Fleet), 4 schema-
> mutations, 2 builder-changes, page-wiring, end-to-end-test mit
> OFP-XML-roundtrip."*

Begründung: tooling-warm (Prisma-migrate workflow geübt), JSON-column
statt flat-columns spart migrations, builder-pattern aus Day-3 etabliert.
Architecture-Additions können also in den 0.35-0.45 range fallen wenn
das Foundation-tooling robust ist.

### Day-4 Phase 5 — N-th-Instance Acceleration

> *"Clone-and-adapt of established pattern is faster than greenfield
> even after the first instance — Aircraft + Route at ~10min each
> (vs Fleet at 25min, the first variant) confirms the shared-module-
> pattern pays off after 2nd usage."*

Wenn ein shared-module bereits extrahiert ist, fallen 2nd und 3rd
Variante auf ~40% des first-variant-effort. Investition in
shared-modules zahlt sich ab 3rd-caller spürbar aus.

## Future-Estimates: Anwendungs-Beispiel

Aufgabe: "Add overlay-resolved snapshot to Booking-Detail page"

- Habe ich das gemacht? Nein — neuer concept (resolved overlay display).
- Additive vs cross-cutting? Mostly additive (1 new section auf existing page).
- Sind die Annahmen valid? Klar: 4-Ebenen-resolve already coded in builder.

→ Default-Faktor 0.4 × naive EST.
→ Naive EST: 30min für read-builder, render-section, type-prop-up.
→ Adjusted: 30min × 0.4 = **~12min realistic ACT**.
→ Inflation-Check: keine (no new lib, no auth, no cross-cutting).
→ Final EST: **12-15min**.

Dieses Doc updaten nachdem die echte Aufgabe gemessen ist. Die Tabelle
oben wächst und die Faktor-Ranges werden präziser je mehr Datapunkte
da sind.
