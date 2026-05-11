/**
 * Track 4 #81 (Section P) — Notification-Preferences types + helpers.
 *
 * Shapes + defaults für `User.notificationPrefs` (Json column added in
 * migration 20260511074547_add_user_notification_prefs).
 *
 * # Persistierte struktur
 *
 * Json-blob mit shape:
 *
 *   {
 *     [category: NotificationCategory]: {
 *       inApp?: boolean;
 *       email?: boolean;
 *     }
 *   }
 *
 * Beispiel:
 *
 *   {
 *     "pirepDecision":   { "inApp": true, "email": true },
 *     "pirepKudos":      { "inApp": true, "email": false },
 *     "bookingReminder": { "inApp": true },           // email defaults to false
 *     // andere categories: missing → defaults greifen
 *   }
 *
 * # Defaults
 *
 * Wenn das ganze field NULL ist (legacy user, fresh signup) ODER eine
 * category fehlt ODER ein channel fehlt:
 *   - inApp: true   (opt-out — meiste user wollen in-app benachrichtigt
 *     werden, sonst hätten sie das feature nicht installiert)
 *   - email: false  (opt-in — email ist intrusiver, default-aus respektiert
 *     user-zeit; entspricht GDPR-recommended-pattern für non-essential
 *     communication)
 *
 * # Why nicht enum für category?
 *
 * Categories sind im app-layer mit `as const`-array typisiert. Würde man
 * einen Prisma-enum nutzen, müsste jede neue category eine migration sein.
 * Mit string-union + Json kann ein future-PR (z.B. "addieren wir
 * `flightSchoolReminder`") rein additiv erfolgen — alte rows funktionieren
 * weiter, der neue key bekommt einfach defaults bis user ihn setzt.
 */

// ─────────────────────────────────────────────────────────────────────────
// Type-level surface
// ─────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES = [
  'pirepDecision',
  'pirepKudos',
  'bookingReminder',
  'eventReminder',
  'promotion',
  'adminBroadcast',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ['inApp', 'email'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Partial-mapping: jede category darf fehlen, jeder channel innerhalb einer
 * category darf fehlen — defaults greifen via `getPref()`.
 */
export type NotificationPrefs = Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
>;

// ─────────────────────────────────────────────────────────────────────────
// Display-metadata (german, app-facing)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pro category: human-readable label + ein-satz-erklärung. Wird auf der
 * `/settings/notifications`-page in der tabellen-spalte links angezeigt.
 *
 * Reihenfolge entspricht NOTIFICATION_CATEGORIES (oben). Wenn neue
 * categories dazukommen, BEIDE arrays + dieses object updaten.
 */
export const CATEGORY_LABELS: Record<
  NotificationCategory,
  { label: string; description: string; icon: string }
> = {
  pirepDecision: {
    label: 'PIREP-Entscheidung',
    description:
      'Wenn ein Admin deinen PIREP genehmigt oder ablehnt (mit Begründung).',
    icon: '✅',
  },
  pirepKudos: {
    label: 'PIREP-Kudos',
    description:
      'Wenn ein anderer Pilot dir Kudos 👏 für einen deiner PIREPs gibt.',
    icon: '👏',
  },
  bookingReminder: {
    label: 'Booking-Reminder',
    description:
      '24h vor dem geplanten Abflug deiner gebuchten Strecke (sofern departure-time gesetzt).',
    icon: '🛫',
  },
  eventReminder: {
    label: 'Event-Reminder',
    description:
      'Am Tag eines Events an dem du teilnimmst — Tour, Group-Flight, Saison-Event.',
    icon: '📅',
  },
  promotion: {
    label: 'Beförderung',
    description:
      'Wenn du im Career-Mode einen neuen Rank erreichst (Hours + Licenses erfüllt).',
    icon: '🎖️',
  },
  adminBroadcast: {
    label: 'Admin-Broadcasts',
    description:
      'System-weite Ansagen vom Airline-Admin (Wartung, neue Features, Saison-Updates).',
    icon: '📢',
  },
};

/**
 * Pro channel: human-readable label + status-info. Email ist aktuell
 * "Coming soon" weil die email-dispatch-infrastructure in #82 ankommt.
 */
export const CHANNEL_LABELS: Record<
  NotificationChannel,
  { label: string; shortLabel: string; status: 'available' | 'coming_soon' }
> = {
  inApp: {
    label: 'In-App-Benachrichtigung',
    shortLabel: 'In-App',
    status: 'available',
  },
  email: {
    label: 'Email-Benachrichtigung',
    shortLabel: 'Email',
    // Track 4 #82 (Section P): Email-dispatch ist jetzt live über
    // `apps/web/lib/email/` (resend-basiert, mit silent-no-op-fallback
    // wenn RESEND_API_KEY nicht gesetzt ist). Wir flippen den status
    // auf 'available'; das UI zeigt jetzt die toggles ohne "bald"-badge.
    // Falls der admin keine API-key konfiguriert, sendet nichts raus,
    // aber die prefs werden gespeichert + UI ist konsistent.
    status: 'available',
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Defaults (eine source-of-truth für RSC + client)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pro channel: default-wert wenn user noch nichts gesetzt hat. Wird in
 * `getPref()` benutzt + ist exportiert damit UI-toggles ihre initial-states
 * darstellen können wenn `prefs` null ist.
 */
export const DEFAULT_CHANNEL_VALUES: Record<NotificationChannel, boolean> = {
  inApp: true,
  email: false,
};

// ─────────────────────────────────────────────────────────────────────────
// Parser — Prisma's Json field ist `unknown` zur runtime, muss safe geparst
// werden bevor wir sie ans UI weiterreichen.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate that an arbitrary Json-value matches the NotificationPrefs shape.
 * Unbekannte categories / channels werden ignoriert (forward-compat: ein
 * future-key der heute noch nicht existiert würde nicht zum throw führen,
 * sondern einfach durchfallen).
 *
 * Returns ein sauberes NotificationPrefs-objekt (nie null — leeres `{}`
 * wenn input invalid/null/missing ist). UI kann immer mit `getPref()`
 * arbeiten ohne null-checks.
 *
 * Nicht-strict: wir akzeptieren extra keys die nicht in unserer
 * category-liste sind (z.B. von einer alten app-version), klippen sie aber
 * weg. Wir akzeptieren nicht-boolean-werte für channels nicht — wenn
 * jemand `inApp: "true"` (string) speichert (sollte unmöglich sein aber
 * DB-corruption etc.), wird der wert ignoriert und der default greift.
 */
export function parsePrefs(raw: unknown): NotificationPrefs {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const result: NotificationPrefs = {};
  const obj = raw as Record<string, unknown>;

  for (const category of NOTIFICATION_CATEGORIES) {
    const categoryValue = obj[category];
    if (
      categoryValue == null ||
      typeof categoryValue !== 'object' ||
      Array.isArray(categoryValue)
    ) {
      continue;
    }

    const channels: Partial<Record<NotificationChannel, boolean>> = {};
    const channelObj = categoryValue as Record<string, unknown>;

    for (const channel of NOTIFICATION_CHANNELS) {
      const channelValue = channelObj[channel];
      if (typeof channelValue === 'boolean') {
        channels[channel] = channelValue;
      }
      // Andere typen werden silently ignoriert — siehe doc-string oben.
    }

    // Nur addieren wenn mindestens ein channel explizit gesetzt ist —
    // sonst ist der eintrag leer und wir lassen ihn weg damit
    // Object.keys(prefs).length die "wirklich gesetzten" categories
    // wiedergibt (z.B. für analytics oder migration-scripts).
    if (Object.keys(channels).length > 0) {
      result[category] = channels;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Public-read helper: get a single pref-value mit default-fallback
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve the effective on/off-value for a (category, channel) pair.
 *
 * Lookup-priorität:
 *   1. prefs[category][channel] wenn explizit gesetzt (boolean)
 *   2. DEFAULT_CHANNEL_VALUES[channel] als fallback
 *
 * Used by:
 *   - UI: initial state der toggles (zeigt was aktuell effective wäre).
 *   - Future #82/server-actions: check `getPref(prefs, 'pirepDecision',
 *     'email')` bevor ein email-dispatch versucht wird.
 *
 * Bewusst symmetrisch zu `setPref` — round-trip-safe: setPref(prefs, c, ch,
 * x) gefolgt von getPref(updatedPrefs, c, ch) gibt x zurück.
 */
export function getPref(
  prefs: NotificationPrefs,
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  const explicit = prefs[category]?.[channel];
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  return DEFAULT_CHANNEL_VALUES[channel];
}

/**
 * Immutable update: produce a new NotificationPrefs with one (category,
 * channel) value flipped. Kept hier statt im server-action damit die
 * client-page optimistic-updates konsistent zu was der server speichern
 * würde rechnen kann.
 */
export function setPref(
  prefs: NotificationPrefs,
  category: NotificationCategory,
  channel: NotificationChannel,
  value: boolean,
): NotificationPrefs {
  return {
    ...prefs,
    [category]: {
      ...(prefs[category] ?? {}),
      [channel]: value,
    },
  };
}
