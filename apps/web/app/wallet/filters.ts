/**
 * Track 4 #27/#28/#30 — Wallet-Filter-Parsing (shared zwischen page + export-route).
 *
 * Die Wallet-Page (page.tsx) und die CSV-Export-Route (api/wallet/export/route.ts)
 * brauchen identische Filter-Parsing-Semantik damit der Download genau das
 * enthält was der User in der UI sieht. Statt das Parsing zu duplizieren,
 * lebt's hier als single source of truth.
 *
 * Was das modul NICHT macht: die DB-query selbst. Das ist scope der
 * jeweiligen Caller (page nutzt getUserTransactions, route nutzt prisma
 * direkt mit höherem take-cap fürs export).
 */

import {
  type TransactionType,
} from "@vam/db";
import {
  TRANSACTION_TYPE_DISPLAY,
  TRANSACTION_TYPES_BY_CATEGORY,
  type TransactionCategory,
} from "./tx-display";

/**
 * Filter-bag für die Wallet-page (option #27/#28).
 *
 * Type, cat, from, to als string-fields (raw URL-form, vor Parsing zu Date).
 * URL-builder akzeptieren diese shape direkt — convenient weil die
 * params 1:1 als querystring-segmente serialisiert werden können ohne
 * jedes mal Date.toISOString().slice(0,10) aufzurufen.
 */
export interface WalletFilters {
  type?: TransactionType;
  cat?: TransactionCategory;
  from?: string;
  to?: string;
}

/**
 * Date-preset für die Quick-Range-pills (option #27).
 *
 * `key` ist die identity (für `detectActivePreset`), `label` der display-
 * string. `from` und `to` sind YYYY-MM-DD-strings die ohne Re-Parse direkt
 * in die URL gehen.
 */
export interface DatePreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

/**
 * Geparste + validierte Filter, ready für die DB-query (option #27/#28).
 *
 * Die Caller nehmen `effectiveType`/`fromDate`/`toDate` und stecken's in
 * die DB-query, plus `filters` für UI-state und URL-rebuild.
 */
export interface ParsedWalletFilters {
  /** Validierter type-filter aus URL. Undefined wenn nicht gesetzt oder invalid. */
  typeFilter: TransactionType | undefined;
  /** Validierter category-filter aus URL. Undefined wenn nicht gesetzt oder invalid. */
  catFilter: TransactionCategory | undefined;
  /**
   * Effective type für DB-query: typeFilter ist spezifischer und gewinnt
   * wenn beide gesetzt sind. Sonst expandieren wir cat zu type-array via
   * TRANSACTION_TYPES_BY_CATEGORY (für Prisma `IN`-clause).
   */
  effectiveType: TransactionType | TransactionType[] | undefined;
  /** Validiertes from-datum als UTC-midnight Date, oder undefined. */
  fromDate: Date | undefined;
  /**
   * Validiertes to-datum als UTC-midnight + 24h damit der ganze
   * letzte Tag inkludiert ist (lt-semantik der DB-helpers).
   */
  toDate: Date | undefined;
  /** True wenn mindestens ein Filter aktiv ist. */
  hasAnyFilter: boolean;
  /** Original-filter-strings für URL-rebuild + form-defaults. */
  filters: WalletFilters;
}

/**
 * Strict YYYY-MM-DD-parser (option #27). Returnt null bei jedem invaliden
 * input — invalid dates, zu wenig digits, leere strings, undefined.
 *
 * Strict-validation matters weil ein invalid date implicit 1970 oder
 * NaN werden würde, was queries silent verzerrt. Lieber explicit null
 * und der caller ignoriert den filter, als heimlich falsche ranges
 * zu queryen.
 *
 * Alle dates werden als UTC-midnight interpretiert — siehe top-of-file
 * docstring im queries-modul von @vam/db. Browsing/UI darf das in lokaler-
 * zeit formatieren, aber DB-vergleich ist UTC.
 */
export function parseIsoDateUtc(s: string | undefined): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((p) => parseInt(p, 10));
  // Date.UTC validates roughly via getUTC*: invalid dates wie 2026-02-30
  // werden zu 2026-03-02 normalisiert. Wir checken dass nach roundtrip
  // die werte gleich bleiben — sonst ist's ein invalid-date.
  const ts = Date.UTC(y, m - 1, d);
  if (Number.isNaN(ts)) return null;
  const dt = new Date(ts);
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

/**
 * Parse + validate alle Wallet-Filter-Parameter aus einem URL-search-
 * params-objekt (option #27/#28/#30).
 *
 * Akzeptiert sowohl ein plain-Record (z.B. von Next.js page-searchParams)
 * als auch ein URLSearchParams (z.B. von einer route). Hilfreich für
 * cross-component-reuse zwischen page und API-route.
 *
 * Returnt ein vollständig geparsten Bag mit DB-ready Date-objekten,
 * dem effectiveType (single oder array), dem hasAnyFilter-flag und
 * den original-strings (für URL-rebuild).
 */
export function parseWalletFilters(
  raw: Record<string, string | undefined> | URLSearchParams,
): ParsedWalletFilters {
  // Normalize input zu lookup-fn. URLSearchParams.get() returnt null,
  // record-access returnt undefined → beide vereinheitlichen.
  const get = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) {
      return raw.get(key) ?? undefined;
    }
    return raw[key];
  };

  // Type-filter: validate dass der string ein gültiger TransactionType ist,
  // sonst ignorieren (URL-tampering safety + besseres UX wenn ein bookmark
  // mit altem enum-wert kommt).
  const rawType = get("type");
  const typeFilter: TransactionType | undefined =
    rawType && rawType in TRANSACTION_TYPE_DISPLAY
      ? (rawType as TransactionType)
      : undefined;

  // Category-filter (option #28). Validiert gegen die TransactionCategory-
  // union. Gilt nur wenn KEIN type-filter gesetzt ist (type wins by spec —
  // type ist spezifischer als category, also muss der spezifischere filter
  // gewinnen wenn beide an die DB gehen).
  const rawCat = get("cat");
  const catFilter: TransactionCategory | undefined =
    rawCat && rawCat in TRANSACTION_TYPES_BY_CATEGORY
      ? (rawCat as TransactionCategory)
      : undefined;

  // Date-range-filter (option #27). YYYY-MM-DD im URL, geparst als UTC-
  // midnight. `to` wird auf next-day-midnight verschoben damit der user
  // mit `to=2026-05-09` auch die Transaktionen vom 2026-05-09 selbst
  // mitbekommt (DB-helpers interpretieren toDate als exklusiv).
  const fromRaw = get("from");
  const toRaw = get("to");
  const fromParam = parseIsoDateUtc(fromRaw);
  const toParam = parseIsoDateUtc(toRaw);
  const fromDate = fromParam ?? undefined;
  // Falls toParam gesetzt: +1 Tag damit der ganze Tag inkludiert wird.
  const toDate = toParam
    ? new Date(toParam.getTime() + 86_400_000)
    : undefined;

  // Effective-type-filter für die DB-query: typeFilter (single, exact)
  // hat precedence — wenn gesetzt, ignorier die category. Sonst: cat zu
  // type-array expandieren via TRANSACTION_TYPES_BY_CATEGORY und an
  // die DB als IN-clause durchreichen (option #28).
  const effectiveType: TransactionType | TransactionType[] | undefined =
    typeFilter ??
    (catFilter ? TRANSACTION_TYPES_BY_CATEGORY[catFilter] : undefined);

  const hasAnyFilter =
    typeFilter !== undefined ||
    catFilter !== undefined ||
    fromParam !== null ||
    toParam !== null;

  const filters: WalletFilters = {
    type: typeFilter,
    cat: catFilter,
    // Original-strings only wenn das parsing erfolgreich war —
    // garbage-input wird also auch im UI-form-default rausgefiltert.
    from: fromParam ? fromRaw : undefined,
    to: toParam ? toRaw : undefined,
  };

  return {
    typeFilter,
    catFilter,
    effectiveType,
    fromDate,
    toDate,
    hasAnyFilter,
    filters,
  };
}

/**
 * Compute YYYY-MM-DD strings für die 3 standard-presets (option #27):
 * "Diesen Monat" / "Letzter Monat" / "Letzte 30 Tage".
 *
 * Alle UTC-anchored. "Diesen Monat" geht vom 1. des aktuellen monats
 * bis heute (inklusive). "Letzter Monat" 1. des vorigen monats bis
 * letzter tag des vorigen monats. "Letzte 30 Tage" today-29 bis today.
 *
 * Berechnung jedes-render statt cache: günstig (3 Date-konstrukte) und
 * verlässlich beim tagewechsel (server-component re-rendert pro request).
 */
export function computeDatePresets(): DatePreset[] {
  const now = new Date();
  const todayY = now.getUTCFullYear();
  const todayM = now.getUTCMonth();
  const todayD = now.getUTCDate();

  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  // Diesen Monat: 1. → heute
  const thisMonthFrom = new Date(Date.UTC(todayY, todayM, 1));
  const thisMonthTo = new Date(Date.UTC(todayY, todayM, todayD));

  // Letzter Monat: 1. des prev-monats → letzter tag des prev-monats
  const lastMonthFrom = new Date(Date.UTC(todayY, todayM - 1, 1));
  // Letzter tag = day=0 des nächsten monats (getUTCDate auf -1 gibt
  // letzten tag des prev-monats zurück, JS-quirk).
  const lastMonthTo = new Date(Date.UTC(todayY, todayM, 0));

  // Letzte 30 Tage: today-29 → today (= 30 days inclusive)
  const last30From = new Date(Date.UTC(todayY, todayM, todayD - 29));
  const last30To = new Date(Date.UTC(todayY, todayM, todayD));

  return [
    {
      key: "this-month",
      label: "Diesen Monat",
      from: fmt(thisMonthFrom),
      to: fmt(thisMonthTo),
    },
    {
      key: "last-month",
      label: "Letzter Monat",
      from: fmt(lastMonthFrom),
      to: fmt(lastMonthTo),
    },
    {
      key: "last-30-days",
      label: "Letzte 30 Tage",
      from: fmt(last30From),
      to: fmt(last30To),
    },
  ];
}

/**
 * Match die aktiven URL-from/to gegen die known presets (option #27).
 *
 * Returnt "all" wenn beide undefined sind, sonst den preset.key wenn
 * exact-match, sonst null (= custom-range, kein preset highlight).
 *
 * Match ist string-equality auf YYYY-MM-DD — kein date-compare nötig
 * weil presets und URL-werte beide in derselben format sind.
 */
export function detectActivePreset(
  from: string | undefined,
  to: string | undefined,
  presets: DatePreset[],
): string | null {
  if (!from && !to) return "all";
  for (const p of presets) {
    if (p.from === from && p.to === to) return p.key;
  }
  return null;
}

/**
 * URL-builder für pagination + filter-links (option #27/#28).
 *
 * Nimmt die filter-bag und einen optional page-number. Skipped page=1
 * (defaults zu 1) und alle undefined fields, damit die URL kompakt
 * bleibt. Type/cat werden als string serialisiert weil URLSearchParams
 * sowieso strings expects.
 *
 * Optional `basePath`-parameter erlaubt die helper auch für Export-
 * download-links zu nutzen (z.B. "/api/wallet/export"). Default ist
 * "/wallet" für die page selbst.
 *
 * Empty querystring → basePath ohne trailing "?", für saubere URLs.
 */
export function buildFilterUrl(
  filters: WalletFilters,
  page = 1,
  basePath = "/wallet",
): string {
  const sp = new URLSearchParams();
  if (page > 1) sp.set("page", String(page));
  if (filters.type) sp.set("type", filters.type);
  if (filters.cat) sp.set("cat", filters.cat);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
