import {
  getUserLicenses,
  getUserTypeRatings,
  getExpiringLicenses,
  getExpiringTypeRatings,
  getExpiredTypeRatings,
} from "@vam/db";
import Link from "next/link";

interface Props {
  userId: string;
}

/**
 * Dashboard Currency-Check Widget (option #28).
 *
 * Compact full-width banner that mirrors the Currency-Check stat-card
 * from /licenses (option #26), surfaced on the dashboard so pilots see
 * "things you need to renew/refresh" without first navigating to the
 * licenses page. The widget appears above Next-Rank so it sits in the
 * upper attention-zone of the dashboard.
 *
 * # Two states
 *
 * 1. **All current** — subtle green-tinted line: "✓ Alle Lizenzen und
 *    Type-Ratings sind aktuell." Doesn't shout for attention but
 *    confirms the all-good state, same way the /licenses Currency-Check
 *    card does. Links to /licenses anyway in case the pilot wants to
 *    look at details.
 *
 * 2. **Has issues** — amber-tinted alert with the totalIssueCount and
 *    a per-bucket breakdown. Visually heavier than the all-current
 *    state so it draws the eye when something needs action.
 *
 * # Why mirror /licenses logic exactly
 *
 * Both surfaces (this widget + the /licenses page Currency-Check card)
 * count the same things in the same way: licenses expiring in 30d +
 * type-ratings expiring in 60d + already-expired type-ratings + recency-
 * lapsed type-ratings (90-day rule). If the dashboard widget said "0
 * issues" while /licenses said "3", the inconsistency would be a bug.
 * Both pages compute from the same helpers (getExpiringLicenses,
 * getExpiringTypeRatings, getExpiredTypeRatings) and apply the same
 * 90-day recency-cutoff app-layer.
 *
 * # Why server-component (not a client widget polling)
 *
 * The currency state changes only on PIREP-approval (lastFlownAt update)
 * or admin grant/revoke. Neither happens often enough to justify a
 * client-side polling overhead. Server-render-on-page-load is
 * sufficient — the dashboard already triggers a fresh fetch every
 * navigation.
 *
 * # Self-fetched, caller-gated
 *
 * Same pattern as WalletCard: caller (dashboard/page.tsx) checks the
 * dual `careerEnabled` flags (user + airline) and only renders this
 * component when both are ON. The component itself trusts the caller
 * and just fetches currency data — no second flag-check inside.
 */
export async function CurrencyCard({ userId }: Props) {
  // Same parallel fetch as /licenses/page.tsx — five reads, all on
  // indices. Recency-lapsed is computed app-layer below.
  const [
    typeRatings,
    expiringLicenses,
    expiringTypeRatings,
    expiredTypeRatings,
    // We don't actually need allLicenses for the count math, but the
    // helper is cheap and aligns with /licenses.tsx's data-shape if we
    // ever want to surface license-counts here too. Skipped for now.
  ] = await Promise.all([
    getUserTypeRatings(userId),
    getExpiringLicenses(userId, 30),
    getExpiringTypeRatings(userId, 60),
    getExpiredTypeRatings(userId),
    getUserLicenses(userId),
  ]);

  // 90-day recency check — exact same logic as /licenses/page.tsx.
  // Excluded: ratings already in expiredTypeRatings (don't double-count)
  // and ratings without a lastFlownAt (never flown = no baseline yet).
  const recencyCutoff = new Date(Date.now() - 90 * 86_400_000);
  const expiredIds = new Set(expiredTypeRatings.map((tr) => tr.id));
  const recencyLapsedTypeRatings = typeRatings.filter(
    (tr) =>
      !expiredIds.has(tr.id) &&
      tr.lastFlownAt !== null &&
      tr.lastFlownAt < recencyCutoff,
  );

  const totalIssueCount =
    expiringLicenses.length +
    expiringTypeRatings.length +
    expiredTypeRatings.length +
    recencyLapsedTypeRatings.length;

  // All-current state — subtle green strip. Still clickable so the
  // pilot can audit the page if they want.
  if (totalIssueCount === 0) {
    return (
      <Link
        href="/licenses"
        className="block mt-6 px-4 py-3 rounded-lg border bg-green-500/5 dark:bg-green-500/10 border-green-500/20 dark:border-green-500/30 hover:bg-green-500/10 dark:hover:bg-green-500/15 transition"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-lg" aria-hidden="true">✓</span>
            <span className="text-green-700 dark:text-green-300 font-medium">
              Alle Lizenzen und Type-Ratings sind aktuell
            </span>
          </div>
          <span className="text-xs text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 transition">
            Details →
          </span>
        </div>
      </Link>
    );
  }

  // Has-issues state — amber alert with per-bucket breakdown. The
  // breakdown is inline (not a list) because we want compactness on
  // the dashboard. Pilots who want the per-row drill-down click through
  // to /licenses where the warning-banner has the full sub-lists.
  const breakdownParts: string[] = [];
  if (expiringLicenses.length > 0) {
    breakdownParts.push(
      `${expiringLicenses.length} ${expiringLicenses.length === 1 ? "Lizenz" : "Lizenzen"} bald ablaufend`,
    );
  }
  if (expiringTypeRatings.length > 0) {
    breakdownParts.push(
      `${expiringTypeRatings.length} ${expiringTypeRatings.length === 1 ? "Type-Rating" : "Type-Ratings"} bald ablaufend`,
    );
  }
  if (expiredTypeRatings.length > 0) {
    breakdownParts.push(
      `${expiredTypeRatings.length} ${expiredTypeRatings.length === 1 ? "Type-Rating" : "Type-Ratings"} abgelaufen`,
    );
  }
  if (recencyLapsedTypeRatings.length > 0) {
    breakdownParts.push(`${recencyLapsedTypeRatings.length} recency lapsed`);
  }
  const breakdown = breakdownParts.join(" · ");

  return (
    <Link
      href="/licenses"
      className="block mt-6 px-4 py-3 rounded-lg border bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/30 dark:border-amber-500/40 hover:bg-amber-500/15 dark:hover:bg-amber-500/20 transition"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 text-sm flex-1 min-w-0">
          <span className="text-lg shrink-0" aria-hidden="true">⚠️</span>
          <div className="min-w-0">
            <p className="text-amber-800 dark:text-amber-200 font-semibold">
              {totalIssueCount}{" "}
              {totalIssueCount === 1 ? "Currency-Issue" : "Currency-Issues"}
              {" — bitte prüfen"}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              {breakdown}
            </p>
          </div>
        </div>
        <span className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition shrink-0">
          Zu Lizenzen →
        </span>
      </div>
    </Link>
  );
}
