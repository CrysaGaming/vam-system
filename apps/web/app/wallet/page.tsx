import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  prisma,
  Decimal,
  formatVamCurrency,
  getUserWalletExtended,
  getUserTransactions,
  type GetUserTransactionsOptions,
} from "@vam/db";
import Link from "next/link";
import {
  TRANSACTION_TYPE_DISPLAY,
  CATEGORY_BADGE_CLASSES,
  TRANSACTION_TYPES_GROUPED,
  type TransactionCategory,
} from "./tx-display";
import {
  parseWalletFilters,
  computeDatePresets,
  detectActivePreset,
  buildFilterUrl,
} from "./filters";

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

  // Search-params parsen. Next 16: muss awaited werden. Filter-parsing
  // (type, cat, from, to + abgeleiteter effectiveType) lebt in ./filters
  // als shared modul mit der CSV-Export-Route (option #30) damit beide
  // garantiert dieselbe semantik haben.
  const params = await searchParams;
  const pageNum = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const skip = (pageNum - 1) * PAGE_SIZE;
  const {
    typeFilter,
    catFilter,
    effectiveType,
    fromDate,
    toDate,
    hasAnyFilter,
    filters,
  } = parseWalletFilters(params);

  // Parallele queries: stats + tx-list + 6-month-sparkline-data.
  // getUserWalletExtended hat schon die wallet-existenz-prüfung
  // (returnt zeros wenn !hasWallet) und getUserTransactions auch.
  // Sparkline-daten werden über computeSparklineMonths() per parallel-
  // aggregate gefetcht (option #29).
  const txOptions: GetUserTransactionsOptions = {
    skip,
    take: PAGE_SIZE,
    type: effectiveType,
    fromDate,
    toDate,
  };
  const sparklineMonthAnchors = computeSparklineMonths(6);
  const [stats, txList, sparklineData, twitchRevenue] = await Promise.all([
    getUserWalletExtended(user.id),
    getUserTransactions(user.id, txOptions),
    fetchMonthlyNetSeries(user.id, sparklineMonthAnchors),
    // Track 4 #45 (Section H): Twitch-revenue-breakdown. Nur fetchen wenn
    // user Twitch verbunden hat — sonst leere stats. Splittet REVENUE_TICKET_TWITCH
    // (passenger-tickets von twitch-viewern) und REVENUE_STREAM_REWARD
    // (subs/cheers/gifts) damit der user beide income-streams einzeln sieht.
    user.twitchUserId ? fetchTwitchRevenueBreakdown(user.id) : Promise.resolve(null),
  ]);

  const totalPages = Math.max(1, Math.ceil(txList.totalCount / PAGE_SIZE));
  const hasNextPage = pageNum < totalPages;
  const hasPrevPage = pageNum > 1;

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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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

        {/* 6-Monats Net-Trend-Sparkline (option #29). Zeigt monatliche
            net-bewegungen als kleines bar-chart, positive=grün/oben,
            negative=rot/unten. Hilft beim glance ob's gerade besser
            oder schlechter wird. Versteckt für brand-new wallets weil
            6 leere balken keinen mehrwert geben. */}
        {stats.hasWallet && (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800 mb-8">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-xs uppercase tracking-wider text-gray-500">
                Net-Trend (6 Monate)
              </p>
              <p className="text-xs text-gray-400">
                Hover für Details
              </p>
            </div>
            <NetSparkline data={sparklineData} />
          </div>
        )}

        {/* Track 4 #45 (Section H): Twitch-Revenue-Breakdown. Sichtbar wenn
            der user Twitch verbunden hat UND mindestens eine twitch-tx
            existiert (lifetime > 0). Zeigt die zwei revenue-streams
            getrennt: Twitch-Ticket-revenue (passenger-bookings von viewern
            via twitch-event/promo) vs. Stream-Belohnung (subs/cheers/
            gifts/hype_trains direkt von twitch). Plus 30d-aktivität und
            tx-counts pro typ. Purple-toned styling matched twitch-brand. */}
        {twitchRevenue && twitchRevenue.lifetimeTotal.gt(0) && (
          <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/10 rounded-lg p-4 border border-purple-200 dark:border-purple-500/30 mb-8">
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">📺</span>
                <p className="text-xs uppercase tracking-wider text-purple-700 dark:text-purple-300 font-semibold">
                  Twitch-Revenue
                </p>
              </div>
              <p className="text-xs text-purple-600/70 dark:text-purple-400/70">
                Lifetime · letzte 30 Tage
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Twitch-Ticket-revenue (passenger-bookings via twitch). */}
              <TwitchRevenueCard
                label="🎫 Twitch-Tickets"
                lifetime={twitchRevenue.ticketLifetime}
                recent30d={twitchRevenue.ticketRecent30}
                count={twitchRevenue.ticketCount}
                description="Passenger-Bookings via Stream"
              />
              {/* Stream-rewards (subs/cheers/gifts). */}
              <TwitchRevenueCard
                label="💎 Stream-Belohnungen"
                lifetime={twitchRevenue.rewardLifetime}
                recent30d={twitchRevenue.rewardRecent30}
                count={twitchRevenue.rewardCount}
                description="Subs · Cheers · Gifts · Hype-Trains"
              />
            </div>

            <div className="mt-3 pt-3 border-t border-purple-200/50 dark:border-purple-500/20 flex items-baseline justify-between flex-wrap gap-2">
              <p className="text-xs text-purple-700 dark:text-purple-300">
                <strong>Gesamt-Twitch-Revenue:</strong>{' '}
                <span className="font-mono font-bold tabular-nums">
                  {formatVamCurrency(twitchRevenue.lifetimeTotal)}
                </span>
                {twitchRevenue.recent30Total.gt(0) && (
                  <span className="text-purple-600/70 dark:text-purple-400/70 ml-2">
                    · 30d:{' '}
                    <span className="font-mono">
                      {formatVamCurrency(twitchRevenue.recent30Total)}
                    </span>
                  </span>
                )}
              </p>
              <Link
                href={buildFilterUrl({ ...filters, type: undefined, cat: 'revenue', from: undefined, to: undefined })}
                className="text-xs text-purple-700 dark:text-purple-300 hover:underline"
              >
                Alle Revenue-Einträge →
              </Link>
            </div>
          </div>
        )}

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
            {/* CSV-Export-link (option #30). Nutzt buildFilterUrl mit
                /api/wallet/export als basePath, sodass die aktuelle
                filter-view (type/cat/from/to) 1:1 in den download
                übergeht. Plain anchor mit `download`-attribute statt
                <Link>: Next-Link würde client-side-navigation versuchen,
                aber für File-downloads brauchen wir browser-default-
                handling damit der Save-As-dialog kommt.

                Nur sichtbar wenn matches > 0 — leere CSVs sind dem user
                nicht sinnvoll, und der button signalisiert "es gibt was
                zum exportieren". */}
            {txList.totalCount > 0 && (
              <a
                href={buildFilterUrl(filters, 1, "/api/wallet/export")}
                download
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold transition inline-flex items-center gap-1.5"
                title="Aktuelle Ansicht als CSV herunterladen"
              >
                <span aria-hidden="true">📥</span>
                CSV exportieren
              </a>
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
 * Preset-pill für die Quick-Range-row (option #27).
 *
 * Active = indigo-bg + white text (deutlich hervorgehoben), inactive
 * = neutral gray-bg. Plain-link ohne JS, browser-back-friendly.
 *
 * Nur lokal weil kein anderer file (außerhalb der Wallet-page) das
 * gleiche styling braucht. Falls je ein zweiter Konsument auftaucht,
 * nach apps/web/components/ verschieben.
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

// ─────────────────────────────────────────────────────────────────────────
// Net-Sparkline (option #29)
// ─────────────────────────────────────────────────────────────────────────

interface SparklineMonthAnchor {
  /** UTC start des monats (gte). */
  start: Date;
  /** UTC start des nächsten monats (lt). */
  end: Date;
  /** Display-label, z.B. "Mai" für intl-unabhängige rendering. */
  label: string;
  /** Stable identity-key für react. */
  key: string;
}

interface SparklineMonthData extends SparklineMonthAnchor {
  /** Net-amount (revenue - expenses) für diesen monat. Positive=inflow. */
  net: Decimal;
}

const MONTH_LABELS_DE = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

/**
 * Compute month-anchors für die letzten N monate (option #29).
 *
 * Returnt N anchors in chronologischer reihenfolge (oldest first), jeder
 * mit start/end timestamps in UTC und einem display-label. Heutiger
 * monat ist last entry. anchors[i].end = anchors[i+1].start für i<N-1.
 *
 * Beispiel mit N=6 und today=2026-05-09: ["Dez", "Jan", "Feb", "Mär",
 * "Apr", "Mai"] mit korrekten 2025/2026 grenzen.
 */
function computeSparklineMonths(n: number): SparklineMonthAnchor[] {
  const now = new Date();
  const todayY = now.getUTCFullYear();
  const todayM = now.getUTCMonth();

  const anchors: SparklineMonthAnchor[] = [];
  // Iteriere von oldest (n-1 monate zurück) zu newest (heute).
  for (let i = n - 1; i >= 0; i--) {
    const monthOffset = -i;
    // Date.UTC mit out-of-range monaten (z.B. -2) wird automatisch
    // normalisiert auf prev-jahr — JS-quirk der hier praktisch ist.
    const start = new Date(Date.UTC(todayY, todayM + monthOffset, 1));
    const end = new Date(Date.UTC(todayY, todayM + monthOffset + 1, 1));
    const label = MONTH_LABELS_DE[start.getUTCMonth()];
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    anchors.push({ start, end, label, key });
  }
  return anchors;
}

/**
 * Hole net-amounts für 6 monate parallel via prisma.transaction.aggregate
 * (option #29). Pro monat: sum(amount) über alle tx im monat-range.
 *
 * Gating: wenn der user kein wallet hat, returnen wir ein array mit
 * 0-werten — die UI versteckt den sparkline für !hasWallet via stats-
 * check, also wird das ergebnis dann eh nicht gerendert. Trotzdem early-
 * return, damit kein query rausfeuert für leere wallets.
 *
 * Performance: 6 parallel-aggregates auf einem indexed (walletId, createdAt)
 * sind <100ms total. Für 12+ monate würde ich auf raw SQL mit date_trunc
 * umstellen, aber für 6 ist das fine.
 */
async function fetchMonthlyNetSeries(
  userId: string,
  anchors: SparklineMonthAnchor[],
): Promise<SparklineMonthData[]> {
  const wallet = await prisma.wallet.findFirst({
    where: { ownerType: "USER", ownerUserId: userId, walletType: "primary" },
    select: { id: true },
  });
  if (!wallet) {
    return anchors.map((a) => ({ ...a, net: new Decimal(0) }));
  }
  const aggregates = await Promise.all(
    anchors.map((a) =>
      prisma.transaction.aggregate({
        where: {
          walletId: wallet.id,
          createdAt: { gte: a.start, lt: a.end },
        },
        _sum: { amount: true },
      }),
    ),
  );
  return anchors.map((a, i) => ({
    ...a,
    net: aggregates[i]._sum.amount ?? new Decimal(0),
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Twitch-Revenue-Breakdown (Track 4 #45, Section H)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Aggregierte Twitch-revenue-stats pro pilot. Splittet die zwei
 * income-streams (passenger-tickets vs. stream-rewards) und liefert
 * sowohl lifetime-summen als auch 30d-window für ein "trend"-gefühl.
 *
 * Counts sind tx-anzahlen (nicht passenger-anzahlen) — ein einzelner
 * stream-event mit vielen subs ist eine tx. Reicht für die UI um zu
 * zeigen "wie viele events bisher".
 */
interface TwitchRevenueBreakdown {
  ticketLifetime: Decimal;
  ticketRecent30: Decimal;
  ticketCount: number;
  rewardLifetime: Decimal;
  rewardRecent30: Decimal;
  rewardCount: number;
  /** Summe beider streams lifetime — vereinfacht das UI-rendering. */
  lifetimeTotal: Decimal;
  /** Summe beider streams letzten 30 Tage. */
  recent30Total: Decimal;
}

/**
 * Lädt die Twitch-revenue-aggregates für einen user. Sechs parallele
 * aggregates: pro stream (ticket/reward) jeweils lifetime-sum, 30d-sum
 * und count. Wallet-lookup analog zu fetchMonthlyNetSeries — wenn der
 * user noch keine wallet hat, returnen wir zero-werte (UI versteckt
 * die section dann via lifetimeTotal > 0 check).
 *
 * Performance: 6 aggregates parallel auf indexed (walletId, type,
 * createdAt) sind <100ms total. Wir laden bewusst aggregates statt
 * findMany damit auch streamer mit hunderten tx schnell rendern.
 */
async function fetchTwitchRevenueBreakdown(
  userId: string,
): Promise<TwitchRevenueBreakdown> {
  const ZERO: TwitchRevenueBreakdown = {
    ticketLifetime: new Decimal(0),
    ticketRecent30: new Decimal(0),
    ticketCount: 0,
    rewardLifetime: new Decimal(0),
    rewardRecent30: new Decimal(0),
    rewardCount: 0,
    lifetimeTotal: new Decimal(0),
    recent30Total: new Decimal(0),
  };

  const wallet = await prisma.wallet.findFirst({
    where: { ownerType: "USER", ownerUserId: userId, walletType: "primary" },
    select: { id: true },
  });
  if (!wallet) return ZERO;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    ticketLifetimeAgg,
    ticketRecent30Agg,
    rewardLifetimeAgg,
    rewardRecent30Agg,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: { walletId: wallet.id, type: "REVENUE_TICKET_TWITCH" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.transaction.aggregate({
      where: {
        walletId: wallet.id,
        type: "REVENUE_TICKET_TWITCH",
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { walletId: wallet.id, type: "REVENUE_STREAM_REWARD" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.transaction.aggregate({
      where: {
        walletId: wallet.id,
        type: "REVENUE_STREAM_REWARD",
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { amount: true },
    }),
  ]);

  const ticketLifetime = ticketLifetimeAgg._sum.amount ?? new Decimal(0);
  const ticketRecent30 = ticketRecent30Agg._sum.amount ?? new Decimal(0);
  const rewardLifetime = rewardLifetimeAgg._sum.amount ?? new Decimal(0);
  const rewardRecent30 = rewardRecent30Agg._sum.amount ?? new Decimal(0);

  return {
    ticketLifetime,
    ticketRecent30,
    ticketCount: ticketLifetimeAgg._count._all,
    rewardLifetime,
    rewardRecent30,
    rewardCount: rewardLifetimeAgg._count._all,
    lifetimeTotal: ticketLifetime.plus(rewardLifetime),
    recent30Total: ticketRecent30.plus(rewardRecent30),
  };
}

/**
 * Sub-card pro Twitch-revenue-stream (option #45).
 *
 * Zeigt: label + (optional) description, lifetime-amount groß, 30d-amount
 * klein in purple-tint, tx-count rechts. Wenn lifetime=0 ist, zeigt es
 * trotzdem die zero — die parent-card filtert via lifetimeTotal>0, also
 * sehen wir hier nur cards in einer revenue-section wo MINDESTENS einer
 * der beiden streams > 0 ist. Der andere kann legitimerweise 0 sein
 * (z.B. streamer der noch keine ticket-bookings hatte).
 */
function TwitchRevenueCard({
  label,
  lifetime,
  recent30d,
  count,
  description,
}: {
  label: string;
  lifetime: Decimal;
  recent30d: Decimal;
  count: number;
  description: string;
}) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-md p-3 border border-purple-200/40 dark:border-purple-500/20">
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {label}
        </p>
        <p className="text-xs text-purple-600/70 dark:text-purple-400/70 tabular-nums whitespace-nowrap">
          {count === 1 ? "1 Tx" : `${count} Tx`}
        </p>
      </div>
      <p className="text-lg font-bold font-mono tabular-nums text-purple-700 dark:text-purple-300">
        {formatVamCurrency(lifetime)}
      </p>
      {recent30d.gt(0) && (
        <p className="text-xs text-purple-600/70 dark:text-purple-400/70 mt-0.5">
          30d:{" "}
          <span className="font-mono">{formatVamCurrency(recent30d)}</span>
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {description}
      </p>
    </div>
  );
}

/**
 * SVG-Bar-Chart der net-trend-data (option #29).
 *
 * Zeichnet 6 vertikale balken um eine zentrale zero-line. Positive
 * werte gehen nach oben (grün), negative nach unten (rot). Bar-höhe
 * skaliert linear mit |net|/max(|net|). Wenn alle werte 0 sind, zeigen
 * wir nur die zero-line — kein "no-data"-text, da der card-header
 * "Net-Trend" schon klar macht was hier sein sollte.
 *
 * SVG-coordinate-system: viewBox=0 0 600 80. y=40 ist die zero-line.
 * Bars haben max 30px höhe pro richtung, +5px padding zur kante. Each
 * bar in einem 100px-slot mit 24px-breite, zentriert.
 *
 * Tooltip via <title> tag — native browser-tooltip on hover. Inhalt:
 * "{Monat}: +{net}" oder "{Monat}: -{net}". Funktioniert ohne JS.
 */
function NetSparkline({ data }: { data: SparklineMonthData[] }) {
  // Compute max absolute net für skalierung. Decimal.abs() returnt Decimal.
  // Wir rechnen alle in number-space für SVG-koordinaten — Decimal-precision
  // ist hier nicht nötig, geht nur um pixel-positionen.
  const maxAbs = data.reduce((acc, d) => {
    const v = Math.abs(d.net.toNumber());
    return v > acc ? v : acc;
  }, 0);
  // Wenn alle werte 0 sind, kein sinnvoller skalierungs-faktor.
  // Setze maxAbs=1 damit alle bars 0-höhe haben (kein render).
  const safeMax = maxAbs > 0 ? maxAbs : 1;

  const slotWidth = 600 / data.length; // 100px pro slot bei 6 monaten
  const barWidth = 24;
  const zeroY = 40;
  const maxBarHeight = 30;

  return (
    <svg
      viewBox="0 0 600 80"
      className="w-full h-20"
      preserveAspectRatio="none"
      role="img"
      aria-label="Net-Trend der letzten 6 Monate"
    >
      {/* Zero-line — gray-300 / gray-700 in dark. Dünn, nicht aufdringlich. */}
      <line
        x1="0"
        x2="600"
        y1={zeroY}
        y2={zeroY}
        stroke="currentColor"
        strokeWidth="0.5"
        className="text-gray-300 dark:text-gray-700"
      />
      {data.map((d, i) => {
        const netNum = d.net.toNumber();
        const barHeight = (Math.abs(netNum) / safeMax) * maxBarHeight;
        const x = i * slotWidth + (slotWidth - barWidth) / 2;
        // Positive: bar geht von zeroY nach oben (kleinere y-werte).
        // Negative: bar geht von zeroY nach unten.
        const y = netNum >= 0 ? zeroY - barHeight : zeroY;
        const colorClass =
          netNum > 0
            ? "fill-green-500 dark:fill-green-400"
            : netNum < 0
              ? "fill-red-500 dark:fill-red-400"
              : "fill-gray-300 dark:fill-gray-700";
        const sign = netNum > 0 ? "+" : "";
        const tooltip = `${d.label}: ${sign}${formatVamCurrency(d.net)}`;
        return (
          <g key={d.key}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              className={colorClass}
              rx="2"
            >
              <title>{tooltip}</title>
            </rect>
            {/* Month-label below the zero-line, klein und mittig im slot. */}
            <text
              x={i * slotWidth + slotWidth / 2}
              y="76"
              textAnchor="middle"
              className="fill-gray-500 text-[10px]"
              style={{ fontSize: "10px" }}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
