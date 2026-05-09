import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  prisma,
  getUserLicenses,
  getUserTypeRatings,
  getExpiringLicenses,
  getExpiringTypeRatings,
  getExpiredTypeRatings,
  licenseDisplayName,
  type LicenseType,
  type LicenseStatus,
} from "@vam/db";
import Link from "next/link";

/**
 * Welle 13E-5 — pilot license + type-rating overview page.
 *
 * Zeigt:
 *   - Stats-bar: aktive Lizenzen, Type-Ratings (mit currency-breakdown),
 *     unified Currency-Check-counter
 *   - Currency-warning banner: per-bucket lists (license expiring,
 *     type-rating expiring, type-rating expired, recency lapsed) — option #26
 *   - "Aktive Lizenzen"-section: alle status=ACTIVE licenses
 *   - "Type Ratings"-section: alle type-ratings mit Current/Expired/
 *     Recency-lapsed badge
 *   - "Inaktive Lizenzen"-section: REVOKED/EXPIRED/SUSPENDED (klein, audit)
 *   - Empty-state wenn keine licenses
 *
 * Currency-tracking (option #26): die page surface't nicht nur expiring-
 * licenses sondern auch type-rating-expiry (next 60d), already-expired
 * type-ratings, und recency-lapsed (≥ 90 Tage nicht geflogen). Combined
 * count ist im "Currency-Check"-stat-card; per-bucket details im
 * warning-banner. Schema-data exists schon (TypeRating.expiresAt +
 * lastFlownAt) — kein DB-change, reine app-layer-aggregation.
 *
 * Gating: nur erreichbar wenn user.careerEnabled && airline.careerEnabled.
 * Direkter URL-aufruf bei deaktivierten flags → redirect auf /settings#profile
 * mit der CareerCard, damit der user die opt-in-toggles findet (mirror der
 * /wallet-page-gating-logik aus 13D-3).
 *
 * Read-only im MVP — admin-grant-UI kommt in 13E-6 (per-pilot in
 * /airline/pilots/[id]). Self-service wird über flight-school-enrollments
 * laufen (13E-12), nicht über manual button-actions hier.
 *
 * Pattern: server-component, no client-state. Die page rendert komplett
 * server-side und wird bei state-changes via revalidatePath('/licenses')
 * invalidated.
 */
export default async function LicensesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: { select: { careerEnabled: true, name: true } } },
  });

  if (!user) {
    redirect("/");
  }

  // Gating-check: beide flags müssen ON sein. Selbe semantik wie /wallet-
  // page (siehe 13D-3 für rationale). Redirect statt 403 weil das aus
  // user-sicht "feature noch nicht aktiviert" ist, nicht "verboten" — der
  // redirect zeigt direkt den weg zur aktivierung in /settings.
  const showCareer = !!(user.careerEnabled && user.airline?.careerEnabled);
  if (!showCareer) {
    redirect("/settings#profile");
  }

  // Parallele queries — fünf unabhängige reads, alle auf indices optimiert.
  // Type-rating-currency wird hier mit-getrackt (option #26): expiring-soon
  // (next 60 days, längeres window als licenses weil recurrent-checks
  // logistisch geplant werden müssen) plus already-expired (audit-list).
  // Recency-lapsed wird app-layer berechnet — kein dedizierter helper, weil
  // das nur eine simple lastFlownAt < (now - 90d) prüfung ist und der
  // typeRatings-array eh schon vollständig in scope ist.
  const [
    allLicenses,
    typeRatings,
    expiringSoon,
    expiringTypeRatings,
    expiredTypeRatings,
  ] = await Promise.all([
    getUserLicenses(user.id),
    getUserTypeRatings(user.id),
    getExpiringLicenses(user.id, 30),
    getExpiringTypeRatings(user.id, 60),
    getExpiredTypeRatings(user.id),
  ]);

  // Partition by status. getUserLicenses returnt sortiert by status asc
  // (ACTIVE zuerst), dann issuedAt desc — wir partitionieren trotzdem
  // explicit weil wir verschiedene UI-treatments für active vs. inactive.
  // Active wird zusätzlich nach expiry-soonest-first re-sortiert (option #22):
  // currency-relevant infos zuerst, lifetime-licenses (expiresAt=null) ans Ende.
  // Issued-at-desc innerhalb derselben expiry-bucket — fallback wenn beide null.
  const active = allLicenses
    .filter((l) => l.status === "ACTIVE")
    .sort((a, b) => {
      if (a.expiresAt === null && b.expiresAt === null) {
        return b.issuedAt.getTime() - a.issuedAt.getTime();
      }
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      return a.expiresAt.getTime() - b.expiresAt.getTime();
    });
  const inactive = allLicenses.filter((l) => l.status !== "ACTIVE");

  // Type-rating recency check (option #26). Same 90-day cutoff the row-
  // level badge uses (regulatory norm: 3 takeoffs/landings in 90 days for
  // commercial PAX-ops). We compute it here so the summary card and
  // warning-banner can count recency-lapsed type-ratings alongside the
  // expiry-driven ones — pilots see "currency" issues, not just "expiry"
  // issues. Excluded: expired ratings (those already counted in
  // expiredTypeRatings — including them under recency too would double-
  // count) and ratings without a lastFlownAt (never flown = no currency
  // baseline yet, can't be lapsed).
  const recencyCutoff = new Date(Date.now() - 90 * 86_400_000);
  const expiredTypeRatingIds = new Set(expiredTypeRatings.map((tr) => tr.id));
  const recencyLapsedTypeRatings = typeRatings.filter(
    (tr) =>
      !expiredTypeRatingIds.has(tr.id) &&
      tr.lastFlownAt !== null &&
      tr.lastFlownAt < recencyCutoff,
  );

  const totalLicenses = allLicenses.length;
  const totalTypeRatings = typeRatings.length;
  const expiringLicenseCount = expiringSoon.length;

  // Combined currency-issue count for the "Bald ablaufend" stat-card.
  // Includes everything a pilot might want to act on this month:
  //   - licenses expiring in the next 30d
  //   - type-ratings expiring in the next 60d
  //   - type-ratings already expired (need renewal before next flight)
  //   - type-ratings with recency lapsed (90-day rule)
  // Each bucket is a distinct kind of action item, so summing them gives
  // a useful "things to look at" number rather than overlap-counting.
  const totalIssueCount =
    expiringLicenseCount +
    expiringTypeRatings.length +
    expiredTypeRatings.length +
    recencyLapsedTypeRatings.length;

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Lizenzen</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Deine Pilot-Lizenzen und Type-Ratings für{" "}
          <span className="font-semibold">{user.airline?.name}</span>.
        </p>
      </header>

      {/* Stats-bar — 3 cards. Mobile: stacked. md+: grid-3-cols. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon="📜"
          label="Aktive Lizenzen"
          value={active.length.toString()}
          subtext={
            totalLicenses > active.length
              ? `${totalLicenses - active.length} inaktiv im audit-trail`
              : "Alle Lizenzen aktiv"
          }
          variant="primary"
        />
        <StatCard
          icon="🎯"
          label="Type Ratings"
          value={totalTypeRatings.toString()}
          subtext={
            totalTypeRatings === 0
              ? "Noch keine type-ratings"
              : `${totalTypeRatings - expiredTypeRatings.length - recencyLapsedTypeRatings.length} current · ${expiredTypeRatings.length + recencyLapsedTypeRatings.length} mit currency-issue`
          }
          variant="secondary"
        />
        <StatCard
          icon="⏰"
          label="Currency-Check"
          value={totalIssueCount.toString()}
          subtext={
            totalIssueCount === 0
              ? "Alles aktuell — nichts zu erneuern"
              : buildIssueSummary(
                  expiringLicenseCount,
                  expiringTypeRatings.length,
                  expiredTypeRatings.length,
                  recencyLapsedTypeRatings.length,
                )
          }
          variant={totalIssueCount > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Currency-warning banner — sichtbar wenn irgendwas auf
          currency-issue läuft. Listet pro bucket die betroffenen items
          (license expiring, type-rating expiring, type-rating expired,
          type-rating recency-lapsed) damit der pilot direkt sieht
          welche action ansteht. Vier separate sub-listen statt einer
          gemischten ist absichtlich: jede aktion ist anders (license
          renewal = admin/flight-school, type-rating renewal =
          recurrent-check, recency = einfach mal eine runde fliegen). */}
      {totalIssueCount > 0 && (
        <div className="mb-6 px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm space-y-3">
          <p className="font-semibold">
            ⚠️ {totalIssueCount}{" "}
            {totalIssueCount === 1 ? "Currency-Issue" : "Currency-Issues"} —
            bitte prüfen
          </p>

          {expiringLicenseCount > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <p className="text-xs uppercase tracking-wider opacity-70">
                  Lizenzen laufen bald ab (≤ 30 Tage)
                </p>
                <Link
                  href="/flight-schools"
                  className="text-xs font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid shrink-0"
                >
                  Flugschule finden →
                </Link>
              </div>
              <ul className="space-y-0.5">
                {expiringSoon.map((lic) => (
                  <li key={lic.id}>
                    {licenseDisplayName(lic.type)} — gültig bis{" "}
                    {lic.expiresAt ? formatDate(lic.expiresAt) : "—"}
                    {lic.expiresAt && (
                      <span className="opacity-60">
                        {" "}
                        ({formatRelativeDays(lic.expiresAt)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {expiringTypeRatings.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <p className="text-xs uppercase tracking-wider opacity-70">
                  Type-Ratings laufen bald ab (≤ 60 Tage)
                </p>
                <Link
                  href="/flight-schools"
                  className="text-xs font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid shrink-0"
                >
                  Recurrent planen →
                </Link>
              </div>
              <ul className="space-y-0.5">
                {expiringTypeRatings.map((tr) => (
                  <li key={tr.id}>
                    <span className="font-mono">{tr.aircraftType}</span> —
                    gültig bis{" "}
                    {tr.expiresAt ? formatDate(tr.expiresAt) : "—"}
                    {tr.expiresAt && (
                      <span className="opacity-60">
                        {" "}
                        ({formatRelativeDays(tr.expiresAt)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {expiredTypeRatings.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <p className="text-xs uppercase tracking-wider opacity-70">
                  Type-Ratings bereits abgelaufen — recurrent-check fällig
                </p>
                <Link
                  href="/flight-schools"
                  className="text-xs font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid shrink-0"
                >
                  Recurrent buchen →
                </Link>
              </div>
              <ul className="space-y-0.5">
                {expiredTypeRatings.map((tr) => (
                  <li key={tr.id}>
                    <span className="font-mono">{tr.aircraftType}</span> —
                    abgelaufen am{" "}
                    {tr.expiresAt ? formatDate(tr.expiresAt) : "—"}
                    {tr.expiresAt && (
                      <span className="opacity-60">
                        {" "}
                        ({formatRelativeDays(tr.expiresAt)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recencyLapsedTypeRatings.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <p className="text-xs uppercase tracking-wider opacity-70">
                  Recency lapsed (≥ 90 Tage nicht geflogen)
                </p>
                <Link
                  href="/jumpseat"
                  className="text-xs font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid shrink-0"
                >
                  Flug planen →
                </Link>
              </div>
              <ul className="space-y-0.5">
                {recencyLapsedTypeRatings.map((tr) => (
                  <li key={tr.id}>
                    <span className="font-mono">{tr.aircraftType}</span> —
                    zuletzt geflogen{" "}
                    {tr.lastFlownAt ? formatDate(tr.lastFlownAt) : "—"}
                    {tr.lastFlownAt && (
                      <span className="opacity-60">
                        {" "}
                        ({formatRelativeDays(tr.lastFlownAt)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Active-licenses-section. Liste mit certificate-number + issued/
          expires + notes. Wenn keine: empty-state mit hinweis auf flight-
          school + admin-grant. */}
      <Section title="Aktive Lizenzen" subtitle="Diese Lizenzen sind aktuell gültig">
        {active.length === 0 ? (
          <EmptyState
            icon="📜"
            title="Du hast noch keine aktiven Lizenzen"
            body={
              <>
                Lizenzen werden über Flight-Schools (Welle 13E-12) erworben oder
                manuell von Airline-Admins ausgestellt. Frag deinen Trainer oder
                Airline-Admin nach dem nächsten Schritt.
              </>
            }
          />
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            {active.map((lic) => (
              <LicenseRow key={lic.id} license={lic} />
            ))}
          </div>
        )}
      </Section>

      {/* Type-ratings-section. Zeigt aircraft-type, hours-on-type, last-flown,
          expiry. Type-ratings haben recurrent-check-zyklen (default 12 monate),
          also expiry hier wichtig. */}
      <Section
        title="Type Ratings"
        subtitle="Specific aircraft-qualifikationen mit hours-on-type tracking"
      >
        {typeRatings.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="Du hast noch keine Type Ratings"
            body={
              <>
                Type-Ratings sind aircraft-spezifisch (z.B. A320, B738) und werden
                nach erfolgreichem type-rating-training ausgestellt. Hours auf
                dem type werden automatisch nach jedem PIREP getrackt.
              </>
            }
          />
        ) : (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            {typeRatings.map((tr) => (
              <TypeRatingRow key={tr.id} rating={tr} />
            ))}
          </div>
        )}
      </Section>

      {/* Inactive-licenses-section. Klein, kollapsible-style audit-trail.
          REVOKED/EXPIRED/SUSPENDED — pilot soll sehen können was passiert ist
          aber nicht visuell mit aktiven gleichgestellt. */}
      {inactive.length > 0 && (
        <Section
          title="Inaktive Lizenzen"
          subtitle="Audit-trail: revoked, expired oder suspendierte Lizenzen"
        >
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            {inactive.map((lic) => (
              <LicenseRow key={lic.id} license={lic} dimmed />
            ))}
          </div>
        </Section>
      )}

      {/* Footer-link to settings — handy escape hatch wenn pilot das
          career-feature deaktivieren will. Sehr subtil, nicht prominent. */}
      <p className="mt-8 text-xs text-gray-500 dark:text-gray-500 text-center">
        Career-System verwalten in den{" "}
        <Link href="/settings#profile" className="underline hover:text-gray-700 dark:hover:text-gray-300">
          Profil-Einstellungen
        </Link>
        .
      </p>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtext,
  variant,
}: {
  icon: string;
  label: string;
  value: string;
  subtext: string;
  variant: "primary" | "secondary" | "warning" | "neutral";
}) {
  const variantClasses: Record<typeof variant, string> = {
    primary:
      "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30 text-indigo-900 dark:text-indigo-100",
    secondary:
      "bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30 text-purple-900 dark:text-purple-100",
    warning:
      "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-100",
    neutral:
      "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100",
  };
  return (
    <div className={`rounded-lg border p-4 ${variantClasses[variant]}`}>
      <div className="flex items-start justify-between mb-1">
        <span className="text-xs uppercase tracking-wider opacity-70">{label}</span>
        <span className="text-xl" aria-hidden="true">{icon}</span>
      </div>
      <p className="text-2xl font-bold mb-1">{value}</p>
      <p className="text-xs opacity-70">{subtext}</p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
      <p className="text-3xl mb-2" aria-hidden="true">{icon}</p>
      <p className="text-sm font-semibold mb-1">{title}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">{body}</p>
    </div>
  );
}

interface LicenseRow {
  id: string;
  type: LicenseType;
  status: LicenseStatus;
  certificateNumber: string;
  issuedAt: Date;
  expiresAt: Date | null;
  issuingAuthority: string;
  notes: string | null;
}

function LicenseRow({ license, dimmed = false }: { license: LicenseRow; dimmed?: boolean }) {
  return (
    <div className={`p-4 ${dimmed ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold">{licenseDisplayName(license.type)}</h3>
            <StatusBadge status={license.status} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {license.certificateNumber}
          </p>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
          <p>Ausgestellt: {formatDate(license.issuedAt)}</p>
          {license.expiresAt ? (
            <p className="mt-0.5">
              Gültig bis: {formatDate(license.expiresAt)}
              {!dimmed && (
                <span className="opacity-70">
                  {" "}
                  ({formatRelativeDays(license.expiresAt)})
                </span>
              )}
            </p>
          ) : (
            <p className="mt-0.5 italic">Ohne Ablaufdatum</p>
          )}
        </div>
      </div>
      {license.notes && (
        <p className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-500 whitespace-pre-line font-mono">
          {license.notes}
        </p>
      )}
    </div>
  );
}

interface TypeRatingRow {
  id: string;
  aircraftType: string;
  obtainedAt: Date;
  expiresAt: Date | null;
  hoursOnType: number;
  lastFlownAt: Date | null;
}

function TypeRatingRow({ rating }: { rating: TypeRatingRow }) {
  const isExpired = rating.expiresAt && rating.expiresAt < new Date();

  // 90-day-recency-warning: type-ratings haben üblicherweise eine
  // recency-rule (3 takeoffs/landings in 90 tagen für PAX). Wenn
  // lastFlownAt > 90 tage alt → visuell markieren.
  const cutoff = new Date(Date.now() - 90 * 86_400_000);
  const recencyExpired = rating.lastFlownAt && rating.lastFlownAt < cutoff;

  // "Current" badge (option #26): explicit positive signal when neither
  // expired nor recency-lapsed. Without this, current ratings show no
  // badge at all while problematic ones do — confusing because the
  // absence of a badge can be read as "data missing" rather than "all
  // good". The green badge makes the all-good state explicitly visible
  // and consistent with how Lizenzen show "Aktiv".
  const isCurrent = !isExpired && !recencyExpired;

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold font-mono">{rating.aircraftType}</h3>
            {isExpired && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-red-500/15 text-red-700 dark:text-red-300 font-semibold">
                Expired
              </span>
            )}
            {!isExpired && recencyExpired && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold">
                Recency lapsed
              </span>
            )}
            {isCurrent && (
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded bg-green-500/15 text-green-700 dark:text-green-300 font-semibold">
                Current
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold">{rating.hoursOnType.toFixed(1)} h</span> auf type
          </p>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
          <p>Erworben: {formatDate(rating.obtainedAt)}</p>
          {rating.expiresAt ? (
            <p className="mt-0.5">Gültig bis: {formatDate(rating.expiresAt)}</p>
          ) : (
            <p className="mt-0.5 italic">Lifetime</p>
          )}
          {rating.lastFlownAt && (
            <p className="mt-0.5">
              Zuletzt geflogen: {formatDate(rating.lastFlownAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LicenseStatus }) {
  const config: Record<LicenseStatus, { label: string; classes: string }> = {
    ACTIVE: {
      label: "Aktiv",
      classes: "bg-green-500/15 text-green-700 dark:text-green-300",
    },
    EXPIRED: {
      label: "Abgelaufen",
      classes: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
    },
    REVOKED: {
      label: "Widerrufen",
      classes: "bg-red-500/15 text-red-700 dark:text-red-300",
    },
    SUSPENDED: {
      label: "Suspendiert",
      classes: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    },
  };
  const c = config[status];
  return (
    <span
      className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded font-semibold ${c.classes}`}
    >
      {c.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Date-formatter — locale=de-DE für consistency mit dem rest der app
// ─────────────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * Day-difference helper für inline-currency-hints (option #22).
 *
 * Returns the rounded absolute number of days between `d` and now. Used
 * by `formatRelativeDays` to build "in X Tagen" / "seit X Tagen"-style
 * hints next to formatDate-output. We round-half-up because at the day-
 * boundary (e.g. expiry happens at 23:59 today) the user mentally still
 * thinks "läuft morgen ab", not "läuft in 0 Tagen".
 *
 * The helper deliberately uses Math.abs so callers don't need to think
 * about sign — direction (past vs future) is determined separately in
 * formatRelativeDays via the original timestamp comparison. This keeps
 * the API readable: `formatRelativeDays(d)` always returns a string,
 * never a sign-bearing number that needs interpreting.
 */
function diffInDays(d: Date): number {
  const ms = d.getTime() - Date.now();
  return Math.round(Math.abs(ms) / 86_400_000);
}

/**
 * Relative-day formatter for inline currency hints (option #22).
 *
 * Renders dates as "in 12 Tagen" (future), "seit 5 Tagen" (past), or
 * "heute" (within ±1 day). Used inline in the warning-banner buckets and
 * row expiry-displays to give pilots a quick "how urgent is this?"-read
 * without forcing them to subtract dates in their head.
 *
 * Conventions:
 *   - Future + ≥2 days: "in N Tagen"
 *   - Future + 1 day:   "morgen"
 *   - Past + 1 day:     "gestern"
 *   - Past + ≥2 days:   "seit N Tagen"
 *   - |diff| < 1 day:   "heute" (covers both ~12h before and ~12h after)
 *
 * Returns the bare phrase (no parentheses, no separators) — caller wraps
 * it in `(...)` or punctuation as needed for the surrounding context.
 */
function formatRelativeDays(d: Date): string {
  const now = Date.now();
  const ms = d.getTime() - now;
  const days = diffInDays(d);
  if (days === 0) return "heute";
  if (ms > 0) {
    if (days === 1) return "morgen";
    return `in ${days} Tagen`;
  }
  if (days === 1) return "gestern";
  return `seit ${days} Tagen`;
}

// ─────────────────────────────────────────────────────────────────────────
// buildIssueSummary — kompakter subtext für die Currency-Check-stat-card
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compose a one-line breakdown of currency-issues for the stat-card subtext.
 *
 * Inputs are independent counts of the four currency-buckets we track:
 *   - expL: licenses expiring in next 30 days (renewal needed soon)
 *   - expT: type-ratings expiring in next 60 days (recurrent-check coming up)
 *   - expdT: type-ratings already expired (recurrent-check overdue)
 *   - lapsT: type-ratings with recency lapsed (90-day rule, simple to fix —
 *            just fly a leg)
 *
 * Buckets with count=0 are omitted from the summary so the line stays short
 * even when only one or two issue-types exist. Caller guarantees that at
 * least one count > 0 (the wrapping conditional in the page already
 * returns early via "Alles aktuell — nichts zu erneuern" when totalIssue-
 * Count is 0), so this function never returns an empty string. German
 * pluralization is handled inline since each bucket has its own noun.
 *
 * Output examples:
 *   buildIssueSummary(2, 0, 0, 0)  → "2 Lizenzen bald ablaufend"
 *   buildIssueSummary(1, 1, 0, 0)  → "1 Lizenz bald ablaufend · 1 Type-Rating bald ablaufend"
 *   buildIssueSummary(0, 0, 1, 2)  → "1 Type-Rating abgelaufen · 2 recency lapsed"
 *   buildIssueSummary(1, 1, 1, 1)  → "1 Lizenz bald ablaufend · 1 Type-Rating bald ablaufend · 1 Type-Rating abgelaufen · 1 recency lapsed"
 *
 * Separator is " · " (middle dot) — visually less aggressive than commas
 * for 4 chained items and matches the pattern used elsewhere in the page
 * (e.g., the Type-Ratings stat-card subtext).
 */
function buildIssueSummary(
  expL: number,
  expT: number,
  expdT: number,
  lapsT: number,
): string {
  const parts: string[] = [];

  if (expL > 0) {
    parts.push(
      `${expL} ${expL === 1 ? "Lizenz" : "Lizenzen"} bald ablaufend`,
    );
  }
  if (expT > 0) {
    parts.push(
      `${expT} ${expT === 1 ? "Type-Rating" : "Type-Ratings"} bald ablaufend`,
    );
  }
  if (expdT > 0) {
    parts.push(
      `${expdT} ${expdT === 1 ? "Type-Rating" : "Type-Ratings"} abgelaufen`,
    );
  }
  if (lapsT > 0) {
    parts.push(`${lapsT} recency lapsed`);
  }

  return parts.join(" · ");
}
