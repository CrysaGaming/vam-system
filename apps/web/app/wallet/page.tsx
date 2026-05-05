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
} from "./tx-display";

const PAGE_SIZE = 25;

interface PageProps {
  // Next.js 16 / React 19: searchParams ist ein Promise. Muss awaited
  // werden bevor die werte verwendet werden können.
  searchParams: Promise<{
    page?: string;
    type?: string;
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

  // Parallele queries: stats + tx-list. getUserWalletExtended hat schon
  // die wallet-existenz-prüfung (returnt zeros wenn !hasWallet) und
  // getUserTransactions auch (returnt rows=[] wenn !hasWallet).
  const txOptions: GetUserTransactionsOptions = {
    skip,
    take: PAGE_SIZE,
    type: typeFilter,
  };
  const [stats, txList] = await Promise.all([
    getUserWalletExtended(user.id),
    getUserTransactions(user.id, txOptions),
  ]);

  const totalPages = Math.max(1, Math.ceil(txList.totalCount / PAGE_SIZE));
  const hasNextPage = pageNum < totalPages;
  const hasPrevPage = pageNum > 1;

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
            Server-side zu rendern ist dadurch trivial. */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 mb-4">
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
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition"
            >
              Filtern
            </button>
            {typeFilter && (
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
              filtered={typeFilter !== undefined}
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
                  Filter-state via type wird in den prev/next-URLs erhalten. */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
                  <PaginationLink
                    href={buildPageUrl(pageNum - 1, typeFilter)}
                    disabled={!hasPrevPage}
                    label="← Zurück"
                  />
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Seite {pageNum} von {totalPages}
                  </p>
                  <PaginationLink
                    href={buildPageUrl(pageNum + 1, typeFilter)}
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
 * URL-builder für pagination-links. Behält den type-filter wenn gesetzt,
 * setzt page nur wenn !=1 (sauberere URLs für die häufigsten cases).
 */
function buildPageUrl(
  page: number,
  type: TransactionType | undefined,
): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (type) params.set("type", type);
  const qs = params.toString();
  return qs ? `/wallet?${qs}` : "/wallet";
}
