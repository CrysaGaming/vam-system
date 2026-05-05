/**
 * Welle 13E-13b: Theory-Exam starter-question-bank (PPL).
 *
 * 50 fragen für die PPL-theorieprüfung, kategorisiert nach EASA Part-FCL-
 * syllabus. Aufteilung:
 *   - 13× REGULATIONS    (ICAO/EASA, deutsches Luftrecht, Verkehrsregeln)
 *   - 12× WEATHER        (Meteorologie, METAR/TAF, Wolken, Front-systeme)
 *   - 13× AERODYNAMICS   (Auftrieb, Strömungsabriss, W&B, Performance)
 *   - 12× SYSTEMS        (Motor, Instrumente, Treibstoff, elektrik)
 *
 * Format: 4 antwort-optionen pro frage, exact 1 richtig. Erklärung optional
 * aber empfohlen damit pilot bei falschen antworten lernt.
 *
 * Source: Eigenformulierte fragen orientiert an PPL-theorieprüfungs-stoff.
 * KEIN copy-paste aus offiziellen prüfungs-banken (urheberrecht). Wer
 * irgendwann reale prüfungen vorbereitet, muss eh durch ein zertifiziertes
 * trainingsmaterial — diese bank ist für die VAM-roleplay/learning-loop.
 *
 * Schwierigkeit (difficulty 1-5, default 2): MVP nutzt das nicht aktiv,
 * aber wir markieren mit difficulty=3 die "knifflige" fragen damit später
 * adaptive-quiz darauf aufbauen kann.
 *
 * Idempotency: das seed-script (siehe scripts/seed-theory-exam-questions.ts)
 * prüft per (questionText, licenseType)-tuple ob die frage schon existiert
 * und skipt dann. Re-run ist also safe.
 */

import type { LicenseType } from "@prisma/client";

// Lokales TheoryExamCategory string-literal-type um circular-imports zu
// vermeiden. Wert-equiv. zum prisma-enum.
type Category =
  | "REGULATIONS"
  | "WEATHER"
  | "AERODYNAMICS"
  | "SYSTEMS"
  | "NAVIGATION"
  | "HUMAN_FACTORS";

export interface SeedQuestion {
  licenseType: LicenseType;
  category: Category;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation?: string;
  difficulty?: number;
}

export const PPL_THEORY_QUESTIONS: SeedQuestion[] = [
  // ═════════════════════════════════════════════════════════════════════
  // REGULATIONS (13 fragen)
  // ═════════════════════════════════════════════════════════════════════
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Welches Mindestalter ist erforderlich, um eine PPL(A) ausgestellt zu bekommen?",
    options: ["16 Jahre", "17 Jahre", "18 Jahre", "21 Jahre"],
    correctIndex: 1,
    explanation:
      "Nach EASA Part-FCL muss der Bewerber für eine PPL(A) mindestens 17 Jahre alt sein. Mit 16 darf bereits SPL ausgestellt + soloflüge geflogen werden.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "In welchem Luftraum gilt die Sichtflugregel-Mindestsicht von 1500 m bei Geschwindigkeiten unter 140 KIAS?",
    options: ["Luftraum C", "Luftraum D", "Luftraum E", "Luftraum G unter 3000 ft AMSL"],
    correctIndex: 3,
    explanation:
      "Im Luftraum G unter 3000 ft AMSL/1000 ft AGL gilt für VFR-Flüge unter 140 KIAS eine reduzierte Sichtmindeste von 1500 m (statt 5 km), Wolken- abstand 'frei von Wolken & Bodensicht'.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText: "Wer hat im Gegenanflug auf eine Piste Vorrang?",
    options: [
      "Das tiefer fliegende Luftfahrzeug",
      "Das höher fliegende Luftfahrzeug",
      "Das schnellere Luftfahrzeug",
      "Das größere Luftfahrzeug",
    ],
    correctIndex: 0,
    explanation:
      "Nach SERA.3210 hat im Anflug das tieferfliegende Luftfahrzeug Vorrang — darf aber nicht ausgenutzt werden, um sich vor ein anderes im Endanflug befindliches Luftfahrzeug zu schieben.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Wie häufig müssen PPL-Inhaber mindestens fliegen, um die Lizenz currency zu erhalten (rolling 24 Monate)?",
    options: [
      "12 Stunden inkl. 12 Starts/Landungen + 1 Übungsflug mit Lehrer",
      "24 Stunden inkl. 12 Starts/Landungen",
      "10 Stunden Soloflug",
      "Es gibt keine PPL-Currency-Anforderung",
    ],
    correctIndex: 0,
    explanation:
      "FCL.140.A: 12 Stunden in den letzten 24 Monaten als PIC oder unter Aufsicht, davon 12 Starts und Landungen, plus mindestens 1 Übungsflug von 1h mit Fluglehrer.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Was bedeutet die Kennzeichnung 'D-EXXX' am Heck eines Flugzeugs?",
    options: [
      "Deutsches Verkehrsflugzeug über 5,7 t",
      "Deutsches Motorflugzeug bis 2 t",
      "Deutsches Segelflugzeug",
      "Deutscher Hubschrauber",
    ],
    correctIndex: 1,
    explanation:
      "Deutsche Luftfahrzeug-Kennzeichen beginnen alle mit 'D-'. Der erste Buchstabe nach dem Bindestrich klassifiziert: E = einmotoriges Flugzeug bis 2 t, M = mehrmotoriges Flugzeug bis 5,7 t, A = Verkehrsflugzeug über 5,7 t, K = Segelflugzeug, H = Hubschrauber.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Welcher Transponder-Code signalisiert eine Funkausfall-Situation?",
    options: ["7500", "7600", "7700", "1200"],
    correctIndex: 1,
    explanation:
      "7600 = Communication failure (Funkausfall), 7500 = Hijack (Entführung), 7700 = General emergency (Notfall). Bei Funkausfall den Code rasten und nach Verfahren weiterfliegen.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "In welcher Höhe muss bei einem VFR-Flug über überwiegend bebautem Gebiet mindestens geflogen werden?",
    options: [
      "300 m / 1000 ft über höchstem Hindernis im Umkreis 600 m",
      "150 m / 500 ft über Grund",
      "1000 ft AGL",
      "FL 50",
    ],
    correctIndex: 0,
    explanation:
      "SERA.5005(f): Über Städten, dicht besiedelten Gebieten oder Menschenansammlungen müssen mindestens 300 m (1000 ft) über dem höchsten Hindernis im Umkreis von 600 m geflogen werden.",
    difficulty: 3,
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText: "Was bedeutet die Abkürzung NOTAM?",
    options: [
      "Notice to Aviation Maintenance",
      "Notice to Airmen / Air Mission",
      "Notice on Tactical Aircraft Movements",
      "North Atlantic Track Aviation Manual",
    ],
    correctIndex: 1,
    explanation:
      "NOTAM = Notice to Airmen (klassisch) bzw. heute oft 'Notice to Air Mission'. Veröffentlichung mit operativ wichtigen Informationen (z.B. Pisten gesperrt, Frequenzänderungen, Hindernisse).",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Welcher Flughöhenmesser-Bezugswert wird für Flüge unter Übergangshöhe (TA) verwendet?",
    options: ["QFE", "QNH", "Standard 1013,25 hPa", "QFF"],
    correctIndex: 1,
    explanation:
      "Unter der Transition Altitude wird mit QNH geflogen — das gibt die tatsächliche Höhe über NN an. Über Transition Level wird auf Standard 1013,25 hPa (Flight Levels) umgestellt.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Wann muss spätestens vor Antritt eines kontrollierten VFR-Fluges ein Flugplan aufgegeben werden?",
    options: [
      "60 Minuten vor EOBT",
      "30 Minuten vor EOBT",
      "10 Minuten vor EOBT",
      "Es ist kein Flugplan erforderlich",
    ],
    correctIndex: 0,
    explanation:
      "ICAO-Standard: Flugpläne sollen mindestens 60 Minuten vor EOBT (estimated off-block time) abgegeben werden. Bei kürzerem Vorlauf nimmt FIS oft trotzdem an, aber 60 min ist die offizielle Vorgabe.",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Welcher Sichtflug-Mindestabstand zu Wolken gilt im Luftraum E?",
    options: [
      "Frei von Wolken, Bodensicht",
      "1500 m horizontal, 300 m vertikal",
      "1500 m horizontal, 150 m vertikal",
      "5 km horizontal, 1000 ft vertikal",
    ],
    correctIndex: 1,
    explanation:
      "Im Luftraum E gilt für VFR: 1500 m horizontaler und 300 m (1000 ft) vertikaler Abstand zu Wolken, Sicht mindestens 5 km (8 km über FL 100).",
    difficulty: 3,
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Welche medizinische Klasse ist für eine PPL mindestens erforderlich?",
    options: ["Class 1", "Class 2", "Class 3", "LAPL Medical"],
    correctIndex: 1,
    explanation:
      "PPL erfordert ein Class-2-Tauglichkeitszeugnis. Class 1 ist für CPL/ATPL, LAPL-Medical reicht nur für LAPL. Class-2-Gültigkeit: 60 Monate (unter 40 J), 24 Monate (40-50), 12 Monate (über 50).",
  },
  {
    licenseType: "PPL",
    category: "REGULATIONS",
    questionText:
      "Wer ist verantwortlich für die Beladung eines Flugzeugs innerhalb der Schwerpunktgrenzen?",
    options: [
      "Der Halter",
      "Der Tankwart",
      "Der verantwortliche Pilot (PIC)",
      "Die Werft",
    ],
    correctIndex: 2,
    explanation:
      "Der PIC trägt die Endverantwortung für die ordnungsgemäße Beladung und das Einhalten der Weight & Balance-Limits. Auch wenn andere helfen — der PIC unterschreibt für die Lufttüchtigkeit dieses spezifischen Fluges.",
  },

  // ═════════════════════════════════════════════════════════════════════
  // WEATHER (12 fragen)
  // ═════════════════════════════════════════════════════════════════════
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Wie verhält sich der Druck bei einer Höhenzunahme um 1000 ft in Standardatmosphäre?",
    options: [
      "Er steigt um etwa 1 hPa",
      "Er fällt um etwa 30 hPa",
      "Er fällt um etwa 1 hPa pro 30 ft (also ca. 33 hPa pro 1000 ft)",
      "Er ändert sich nicht",
    ],
    correctIndex: 2,
    explanation:
      "Faustregel: 1 hPa Druckabnahme pro 30 ft Höhenzunahme in der unteren Troposphäre. Über 1000 ft sind das also etwa 33 hPa.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText: "Was bedeutet die METAR-Abkürzung 'CAVOK'?",
    options: [
      "Wolkenbasis 1500 m, Wind variabel",
      "Sicht ≥10 km, keine Wolken unter 5000 ft/MSA, kein wesentliches Wetter",
      "Cleared for Approach Visual Operations Known",
      "Bewölkt aber Visual Meteorological Conditions",
    ],
    correctIndex: 1,
    explanation:
      "CAVOK (Ceiling And Visibility OK) bedeutet: Sicht ≥10 km, keine Wolken unter 5000 ft oder höchster Mindesthöhe (was höher ist), keine CB/TCU, kein signifikantes Wetter.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText: "Welche Wolkenart kündigt typischerweise eine Warmfront an?",
    options: ["Cumulonimbus", "Cirrus", "Cumulus humilis", "Stratocumulus"],
    correctIndex: 1,
    explanation:
      "Eine herannahende Warmfront wird typisch als erstes durch hohe Cirrus-Wolken (CI) angekündigt, gefolgt von Cirrostratus (CS), Altostratus (AS), Nimbostratus (NS) mit Dauerregen.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Wie ändert sich der Wind in der Nordhalbkugel mit zunehmender Höhe in der Reibungsschicht typischerweise?",
    options: [
      "Er dreht nach links und wird schwächer",
      "Er dreht nach rechts und wird stärker",
      "Er bleibt konstant",
      "Er dreht zufällig",
    ],
    correctIndex: 1,
    explanation:
      "Reibung am Boden bremst und lenkt den Wind nach links ab (Nordhalbkugel). Mit zunehmender Höhe nimmt die Reibung ab, der Wind dreht nach rechts und wird stärker — bis er parallel zu den Isobaren weht (geostrophischer Wind).",
    difficulty: 3,
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Was beschreibt die METAR-Gruppe 'BKN015'?",
    options: [
      "Broken (5-7 Achtel) Bewölkung in 1500 ft AGL",
      "Broken (5-7 Achtel) Bewölkung in 15000 ft AGL",
      "Wind aus 015° mit Böen",
      "Sicht 1500 m mit Bodennebel",
    ],
    correctIndex: 0,
    explanation:
      "BKN = Broken (5/8 bis 7/8 Bewölkung). 015 ist die Höhe in Hundert Fuß über Flugplatz-Niveau, also 1500 ft AGL.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Was ist der Hauptindikator für mögliche Tragflächen-Vereisung im Reiseflug?",
    options: [
      "OAT zwischen +10 und +15 °C in trockener Luft",
      "OAT zwischen 0 und -15 °C in sichtbarer Feuchtigkeit (Wolken/Niederschlag)",
      "OAT unter -40 °C",
      "Wind über 30 kt",
    ],
    correctIndex: 1,
    explanation:
      "Tragflächen-Vereisung ist am wahrscheinlichsten zwischen 0 °C und -15 °C OAT in sichtbarer Feuchtigkeit. Unter -40 °C ist die Luft typisch zu trocken (Eis kristallisiert vorher aus).",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Welche Druckänderung am Boden würde einen sinkenden Luftdruck bedeuten?",
    options: [
      "QNH steigt von 1015 auf 1020 hPa",
      "QNH fällt von 1015 auf 1010 hPa",
      "QFE bleibt konstant",
      "Standard 1013,25 hPa wird gerastert",
    ],
    correctIndex: 1,
    explanation:
      "Sinkender Luftdruck = QNH-Wert nimmt ab. Faustregel für VFR-Pilot: 'Hoher Druck = gutes Wetter, fallender Druck = Wetterverschlechterung'.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Wodurch entsteht typischerweise Strahlungsnebel?",
    options: [
      "Warme feuchte Luft strömt über kaltes Wasser",
      "Klare wolkenfreie Nacht mit feuchter Luft und schwachem Wind",
      "Frontaler Aufgleitvorgang in 5000 ft",
      "Aufsteigende Warmluft an Gebirgshängen",
    ],
    correctIndex: 1,
    explanation:
      "Strahlungsnebel: Bei klarer Nacht strahlt der Boden Wärme ab und kühlt sich + die bodennahe Luft auskühlen. Bei feuchter Luft und schwachem Wind (< 5 kt) kondensiert die Feuchtigkeit zu Bodennebel.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Was ist die Definition des Taupunktes?",
    options: [
      "Die Temperatur, bei der Eis schmilzt",
      "Die Temperatur, auf die Luft abgekühlt werden muss, damit ihre Feuchte zu kondensieren beginnt",
      "Der Gefrierpunkt von Süßwasser",
      "Die durchschnittliche Tagestemperatur",
    ],
    correctIndex: 1,
    explanation:
      "Taupunkt = Temperatur, bei der die aktuelle Luftfeuchte 100 % relative Feuchte erreicht und Wasserdampf kondensiert. Wenn Lufttemperatur und Taupunkt gleich sind, bildet sich Nebel/Wolken.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Was kennzeichnet eine instabile Luftmasse?",
    options: [
      "Stratus-Bewölkung und Sprühregen",
      "Cumulus-/Cumulonimbus-Bildung mit Schauern und Böen",
      "Konstante Sicht und keine Bewölkung",
      "Bodennebel am Morgen",
    ],
    correctIndex: 1,
    explanation:
      "Instabile Luft: aufsteigende Warmluft erkühlt langsamer als die Umgebung → Auftriebsbewegung verstärkt sich → Cumulus-Wolken, ggf. Cumulonimbus mit Schauern, Hagel, Böen. Stabile Luft macht eher Stratus/Hochnebel.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Welche Information findet sich in einem TAF, aber NICHT in einem METAR?",
    options: [
      "Aktuelle Sicht",
      "Aktueller Wind",
      "Wettervorhersage für den Flugplatz",
      "Aktuelle Wolkenuntergrenze",
    ],
    correctIndex: 2,
    explanation:
      "METAR = Meteorological Aerodrome Report (aktuelle Wetterbeobachtung), TAF = Terminal Aerodrome Forecast (Vorhersage typisch für 9, 24 oder 30 h). Das TAF beschreibt erwartete Bedingungen.",
  },
  {
    licenseType: "PPL",
    category: "WEATHER",
    questionText:
      "Was bedeutet die Wind-Gruppe '27015G25KT' in einem METAR?",
    options: [
      "Wind aus 270° mit 15 kt, Böen bis 25 kt",
      "Wind aus 015° mit 270 kt",
      "Wind variabel, 15 bis 25 kt",
      "Wind aus 270° konstant 1525 kt",
    ],
    correctIndex: 0,
    explanation:
      "Format: ddd ff G fm KT — drei Ziffern Richtung in Grad (geographisch nord), zwei Ziffern Stärke in Knoten, optional 'G' + Spitzen-Böen-Wert.",
  },

  // ═════════════════════════════════════════════════════════════════════
  // AERODYNAMICS (13 fragen)
  // ═════════════════════════════════════════════════════════════════════
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Wie ändert sich die Stallgeschwindigkeit (Vs) bei steigender Masse des Flugzeugs?",
    options: [
      "Sie sinkt linear",
      "Sie bleibt konstant",
      "Sie steigt mit der Quadratwurzel des Masseverhältnisses",
      "Sie steigt linear mit der Masse",
    ],
    correctIndex: 2,
    explanation:
      "Vs ∝ √(m). Eine 21%-Massenerhöhung steigert Vs um √1,21 ≈ 10 %. Das ist auch der Grund warum Stalls bei höherer Beladung oder höherem Lastfaktor bei höherer Geschwindigkeit auftreten.",
    difficulty: 3,
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Was bewirken Klappen (Flaps) typischerweise beim Ausfahren?",
    options: [
      "Reduzierter Auftrieb und reduzierter Widerstand",
      "Erhöhter Auftrieb und erhöhter Widerstand",
      "Erhöhter Auftrieb ohne Widerstandsänderung",
      "Reduzierter Anstellwinkel-Bedarf für gleiche Geschwindigkeit",
    ],
    correctIndex: 1,
    explanation:
      "Klappen erhöhen die Profilwölbung und (je nach Bauart) auch die Flügelfläche → mehr Auftrieb (Vs sinkt) UND mehr Widerstand (steilerer Anflug bei gleicher Geschwindigkeit möglich).",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Was passiert mit dem Auftrieb, wenn der Anstellwinkel über den kritischen Anstellwinkel hinaus erhöht wird?",
    options: [
      "Er steigt weiter linear",
      "Er bleibt konstant",
      "Er bricht ab — Strömungsabriss (Stall)",
      "Er verdoppelt sich",
    ],
    correctIndex: 2,
    explanation:
      "Über dem kritischen Anstellwinkel löst sich die Strömung an der Flügeloberseite ab → Auftrieb bricht abrupt ein, Widerstand schießt in die Höhe. Vorzeichen: Stallwarner, Buffeting, träge Steuerreaktion.",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Was beeinflusst die wahre Fluggeschwindigkeit (TAS) im Vergleich zur indizierten Fluggeschwindigkeit (IAS)?",
    options: [
      "Nur das Gewicht des Flugzeugs",
      "Höhe und Außentemperatur",
      "Nur der Wind",
      "Nur der Anstellwinkel",
    ],
    correctIndex: 1,
    explanation:
      "TAS hängt von der Luftdichte ab (höhere Höhe oder höhere Temperatur → niedrigere Dichte → TAS > IAS). Faustregel: TAS steigt etwa 2 % pro 1000 ft Höhe gegenüber IAS in Standardatmosphäre.",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Was bewirkt eine vordere Schwerpunktlage (CG vorn im zulässigen Bereich)?",
    options: [
      "Höhere Stallgeschwindigkeit, stabileres Flugverhalten, besserer Pitch-Authority im Flare",
      "Niedrigere Stallgeschwindigkeit, bessere Manövrierbarkeit",
      "Keinen Einfluss auf Stallgeschwindigkeit",
      "Reduzierten Treibstoffverbrauch",
    ],
    correctIndex: 0,
    explanation:
      "Vorderlastiger CG: höhere Stallgeschwindigkeit (Höhenruder muss negativen Auftrieb erzeugen → mehr Gesamt-Auftriebsbedarf vom Flügel), aber stabileres Flugverhalten und schwerere/spätere Stalls. Hinten = agiler aber nahe an der Marginal-Zone.",
    difficulty: 3,
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Welche Geschwindigkeit ist die 'best rate of climb' (Vy)?",
    options: [
      "Geschwindigkeit für maximale Steigwinkel",
      "Geschwindigkeit für maximale vertikale Steiggeschwindigkeit (ft/min)",
      "Maximale Manövriergeschwindigkeit",
      "Stallgeschwindigkeit mit ausgefahrenen Klappen",
    ],
    correctIndex: 1,
    explanation:
      "Vy = best rate of climb = maximale Steiggeschwindigkeit in ft/min (höchste Differenz zwischen verfügbarer und benötigter Leistung). Vx = best angle (höchster Höhengewinn pro Strecke, niedriger als Vy).",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Was ist der induzierte Widerstand?",
    options: [
      "Widerstand durch Reibung an der Flügeloberfläche",
      "Widerstand durch Turbulenzen am Triebwerk",
      "Widerstand als Nebenprodukt der Auftriebserzeugung (Wirbelschleppen an Flügelspitzen)",
      "Widerstand durch Klappenausfahren",
    ],
    correctIndex: 2,
    explanation:
      "Induzierter Widerstand entsteht weil hoher Druck unter dem Flügel zur Oberseite umströmt → Wirbelschleppen an den Flügelspitzen → Energieverlust. Größer bei langsamem Flug + hohem Anstellwinkel.",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Wie wirkt sich erhöhte Flughöhe (Density Altitude) auf die Startstrecke aus?",
    options: [
      "Sie verkürzt sich",
      "Sie verlängert sich",
      "Sie bleibt unverändert",
      "Sie hängt nur vom Wind ab",
    ],
    correctIndex: 1,
    explanation:
      "Höhere Density Altitude (durch Höhe ODER hohe Temperatur ODER hohe Feuchte) → weniger Luftdichte → weniger Triebwerksleistung + weniger Flügelauftrieb → längere Startrolle und reduzierte Steigleistung.",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Was ist der Unterschied zwischen Va (Manövriergeschwindigkeit) und Vne (Never-exceed)?",
    options: [
      "Va ist immer höher als Vne",
      "Va ist die Geschwindigkeit, bei der volle Steuer-Ausschläge die Struktur nicht beschädigen; Vne darf nie überschritten werden",
      "Va ist die Stall-Geschwindigkeit, Vne die Reisegeschwindigkeit",
      "Beide Begriffe sind synonym",
    ],
    correctIndex: 1,
    explanation:
      "Va = Manöver-Geschwindigkeit, bei der ein voller abrupter Steuerausschlag das Flugzeug nicht überlasten kann (Flügel stallt vor Strukturversagen). Vne = absolute Höchst-Geschwindigkeit, darunter sicher, darüber Strukturversagen möglich.",
    difficulty: 3,
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Welche Auswirkung hat ein P-Faktor (asymmetric thrust) bei Propellerflugzeugen?",
    options: [
      "Drücken die Nase nach oben beim Steigflug",
      "Linksdrall in der Nordhemisphäre bei hohem Anstellwinkel und voller Leistung",
      "Erhöht die Stallgeschwindigkeit",
      "Reduziert den Treibstoffverbrauch",
    ],
    correctIndex: 1,
    explanation:
      "P-Faktor: Bei hohem Anstellwinkel + voller Leistung trifft der absteigende Propellerblatt mit höherem effektiven Anstellwinkel auf die Luft → mehr Schub auf der rechten Seite (bei rechtsdrehendem Propeller) → Yaw nach links. Wird mit rechtem Seitenruder ausgeglichen.",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Was passiert beim Fliegen in den Bodeneffekt (typisch unter 1 Spannweite Höhe)?",
    options: [
      "Erhöhter Auftrieb und reduzierter induzierter Widerstand",
      "Reduzierter Auftrieb",
      "Erhöhter Strömungsabriss-Anstellwinkel",
      "Keine messbare Änderung",
    ],
    correctIndex: 0,
    explanation:
      "Im Bodeneffekt werden die Flügelspitzen-Wirbel unterdrückt → induzierter Widerstand sinkt → das Flugzeug 'gleitet' im Flare. Risk: 'floating' bei der Landung wenn zu schnell + zu wenig Energiemanagement.",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Wie verhält sich der Lastfaktor (load factor) in einer 60° -Steilkurve bei konstanter Höhe?",
    options: ["1,0 g", "1,4 g", "2,0 g", "3,0 g"],
    correctIndex: 2,
    explanation:
      "Lastfaktor in einer level-Kurve = 1/cos(Querneigung). 60°: 1/cos(60°) = 1/0,5 = 2,0 g. 30°: 1/cos(30°) ≈ 1,15 g. 45°: ≈ 1,41 g. Stallgeschwindigkeit steigt um Faktor √Lastfaktor.",
  },
  {
    licenseType: "PPL",
    category: "AERODYNAMICS",
    questionText:
      "Welche Flugeigenschaft beschreibt 'longitudinale Stabilität'?",
    options: [
      "Tendenz, in eine Querneigung zurückzufallen",
      "Tendenz, nach einer Pitch-Störung zur ursprünglichen Anstellungslage zurückzukehren",
      "Tendenz, im Slip eine konstante Heading zu halten",
      "Stabilität gegen Triebwerksdrehmoment",
    ],
    correctIndex: 1,
    explanation:
      "Longitudinale Stabilität = Pitch-Stabilität (um die Querachse). Wird hauptsächlich durch das Höhenleitwerk und die Schwerpunktslage bestimmt. Vorderlastiger CG = höhere Stabilität (aber träge), hinterlastig = agil aber instabiler.",
  },

  // ═════════════════════════════════════════════════════════════════════
  // SYSTEMS (12 fragen)
  // ═════════════════════════════════════════════════════════════════════
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Welche Mischung (Mixture) wird typischerweise bei Reiseflug in großer Höhe eingestellt?",
    options: [
      "Vollreich (full rich)",
      "Mager (lean) auf 'best power' oder 'best economy' nach EGT",
      "Idle cut-off",
      "Mischung wird nicht verändert",
    ],
    correctIndex: 1,
    explanation:
      "In der Höhe ist die Luft dünner — bei vollreich-Mischung würde das Verhältnis zu fett. Pilot leant auf 'best power' (50-100°F vor peak EGT) oder 'best economy' (peak EGT). Wieder vollreich vor Sinkflug + Landung.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Was misst der Manifold-Pressure-Indikator (MAP)?",
    options: [
      "Treibstoffdruck im Vergaser",
      "Druck im Ansaugkrümmer hinter der Drosselklappe",
      "Öldruck im Motor",
      "Atmosphärendruck",
    ],
    correctIndex: 1,
    explanation:
      "MAP misst den absoluten Druck im Ansaugkrümmer hinter der Drosselklappe. Bei stehendem Motor zeigt MAP den Umgebungsdruck (~ QFE). Bei laufendem Motor sinkt MAP unter Atmosphärendruck — bei voll geöffneter Drossel + niedriger Höhe nahe Umgebungsdruck.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Welcher Effekt ist typisch beim Vergaservereisung?",
    options: [
      "Steigende RPM und stabiles Triebwerk",
      "Sinkende RPM (festen Propeller) oder MAP-Drop, raues Laufen, ggf. Triebwerksstillstand",
      "Erhöhter Öldruck",
      "Aussetzen nur bei voll geöffneter Drossel",
    ],
    correctIndex: 1,
    explanation:
      "Eis im Vergaser-Venturi blockiert teilweise den Luftdurchsatz → Mischung wird zu fett → RPM sinken (festen Prop) oder MAP fällt → Motor läuft rau. Vergaser-Vorwärmung dauerhaft an bei Idle-Power oder im kritischen OAT-Bereich (-10 bis +25 °C bei sichtbarer Feuchte).",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Was bewirkt das Ausschalten der Magnete (Magneto Check) im Run-up?",
    options: [
      "Fenster zum Triebwerk schließen",
      "Test ob beide Magnetzünder unabhängig funktionieren — RPM-Drop pro Magnet sollte im POH-Bereich liegen",
      "Triebwerk warmlaufen lassen",
      "Generatorprüfung",
    ],
    correctIndex: 1,
    explanation:
      "Standard run-up: erst BOTH, dann je L und R einzeln. RPM-Drop bei einem Magneten typisch 50-150 RPM (POH-spezifisch), Differenz zwischen L und R nicht mehr als 50 RPM. Zu großer Drop = Zündkerzen-/Magneto-Problem.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Welche Rolle spielt der pitot-statische Druck-Sensor?",
    options: [
      "Misst Treibstoffmenge in den Tanks",
      "Liefert Daten für Fahrtmesser, Höhenmesser und Variometer",
      "Steuert die Mischung automatisch",
      "Liefert nur Wind-Information",
    ],
    correctIndex: 1,
    explanation:
      "Pitot-Statik-System: Pitot-Druck (Staudruck) für Fahrtmesser, statischer Druck für Höhenmesser, Differenz-Veränderung für Variometer (VSI). Vereisung blockiert das System → falsche Anzeigen.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Was bedeutet Avgas 100LL?",
    options: [
      "Diesel mit 100 Cetan",
      "Bleifreier Treibstoff",
      "Aviation gasoline mit 100 Octan, Low-Lead (geringer Bleigehalt)",
      "Reine Schmieröl-Mischung",
    ],
    correctIndex: 2,
    explanation:
      "Avgas 100LL = Aviation Gasoline, 100 Oktan, 'Low-Lead' (im Vergleich zu früherem Avgas 100). Enthält Tetraethylblei für Klopffestigkeit. Blau gefärbt zur Unterscheidung von Mogas (Auto-Benzin).",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Was ist ein typisches Anzeichen für niedrigen Öldruck im Flug?",
    options: [
      "Anzeige unter dem grünen Bereich → sofortige Maßnahme: nächstgelegener Flugplatz, vorbereitete Außenlandung erwägen",
      "Vibrationen im Steuer",
      "Erhöhte Cabin-Heat-Temperatur",
      "Kein Effekt im Flug",
    ],
    correctIndex: 0,
    explanation:
      "Niedriger Öldruck → Risiko von Lagerversagen → Triebwerksausfall innerhalb weniger Minuten. Sofort: Power reduzieren wenn möglich, nächsten geeigneten Flugplatz anfliegen, Notruf erwägen.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Wozu dient der Heading-Indicator (Kompass-Tochter / DG)?",
    options: [
      "Zeigt magnetische Steuerkurse stabiler als Magnetkompass — muss aber periodisch nachgestellt werden",
      "Zeigt nur GPS-Track",
      "Zeigt Steuerkurs absolut nördlich der Erdrotation",
      "Zeigt nur Wind-Drift",
    ],
    correctIndex: 0,
    explanation:
      "DG = Directional Gyro: kreiselbasiert, immun gegen Beschleunigungs- und Drehfehler des Magnetkompasses. Drift im Mittel ca. 3°/15min → muss periodisch (typ. alle 10-15 min im Reiseflug) gegen den Magnetkompass nachgestellt werden.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Was zeigt der Turn-Coordinator?",
    options: [
      "Nur die Querneigung",
      "Drehrate und Querneigungs-Tendenz, plus Inklinometer (Ball) für 'koordiniert/slip/skid'",
      "Treibstoffstand",
      "Vertikale Geschwindigkeit",
    ],
    correctIndex: 1,
    explanation:
      "Turn-Coordinator zeigt Roll-Rate UND Drehrate (typisch 2 min für 360° = standard rate turn) plus Ball für Querkraft-Koordination. 'Step on the ball' = Pedal in Richtung Ball treten zum koordinieren.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Welcher Schalterstellung im POH ist 'idle cutoff' zugeordnet?",
    options: [
      "Drosselklappe voll geschlossen",
      "Mixture-Hebel ganz nach hinten gezogen — beendet Treibstoff-Zufuhr zum Triebwerk",
      "Master-Switch off",
      "Magneten beide aus",
    ],
    correctIndex: 1,
    explanation:
      "Idle Cutoff = Mixture-Hebel ganz nach hinten / lean. Unterbricht Treibstoff-Zufuhr → Triebwerk geht aus. Standard-Verfahren beim Abstellen des Motors (statt Magneten zu nutzen) damit kein unverbrannter Treibstoff im Zylinder bleibt.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Was passiert wenn beim Tankvorgang der Statik-Druckausgleich (Erdung des Flugzeugs) vergessen wird?",
    options: [
      "Treibstoff fließt langsamer",
      "Risiko von Funkenbildung und Brandgefahr durch elektrostatische Aufladung",
      "Tank füllt sich nicht vollständig",
      "Keine messbare Auswirkung",
    ],
    correctIndex: 1,
    explanation:
      "Beim Betanken kann sich elektrostatische Ladung zwischen Flugzeug, Tankfahrzeug und Boden aufbauen. Funkenbildung beim Lösen der Klemmen kann den Treibstoffdampf entzünden. Daher: Erdungskabel zuerst anschließen, zuletzt entfernen.",
  },
  {
    licenseType: "PPL",
    category: "SYSTEMS",
    questionText:
      "Was bedeutet die ELT (Emergency Locator Transmitter)?",
    options: [
      "Notlandungs-Tacho",
      "Notsender, der bei Crash automatisch auf 121,5 / 406 MHz funkt",
      "Elektronisches Logbuch",
      "Lande-Light-Schalter",
    ],
    correctIndex: 1,
    explanation:
      "ELT = automatischer Notsender, der bei harter Landung/Crash via G-Sensor aktiviert wird und auf 121,5 MHz (analog) und 406 MHz (digital, satellitengeführt mit Position) sendet. Cospas-Sarsat lokalisiert das Flugzeug innerhalb weniger Minuten.",
  },
];
