import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  prisma,
  formatVamCurrency,
  getUserWalletExtended,
  getUserTransactions,
  type GetUserTransactionsOptions,
  type TransactionType,
} from "@vam/db";
import Link from "next/link";
import {
  TRANSACTION_TYPE_DISPLAY,
  CATEGORY_BADGE_CLASSES,
  TRANSACTION_TYPES_GROUPED,
  TRANSACTION_TYPES_BY_CATEGORY,
  type TransactionCategory,
} from "./tx-display";

const PAGE_SIZE = 25;

interface PageProps {
  // Next.js 16 / React 19: searchParams ist ein Promise. Muss awaited
  // werden bevor die werte verwendet werden können.
  searchParams: Promise<{
    page?: string;
    type?: string;
    /**
     * Date-from filter (option #27). Erwarteter format: YYYY-MM-DD.
     * Wird als UTC-midnight geparst, gte gegen createdAt.
     */
    from?: string;
    /**
     * Date-to filter (option #27). Erwarteter format: YYYY-MM-DD.
     * Wird als UTC-midnight + 24h geparst (also "before midnight of
     * next day"), so dass `to=2026-05-09` den 2026-05-09 inklusive
     * enthält. Lt gegen createdAt (siehe getUserTransactions semantik).
     */
    to?: string;
    /**
     * Category-filter (option #28). Einer von "revenue" | "expense" |
     * "transfer" | "system". Wird via TRANSACTION_TYPES_BY_CATEGORY zu
     * einer type-array expandiert und als Prisma `IN`-clause gefilterted.
     * Wenn `type` gleichzeitig gesetzt ist, gewinnt `type` (spezifischer).
     */
    cat?: string;
  }>;
}

/**
 * Welle 13D-3 — pilot wallet-page.
 *
 * Zeigt:
 *   - Stats-bar oben: aktueller balance + diesen-monats revenue/expenses/net
 *   - Filter-bar: type-dropdown (form GET → URL-params, kein client-state)
 *   - Tx-history-tabelle: paginierte liste der transactions des users
 *
 * Gating: nur erreichbar wenn user.economyEnabled && airline.economyEnabled.
 * Direkter URL-aufruf bei deaktivierten flags → redirect auf /settings#profile
 * mit der EconomyCard, damit der user die opt-in-toggles findet.
 *
 * URL-state-pattern: pagination + filter via querystring (?page=2&type=REVENUE_PASSENGER).
 * Form mit method=get + button submit ist die simpelste implementation —
 * kein client-component, kein router.push, browser-back funktioniert
 * natürlich. Trade-off: jeder filter-change ist ein full-page-reload,
 * aber das ist akzeptabel für eine list-page mit wenig sonstigem state.
 */
export default async function WalletPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: { select: { economyEnabled: true } } },
  });

  if (!user) {
    redirect("/");
  }

  // Gating-check: beide flags müssen ON sein. Wenn nicht, redirect zur
  // /settings-EconomyCard wo der user die toggles findet. Wir geben
  // keinen 403 zurück weil das aus user-sicht eher "feature noch nicht
  // aktiviert" ist als "verboten" — der redirect zeigt direkt den weg
  // zur aktivierung.
  const showWallet = !!(user.economyEnabled && user.airline?.economyEnabled);
  if (!showWallet) {
    redirect("/settings#profile");
  }

  // Search-params parsen. Next 16: muss awaited werden.
  const params = await searchParams;
  const pageNum = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const skip = (pageNum - 1) * PAGE_SIZE;

  // Type-filter: validate dass der string ein gültiger TransactionType ist,
  // sonst ignorieren (URL-tampering safety + besseres UX wenn ein bookmark
  // mit altem enum-wert kommt).
  const rawType = params.type;
  const typeFilter: TransactionType | undefined =
    rawType && rawType in TRANSACTION_TYPE_DISPLAY
      ? (rawType as TransactionType)
      : undefined;

  // Category-filter (option #28). Validiert gegen die TransactionCategory-
  // union. Gilt nur wenn KEIN type-filter gesetzt ist (type wins by spec —
  // type ist spezifischer als category, also muss der spezifischere filter
  // gewinnen wenn beide an die DB gehen).
  const rawCat = params.cat;
  const catFilter: TransactionCategory | undefined =
    rawCat && rawCat in TRANSACTION_TYPES_BY_CATEGORY
      ? (rawCat as TransactionCategory)
      : undefined;

  // Date-range-filter (option #27). YYYY-MM-DD im URL, geparst als UTC-
  // midnight. `to` wird auf next-day-midnight verschoben damit der user
  // mit `to=2026-05-09` auch die Transaktionen vom 2026-05-09 selbst
  // mitbekommt (getUserTransactions interpretiert toDate als exklusiv).
  const fromParam = parseIsoDateUtc(params.from);
  const toParam = parseIsoDateUtc(params.to);
  const fromDate = fromParam ?? undefined;
  // Falls toParam gesetzt: +1 Tag damit der ganze Tag inkludiert wird.
  const toDate = toParam
    ? new Date(toParam.getTime() + 86_400_000)
    : undefined;

  // Effective-type-filter für die DB-query: typeFilter (single, exact)
  // hat precedence — wenn gesetzt, ignorier die category. Sonst: cat zu
  // type-array expandieren via TRANSACTION_TYPES_BY_CATEGORY und an
  // getUserTransactions als IN-clause durchreichen (option #28).
  const effectiveType: TransactionType | TransactionType[] | undefined =
    typeFilter ??
    (catFilter ? TRANSACTION_TYPES_BY_CATEGORY[catFilter] : undefined);

  // Parallele queries: stats + tx-list. getUserWalletExtended hat schon
  // die wallet-existenz-prüfung (returnt zeros wenn !hasWallet) und
  // getUserTransactions auch (returnt rows=[] wenn !hasWallet).
  const txOptions: GetUserTransactionsOptions = {
    skip,
    take: PAGE_SIZE,
    type: effectiveType,
    fromDate,
    toDate,
  };
  const [stats, txList] = await Promise.all([
    getUserWalletExtended(user.id),
    getUserTransactions(user.id, txOptions),
  ]);

  const totalPages = Math.max(1, Math.ceil(txList.totalCount / PAGE_SIZE));
  const hasNextPage = pageNum < totalPages;
  const hasPrevPage = pageNum > 1;
  const hasAnyFilter =
    typeFilter !== undefined ||
    catFilter !== undefined ||
    fromParam !== null ||
    toParam !== null;

  // Active-filter-state für das filter-bag (URL-builder + reset-button).
  const filters: WalletFilters = {
    type: typeFilter,
    cat: catFilter,
    from: fromParam ? params.from! : undefined,
    to: toParam ? params.to! : undefined,
  };

  // Active-Category für die Chip-Highlight-state (option #28). Wenn
  // ein spezifischer typeFilter aktiv ist, leitet sich category aus
  // TRANSACTION_TYPE_DISPLAY[type].category ab (visualer hint, dass
  // ein category-chip implizit aktiv ist via type). Sonst direkt aus
  // catFilter. Sonst "all".
  const activeCategory: TransactionCategory | "all" = typeFilter
    ? TRANSACTION_TYPE_DISPLAY[typeFilter].category
    : (catFilter ?? "all");

  // Preset-URLs für die Quick-Range-pills (option #27). Computed once
  // in UTC weil die DB ebenfalls in UTC arbeitet — see the toplevel
  // doctring on timezone-konvention im queries-modul. activePreset
  // wird via deep-compare gegen filters.from/to bestimmt.
  const presets = computeDatePresets();
  const activePreset = detectActivePreset(filters.from, filters.to, presets);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold">Wallet</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
            Balance, Salary, Revenue und Expenses — alles im überblick.
          </p>
        </header>

        {/* Stats-bar mit 4 cards. tabular-nums in den großen zahlen damit
            die digits in einer column visuell aligned sind (sieht ohne
            tabular-nums merkwürdig aus weil proportional-fonts unterschiedlich-
            breite digits haben). */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Balance"
            value={formatVamCurrency(stats.balance)}
            tone="neutral"
          />
          <StatCard
            label="Revenue (Monat)"
            value={formatVamCurrency(stats.monthRevenue)}
            tone="revenue"
          />
          <StatCard
            label="Expenses (Monat)"
            value={formatVamCurrency(stats.monthExpenses)}
            tone="expense"
          />
          <StatCard
            label="Net (Monat)"
            value={formatVamCurrency(stats.monthNet)}
            tone={
              stats.monthNet.gt(0)
                ? "revenue"
                : stats.monthNet.lt(0)
                  ? "expense"
                  : "neutral"
            }
          />
        </div>

        {/* Filter + pagination-row. form mit method=get und einer hidden
            "action"-route → submit baut neue URL mit ?type=X&page=1.
            Beim type-wechsel resetten wir page auf 1 (weil filter ändert
            den result-set), deshalb kein hidden page-input — einfach
            weglassen → defaults zu 1.

            Weshalb form statt onChange-handler: form mit method=get
            funktioniert ohne JS und ist progressive-enhancement-ready.
            Server-side zu rendern ist dadurch trivial.

            Filter-layout (option #27): Quick-Range-pills oben (preset-
            ranges als Links), darunter die custom-form mit type-dropdown
            und date-from/to-inputs. So sehen pilots häufige zeiträume
            mit einem klick und können trotzdem custom-werte eintragen. */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 mb-4 space-y-4">
          {/* Category-Chips (option #28). Höchste filter-ebene: revenue/
              expense/transfer/system + "Alle". Klick auf chip setzt cat=X
              im URL und löscht den spezifischen type-filter (chip vs
              dropdown sind mutual-exclusive: type ist spezifischer und
              würde sonst die category implicit überschreiben). "Alle"
              löscht beide. activeCategory ist via typeFilter→category
              herleitbar wenn der user eine spezifische type ausgewählt
              hat — der chip leuchtet dann auch (visualer hint). */}
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Kategorie
            </p>
            <div className="flex flex-wrap gap-2">
              <PresetPill
                label="Alle"
                href={buildFilterUrl({
                  ...filters,
                  type: undefined,
                  cat: undefined,
                })}
                active={activeCategory === "all"}
              />
              <PresetPill
                label="Revenue"
                href={buildFilterUrl({
                  ...filters,
                  type: undefined,
                  cat: "revenue",
                })}
                active={activeCategory === "revenue"}
              />
              <PresetPill
                label="Expenses"
                href={buildFilterUrl({
                  ...filters,
                  type: undefined,
                  cat: "expense",
                })}
                active={activeCategory === "expense"}
              />
              <PresetPill
                label="Transfers"
                href={buildFilterUrl({
                  ...filters,
                  type: undefined,
                  cat: "transfer",
                })}
                active={activeCategory === "transfer"}
              />
              <PresetPill
                label="System"
                href={buildFilterUrl({
                  ...filters,
                  type: undefined,
                  cat: "system",
                })}
                active={activeCategory === "system"}
              />
            </div>
          </div>

          {/* Preset-pills (option #27). Aktive preset bekommt indigo-bg,
              inaktive haben gray-bg. "Alles" ist ein reset-link der die
              date-params raus nimmt aber type behält (kein wallet-reset). */}
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Zeitraum
            </p>
            <div className="flex flex-wrap gap-2">
              <PresetPill
                label="Alles"
                href={buildFilterUrl({ ...filters, from: undefined, to: undefined })}
                active={activePreset === "all"}
              />
              {presets.map((p) => (
                <PresetPill
                  key={p.key}
                  label={p.label}
                  href={buildFilterUrl({
                    ...filters,
                    from: p.from,
                    to: p.to,
                  })}
                  active={activePreset === p.key}
                />
              ))}
            </div>
          </div>

          {/* Custom-form: type-dropdown + date-from/to + filter-button.
              Method=get → form-submit baut URL mit allen feldern. */}
          <form method="get" className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label
                htmlFor="type-filter"
                className="block text-xs uppercase tracking-wider text-gray-500 mb-1"
              >
                Typ
              </label>
              <select
                id="type-filter"
                name="type"
                defaultValue={typeFilter ?? ""}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
              >
                <option value="">Alle typen</option>
                {TRANSACTION_TYPES_GROUPED.map((t) => (
                  <option key={t} value={t}>
                    {TRANSACTION_TYPE_DISPLAY[t].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[140px]">
              <label
                htmlFor="from-filter"
                className="block text-xs uppercase tracking-wider text-gray-500 mb-1"
              >
                Von
              </label>
              <input
                type="date"
                id="from-filter"
                name="from"
                defaultValue={filters.from ?? ""}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
              />
            </div>
            <div className="min-w-[140px]">
              <label
                htmlFor="to-filter"
                className="block text-xs uppercase tracking-wider text-gray-500 mb-1"
              >
                Bis
              </label>
              <input
                type="date"
                id="to-filter"
                name="to"
                defaultValue={filters.to ?? ""}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition"
            >
              Filtern
            </button>
            {hasAnyFilter && (
              <Link
                href="/wallet"
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm transition"
              >
                Reset
              </Link>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400 ml-auto">
              {txList.totalCount === 1
                ? "1 Eintrag"
                : `${txList.totalCount} Einträge`}
            </p>
          </form>
        </div>

        {/* Tx-list. Empty-state wenn kein wallet (frisch-aktiviert) oder
            wenn filter nichts findet. Die unterscheidung ist wichtig für
            UX: bei !stats.hasWallet ist's "noch keine flüge gehabt", bei
            stats.hasWallet && rows.length === 0 ist's "filter zu eng". */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          {txList.rows.length === 0 ? (
            <EmptyState
              hasWallet={stats.hasWallet}
              filtered={hasAnyFilter}
            />
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-gray-500 font-medium">
                      Datum
                    </th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-gray-500 font-medium">
                      Typ
                    </th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-gray-500 font-medium">
                      Beschreibung
                    </th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-gray-500 font-medium">
                      Betrag
                    </th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-gray-500 font-medium hidden md:table-cell">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {txList.rows.map((tx) => {
                    const display = TRANSACTION_TYPE_DISPLAY[tx.type];
                    const badgeClasses = CATEGORY_BADGE_CLASSES[display.category];
                    const amountIsPositive = tx.amount.gt(0);
                    const amountClass = amountIsPositive
                      ? "text-green-600 dark:text-green-400"
                      : tx.amount.lt(0)
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-500";
                    // Display-amount: amount selbst incl. vorzeichen rendern
                    // — anders als bei der month-stats-card hier WOLLEN wir
                    // das vorzeichen sehen weil es der inflow/outflow-richtung
                    // entspricht und für audit-trail-quality wichtig ist.
                    const amountStr = `${amountIsPositive ? "+" : ""}${formatVamCurrency(
                      tx.amount,
                    )}`;
                    // Datum-format: nur datum, keine uhrzeit (sonst sieht
                    // die liste zu busy aus). User kann auf den row für
                    // PIREP-detail clicken wenn er mehr context will.
                    const dateStr = new Intl.DateTimeFormat("de-DE", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(tx.createdAt);

                    return (
                      <tr
                        key={tx.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition"
                      >
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {dateStr}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${badgeClasses}`}
                          >
                            {display.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                          {tx.pirepId ? (
                            <Link
                              href={`/pireps/${tx.pirepId}`}
                              className="hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                            >
                              {tx.description}
                            </Link>
                          ) : (
                            tx.description
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${amountClass}`}
                        >
                          {amountStr}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-500 tabular-nums hidden md:table-cell">
                          {formatVamCurrency(tx.balanceAfter)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination. Nur zeigen wenn mehr als eine seite. Page-
                  numerierung 1-based für UI (← prev / Seite X von Y / next →),
                  intern via skip = (page-1)*PAGE_SIZE.
                  Filter-state (type + from + to) wird in den prev/next-URLs
                  über buildFilterUrl(filters, page) erhalten. */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
                  <PaginationLink
                    href={buildFilterUrl(filters, pageNum - 1)}
                    disabled={!hasPrevPage}
                    label="← Zurück"
                  />
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Seite {pageNum} von {totalPages}
                  </p>
                  <PaginationLink
                    href={buildFilterUrl(filters, pageNum + 1)}
                    disabled={!hasNextPage}
                    label="Weiter →"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  tone: "neutral" | "revenue" | "expense";
}

function StatCard({ label, value, tone }: StatCardProps) {
  // eslint-disable-next-line no-nested-ternary
  const valueColor =
    tone === "revenue"
      ? "text-green-600 dark:text-green-400"
      : tone === "expense"
        ? "text-red-600 dark:text-red-400"
        : "text-gray-900 dark:text-white";

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
      <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}

function EmptyState({
  hasWallet,
  filtered,
}: {
  hasWallet: boolean;
  filtered: boolean;
}) {
  if (!hasWallet) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-3xl mb-3">💰</p>
        <p className="text-base font-semibold mb-2">Noch keine Transaktionen</p>
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          Dein Wallet wird beim nächsten approved PIREP automatisch erstellt.
          Salary, Revenue und Expenses werden ab dann hier erscheinen.
        </p>
        <Link
          href="/pireps/new"
          className="inline-block mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition"
        >
          Flug einreichen →
        </Link>
      </div>
    );
  }

  if (filtered) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-base font-semibold mb-2">
          Keine Treffer mit diesem Filter
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Versuch einen anderen typ oder{" "}
          <Link
            href="/wallet"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            zeig alle
          </Link>
          .
        </p>
      </div>
    );
  }

  // Theoretisch unerreichbar (hasWallet=true bedeutet mindestens eine tx
  // existiert), aber defensive: zeig generic empty.
  return (
    <div className="px-6 py-12 text-center text-gray-500">
      Keine Transaktionen vorhanden.
    </div>
  );
}

interface PaginationLinkProps {
  href: string;
  disabled: boolean;
  label: string;
}

function PaginationLink({ href, disabled, label }: PaginationLinkProps) {
  if (disabled) {
    return (
      <span className="px-3 py-1 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="px-3 py-1 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded transition"
    >
      {label}
    </Link>
  );
}

/**
 * Filter-bag für die Wallet-page (option #27).
 *
 * Type, from, to als string-fields (raw URL-form, vor Parsing zu Date).
 * URL-builder akzeptieren diese shape direkt — convenient weil die
 * params 1:1 als querystring-segmente serialisiert werden können ohne
 * jedes mal Date.toISOString().slice(0,10) aufzurufen.
 */
interface WalletFilters {
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
interface DatePreset {
  key: string;
  label: string;
  from: string;
  to: string;
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
 * docstring im queries-modul. Browsing/UI darf das in lokaler-zeit
 * formatieren, aber DB-vergleich ist UTC.
 */
function parseIsoDateUtc(s: string | undefined): Date | null {
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
function computeDatePresets(): DatePreset[] {
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
function detectActivePreset(
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
 * URL-builder für pagination + filter-links (option #27).
 *
 * Nimmt die filter-bag und einen optional page-number. Skipped page=1
 * (defaults zu 1) und alle undefined fields, damit die URL kompakt
 * bleibt. Type wird als string serialisiert weil URLSearchParams
 * sowieso strings expects.
 *
 * Empty querystring → "/wallet" ohne trailing "?", für saubere URLs.
 */
function buildFilterUrl(filters: WalletFilters, page = 1): string {
  const sp = new URLSearchParams();
  if (page > 1) sp.set("page", String(page));
  if (filters.type) sp.set("type", filters.type);
  if (filters.cat) sp.set("cat", filters.cat);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  const qs = sp.toString();
  return qs ? `/wallet?${qs}` : "/wallet";
}

/**
 * Preset-pill für die Quick-Range-row (option #27).
 *
 * Active = indigo-bg + white text (deutlich hervorgehoben), inactive
 * = neutral gray-bg. Plain-link ohne JS, browser-back-friendly.
 */
function PresetPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  const classes = active
    ? "bg-indigo-600 text-white border-indigo-600"
    : "bg-gray-50 dark:bg-gray-950 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500";
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${classes}`}
    >
      {label}
    </Link>
  );
}
