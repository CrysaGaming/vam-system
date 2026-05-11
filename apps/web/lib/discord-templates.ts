/**
 * Track 4 #83 (Section P) — Discord-Template-Overrides für airline-bot-embeds.
 *
 * Per-airline overrides für den text-anteil (title + description) der
 * default-embeds die der bot für PIREP/rank/award/event-events postet.
 * Variablen werden über `{placeholder}`-syntax aufgelöst.
 *
 * # Architektur
 *
 *   1. Admin schreibt template-text in /airline-tab (z.B. "✈️ {pilot} hat
 *      {route} in {flightTimeHm} fertiggestellt!")
 *   2. Web speichert raw-strings in Airline.discordTemplates (Json)
 *   3. Beim PIREP-approval lädt approvePirep die airline-templates,
 *      ruft renderForEvent(templates, 'pirepApproved', {pilot, route, ...})
 *   4. Web sendet rendered titleOverride + descriptionOverride im
 *      bot-event-payload
 *   5. Bot baut den embed wie gehabt (color, fields, button) ABER ersetzt
 *      title/description mit den overrides wenn präsent. Wenn nicht
 *      präsent (override=undefined), bleibt der default-text aus dem
 *      bot-handler.
 *
 * # Why title + description (nicht full embed-control)?
 *
 * Embed-builder ist komplex: color, multiple-fields mit inline-layout,
 * action-buttons mit URL/style/emoji, footer, timestamp, thumbnail.
 * Wenn wir das alles templated machen, müsste der admin entweder JSON
 * editieren (UX-hölle) oder ein form mit 20 feldern bedienen.
 *
 * Mit nur title + description bekommt der admin 90% des wert (eigener
 * "voice"/ton der airline) mit 5% der complexity. Restliche embed-
 * elemente bleiben konsistent zwischen airlines.
 *
 * # Why per-category type-restriction?
 *
 * Jede category hat andere available-variables. {reason} macht nur bei
 * pirepRejected sinn, {oldRank}/{newRank} nur bei rankUpgraded. Eine
 * gemeinsame variable-map wäre lazy + verwirrend für den admin (er sieht
 * {reason} im pirepApproved-form aber das wäre immer leer).
 *
 * Lösung: AVAILABLE_VARIABLES exportiert pro category die liste der
 * placeholder + ihre beschreibungen, das UI rendert daraus eine hint-liste
 * neben dem textarea.
 */

import 'server-only';

// ─────────────────────────────────────────────────────────────────────────
// Categories — eine pro bot-event-handler
// ─────────────────────────────────────────────────────────────────────────

export const DISCORD_TEMPLATE_CATEGORIES = [
  'pirepSubmitted',
  'pirepApproved',
  'pirepRejected',
  'rankUpgraded',
  'awardEarned',
  'eventPublished',
] as const;

export type DiscordTemplateCategory = (typeof DISCORD_TEMPLATE_CATEGORIES)[number];

/**
 * Eine template-eintrag pro category. Beide felder optional — wenn weder
 * title noch description gesetzt sind, wird der default-text gerendert
 * (effektiv: leerer override = kein override).
 */
export type DiscordTemplate = {
  title?: string;
  description?: string;
};

export type DiscordTemplates = Partial<Record<DiscordTemplateCategory, DiscordTemplate>>;

// ─────────────────────────────────────────────────────────────────────────
// Available variables pro category (UI hints + render-validation)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pro category: liste der verfügbaren placeholder-variablen + ein-satz-
 * description (für UI-tooltips). Wird im /airline-form als hint-liste
 * neben jedem textarea angezeigt.
 *
 * Beim render wird ein placeholder der NICHT in dieser liste ist NICHT
 * substituiert (bleibt als `{unbekannt}` im output — defensive choice,
 * verhindert dass typos im template silently zu leeren strings werden).
 */
export const AVAILABLE_VARIABLES: Record<
  DiscordTemplateCategory,
  ReadonlyArray<{ name: string; description: string }>
> = {
  pirepSubmitted: [
    { name: 'pilot', description: 'Name des einreichenden piloten' },
    { name: 'flightNumber', description: 'Flugnummer (z.B. NGN901)' },
    { name: 'departure', description: 'Departure ICAO (z.B. EDDF)' },
    { name: 'arrival', description: 'Arrival ICAO (z.B. LOWW)' },
    { name: 'route', description: 'Beide ICAO im format "EDDF → LOWW"' },
    { name: 'flightTimeMin', description: 'Flugzeit in minuten' },
    { name: 'flightTimeHm', description: 'Flugzeit im format "1h 23m"' },
    { name: 'aircraft', description: 'Aircraft type+registration (z.B. "A320 D-AIAB")' },
    { name: 'network', description: 'Network (Offline/VATSIM/IVAO)' },
  ],
  pirepApproved: [
    { name: 'pilot', description: 'Name des piloten dessen PIREP genehmigt wurde' },
    { name: 'flightNumber', description: 'Flugnummer' },
    { name: 'departure', description: 'Departure ICAO' },
    { name: 'arrival', description: 'Arrival ICAO' },
    { name: 'route', description: 'Beide ICAO im format "EDDF → LOWW"' },
    { name: 'approver', description: 'Name des admin der approved hat' },
  ],
  pirepRejected: [
    { name: 'pilot', description: 'Name des piloten dessen PIREP abgelehnt wurde' },
    { name: 'flightNumber', description: 'Flugnummer' },
    { name: 'departure', description: 'Departure ICAO' },
    { name: 'arrival', description: 'Arrival ICAO' },
    { name: 'route', description: 'Beide ICAO im format "EDDF → LOWW"' },
    { name: 'approver', description: 'Name des admin der rejected hat' },
    { name: 'reason', description: 'Ablehnungs-grund (mehrere zeilen möglich)' },
  ],
  rankUpgraded: [
    { name: 'pilot', description: 'Name des piloten der befördert wurde' },
    { name: 'oldRank', description: 'Vorheriger rank' },
    { name: 'newRank', description: 'Neuer rank' },
    { name: 'totalHours', description: 'Gesamt-flugstunden (decimal, z.B. "152.3")' },
  ],
  awardEarned: [
    { name: 'pilot', description: 'Name des piloten der den award bekommen hat' },
    { name: 'awardName', description: 'Name des awards' },
    { name: 'awardDescription', description: 'Beschreibung des awards' },
  ],
  eventPublished: [
    { name: 'eventName', description: 'Name des events' },
    { name: 'eventDate', description: 'Datum + uhrzeit ISO-formatiert' },
    { name: 'organizer', description: 'Name des organisators' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Parser — Json blob aus DB sicher in typed shape verwandeln
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parst rohe Json (aus Airline.discordTemplates) in das typed
 * DiscordTemplates-shape. Unbekannte categories werden silently ignoriert
 * (forward-compat: alte rows können extra-keys von einer früheren version
 * haben, die werden weggeklippt).
 *
 * Returnt immer ein objekt (nie null) — leeres `{}` wenn input invalid/
 * null. Damit kann jeder caller `templates[category]?.title` machen ohne
 * null-check.
 */
export function parseDiscordTemplates(raw: unknown): DiscordTemplates {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const result: DiscordTemplates = {};
  const obj = raw as Record<string, unknown>;

  for (const category of DISCORD_TEMPLATE_CATEGORIES) {
    const value = obj[category];
    if (value == null || typeof value !== 'object' || Array.isArray(value)) continue;

    const inner = value as Record<string, unknown>;
    const template: DiscordTemplate = {};

    if (typeof inner.title === 'string' && inner.title.trim().length > 0) {
      template.title = inner.title;
    }
    if (typeof inner.description === 'string' && inner.description.trim().length > 0) {
      template.description = inner.description;
    }

    // Nur addieren wenn mindestens ein feld gesetzt ist — leere
    // category-objekte werden weggeklippt für sauberere DB-rows.
    if (template.title !== undefined || template.description !== undefined) {
      result[category] = template;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Render-engine
// ─────────────────────────────────────────────────────────────────────────

/**
 * Substituiert `{key}`-placeholder im template-string. Variablen die NICHT
 * im `variables`-object stehen, bleiben als literal `{key}` im output —
 * defensive choice (siehe doc-string von AVAILABLE_VARIABLES). So sieht
 * der admin sofort wenn er einen tippfehler gemacht hat (`{piloy}` statt
 * `{pilot}`) statt mysteriöse leerstellen zu kriegen.
 *
 * Multiple-occurrence: `{pilot} und nochmal {pilot}` wird BEIDE mal
 * substituiert (global-regex). Keine recursion (output kann nicht selbst
 * placeholder enthalten die wieder substituiert werden — würde escape-
 * angriff erlauben wenn user `{evil-template}` als pilot-name speichern
 * kann; defensive wäre dann ein replace-cycle-limit, aber wir bleiben
 * non-recursive für simplicity).
 *
 * Edge-cases:
 *  - Leeres template → leerer string (caller behandelt das vermutlich
 *    als "kein override").
 *  - Placeholder mit whitespace `{ pilot }` matcht NICHT — admin muss
 *    exakt `{pilot}` schreiben.
 *  - Doppelte braces `{{escape}}` ist NICHT supported — vereinfachung,
 *    falls jemand literal `{pilot}` in seinem template will (ist unlikely).
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => {
    if (!(key in variables)) return match; // unknown → keep literal
    const value = variables[key];
    if (value == null) return ''; // null/undefined → empty (different von "fehlt")
    return String(value);
  });
}

/**
 * Helper: gegeben eine category + variables, rendert die admin-templates
 * und gibt `{ titleOverride?, descriptionOverride? }` zurück. Bot-event-
 * payload kann das direkt spreaden.
 *
 * Falls keine templates für die category konfiguriert sind, returnt ein
 * leeres objekt — caller spreaded das ins payload, bot sieht keine
 * override-felder und nutzt defaults. Sauber kein-op-pfad.
 *
 * Falls die category exists aber nur title (oder nur description) gesetzt
 * ist, wird nur diese eine override-property zurückgegeben — bot behält
 * den default für die andere.
 */
export function renderForEvent(
  templates: DiscordTemplates,
  category: DiscordTemplateCategory,
  variables: Record<string, string | number | null | undefined>,
): { titleOverride?: string; descriptionOverride?: string } {
  const template = templates[category];
  if (!template) return {};

  const out: { titleOverride?: string; descriptionOverride?: string } = {};
  if (template.title) {
    const rendered = renderTemplate(template.title, variables);
    if (rendered.trim().length > 0) out.titleOverride = rendered;
  }
  if (template.description) {
    const rendered = renderTemplate(template.description, variables);
    if (rendered.trim().length > 0) out.descriptionOverride = rendered;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Format helper für flightTimeHm placeholder
// ─────────────────────────────────────────────────────────────────────────

/**
 * Formatiert minuten in "Xh Ym" format. 0 → "0h 0m", 75 → "1h 15m",
 * 1440 → "24h 0m" (kein day-rollover, wir bleiben bei stunden).
 *
 * Wird vom dispatcher (z.B. in pireps/actions.ts) genutzt um den
 * flightTimeHm-placeholder zu füllen. Bewusst hier zentralisiert damit
 * alle template-render-sites dasselbe format zeigen.
 */
export function formatFlightTimeHm(minutes: number | null | undefined): string {
  if (minutes == null || minutes < 0) return '0h 0m';
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h}h ${m}m`;
}
