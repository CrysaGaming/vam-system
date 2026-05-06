import { redirect } from "next/navigation";
import {
  prisma,
  formatVamCurrency,
  getAirlineWalletExtended,
  getAirlineTransactions,
  type GetUserTransactionsOptions,
  type TransactionType,
} from "@vam/db";
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from "next/link";
import {
  TRANSACTION_TYPE_DISPLAY,
  CATEGORY_BADGE_CLASSES,
  TRANSACTION_TYPES_GROUPED,
} from "../../wallet/tx-display";

const PAGE_SIZE = 25;

interface PageProps {
  searchParams: Promise<{
    page?: string;
    type?: string;
  }>;
}

/**
 * Welle 13D-4 — Airline-Finance-Page (admin-only).
 *
 * Spiegelt /wallet aber für die Airline statt für den User. Zeigt
 * operating-account balance, monatliche revenue/expenses/profit, und
 * die volle transaction-history der airline.
 *
 * Gating (3 layers):
 *   1. Auth: redirect '/' wenn keine session.
 *   2. Role: muss AIRLINE_MANAGER_ROLES sein (admin/airline-admin/
 *      instructor) — selbe liste wie in /airline.
 *   3. Economy: airline.economyEnabled muss true sein. Wenn die airline
 *      economy nicht aktiviert hat, redirect zu /airline mit der
 *      economyEnabled-toggle.
 *
 * Reuse: tx-display-helpers (TRANSACTION_TYPE_DISPLAY etc.) kommen aus
 * der /wallet-page — selbe enum, selbe labels, selbe colors. Damit
 * bleibt die UI für pilots und admins konsistent.
 */
export default async function AirlineFinancePage({ searchParams }: PageProps) {
  const user = await requireAirlineManagerWithAirlinePage();
  // Layer 3: airline.economyEnabled. Wenn die airline economy nicht
  // aktiviert hat, ist diese page sinnlos. Redirect zu /airline wo
  // der admin den toggle findet (statt 403 — feature ist nicht
  // verboten sondern nicht aktiviert).
  if (!user.airline.economyEnabled) {
    redirect("/airline");
  }

  const params = await searchParams;
  const pageNum = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const skip = (pageNum - 1) * PAGE_SIZE;

  const rawType = params.type;
  const typeFilter: TransactionType | undefined =
    rawType && rawType in TRANSACTION_TYPE_DISPLAY
      ? (rawType as TransactionType)
      : undefined;

  const txOptions: GetUserTransactionsOptions = {
    skip,
    take: PAGE_SIZE,
    type: typeFilter,
  };
  const [stats, txList] = await Promise.all([
    getAirlineWalletExtended(user.airline.id),
    getAirlineTransactions(user.airline.id, txOptions),
  ]);

  const totalPages = Math.max(1, Math.ceil(txList.totalCount / PAGE_SIZE));
  const hasNextPage = pageNum < totalPages;
  const hasPrevPage = pageNum > 1;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
            <Link
              href="/airline"
              className="hover:text-gray-700 dark:hover:text-gray-300 transition"
            >
              ← Airline-Verwaltung
            </Link>
          </div>
          <h1 className="text-3xl font-bold">Airline-Finanzen</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
            Operating-Account von {user.airline.name} ({user.airline.icao}) —
            balance, Revenue, Expenses und Profit pro Monat.
          </p>
        </header>

        {/* Stats-bar mit 4 cards. Operating-balance prominent oben links,
            dann monats-aggregate. Net statt "Profit" weil die value
            mathematisch revenue-expenses ist und das wort "profit" eine
            geschäftliche bedeutung hat (z.B. nach steuern) die hier
            nicht zutrifft. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Operating Balance"
            value={formatVamCurrency(stats.balance)}
            tone="neutral"
            sublabel={
              stats.creditLimit
                ? `Credit-Limit: ${formatVamCurrency(stats.creditLimit)}`
                : undefined
            }
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
            label="Profit (Monat)"
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
                href="/airline/finance"
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
                    const amountStr = `${amountIsPositive ? "+" : ""}${formatVamCurrency(
                      tx.amount,
                    )}`;
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
  sublabel?: string;
}

function StatCard({ label, value, tone, sublabel }: StatCardProps) {
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
      {sublabel && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
          {sublabel}
        </p>
      )}
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
        <p className="text-3xl mb-3">🏢</p>
        <p className="text-base font-semibold mb-2">
          Operating-Account noch nicht angelegt
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto">
          Beim ersten approved PIREP eines pilots mit aktiviertem Economy-
          Toggle wird automatisch ein operating-wallet mit start-credit-limit
          angelegt. Revenue und Expenses werden ab dann hier sichtbar.
        </p>
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
            href="/airline/finance"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            zeig alle
          </Link>
          .
        </p>
      </div>
    );
  }

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

function buildPageUrl(
  page: number,
  type: TransactionType | undefined,
): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (type) params.set("type", type);
  const qs = params.toString();
  return qs ? `/airline/finance?${qs}` : "/airline/finance";
}
