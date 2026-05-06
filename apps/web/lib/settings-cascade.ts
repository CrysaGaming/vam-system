/**
 * Settings-Cascade-Resolver — Track 3 #11.2.5 Foundation-Slice.
 *
 * Generischer N-level cascade-merge für settings-hierarchien. Pattern aus
 * `lib/simbrief/overlay.ts resolveSimBriefOverlay()` extrahiert + auf
 * variadic levels erweitert.
 *
 * # Pattern
 *
 * VAM-Settings folgen typischerweise hierarchien wie:
 *   - System → Airline → User
 *   - Airline → Fleet → Aircraft → Route (SimBrief)
 *   - System → User (z.B. theme-preferences)
 *
 * Der Resolver ist variadic — caller geben so viele levels ein wie ihre
 * domäne braucht. Reihenfolge: lowest-precedence-first → highest-last.
 * Spätere levels gewinnen bei key-konflikten via object-spread.
 *
 * # Spread-Semantik
 *
 * Object-spread enumeriert NUR keys die im jeweiligen level explizit
 * gesetzt sind. Heißt: ein level mit `{ theme: undefined }` (key da, value
 * undefined) WÜRDE downstream-werte überschreiben. Ein level mit `{}`
 * (key fehlt) lässt sie unangetastet. In der praxis nutzen wir nullable
 * felder die entweder den key haben oder nicht — undefined-as-value ist
 * ein anti-pattern für cascade-input, wenn nötig vorher mit
 * `Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined))`
 * filtern.
 *
 * # Warum generisch statt per-domain helpers
 *
 * `resolveSimBriefOverlay()` ist die OG-version, fest auf SimBrief's
 * 4-layer-struktur verdrahtet. Mit weiteren cascading-domains (theme,
 * branding, dispatch-defaults, ...) lohnt eine zentrale typed function
 * statt per-domain-duplikate. SimBrief bleibt zunächst as-is (production-
 * gehärtet), neue cascading-domains nutzen `resolveCascade()`.
 *
 * # Status & Scope
 *
 * Foundation-only — wird in Foundation-Slice noch nicht aufgerufen. Bereit
 * zum drop-in-Einsatz wenn z.B. ein generisches Theme-cascade oder
 * Notification-preferences-cascade kommt. Die SystemSetting/AirlineSetting
 * DB-models aus `docs/vision/admin-dashboards-vision.md` Section 4.3 sind
 * v2 — wenn sie kommen, speisen ihre query-results direkt in diesen
 * resolver ein.
 *
 * @example
 *   // System → Airline → User cascade
 *   const settings = resolveCascade<{ theme: string; locale: string }>(
 *     { theme: 'light', locale: 'en' },  // System default
 *     { theme: 'dark' },                  // Airline override
 *     { locale: 'de' },                   // User override
 *   );
 *   // → { theme: 'dark', locale: 'de' }
 *
 * @example
 *   // Skip-level via null/undefined — z.B. wenn airline-level nicht gefetcht
 *   const settings = resolveCascade<Partial<NotifPrefs>>(
 *     systemDefaults,
 *     null,            // airline ohne overrides
 *     userOverrides,
 *   );
 */
export function resolveCascade<T extends Record<string, unknown>>(
  ...levels: ReadonlyArray<Partial<T> | null | undefined>
): Partial<T> {
  const result: Partial<T> = {};
  for (const level of levels) {
    if (level == null) continue;
    Object.assign(result, level);
  }
  return result;
}

/**
 * Strikte variante des cascade-resolvers — erfordert dass das resultat
 * alle felder von T abdeckt (kein partial). Praktisch wenn ein
 * system-default-level garantiert vollständig ist und nachgelagerte
 * levels nur überschreiben.
 *
 * Caller muss garantieren dass mindestens EIN level alle T-felder setzt
 * — typscript kann das nicht zur compile-time prüfen, deshalb laufzeit-
 * cast via `as T`. Wenn das nicht garantiert ist, lieber `resolveCascade`
 * (Partial<T>) verwenden und nachgelagert validieren.
 *
 * @example
 *   const settings = resolveCascadeStrict<NotifPrefs>(
 *     SYSTEM_DEFAULTS,  // garantiert vollständig
 *     airline?.prefs,
 *     user?.prefs,
 *   );
 *   // typed als NotifPrefs (nicht Partial<NotifPrefs>)
 */
export function resolveCascadeStrict<T extends Record<string, unknown>>(
  base: T,
  ...levels: ReadonlyArray<Partial<T> | null | undefined>
): T {
  return resolveCascade<T>(base, ...levels) as T;
}
