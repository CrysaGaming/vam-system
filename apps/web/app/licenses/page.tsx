import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  prisma,
  getUserLicenses,
  getUserTypeRatings,
  getExpiringLicenses,
  licenseDisplayName,
  type LicenseType,
  type LicenseStatus,
} from "@vam/db";
import Link from "next/link";

/**
 * Welle 13E-5 — pilot license + type-rating overview page.
 *
 * Zeigt:
 *   - Stats-bar: aktive licenses, type-ratings, expiring soon
 *   - "Aktive Lizenzen"-section: alle status=ACTIVE licenses
 *   - "Type Ratings"-section: alle type-ratings inkl. expiry
 *   - "Inaktive Lizenzen"-section: REVOKED/EXPIRED/SUSPENDED (klein, audit)
 *   - Empty-state wenn keine licenses
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

  // Parallele queries — alle drei sind unabhängig + auf indices optimiert.
  const [allLicenses, typeRatings, expiringSoon] = await Promise.all([
    getUserLicenses(user.id),
    getUserTypeRatings(user.id),
    getExpiringLicenses(user.id, 30),
  ]);

  // Partition by status. getUserLicenses returnt sortiert by status asc
  // (ACTIVE zuerst), dann issuedAt desc — wir partitionieren trotzdem
  // explicit weil wir verschiedene UI-treatments für active vs. inactive.
  const active = allLicenses.filter((l) => l.status === "ACTIVE");
  const inactive = allLicenses.filter((l) => l.status !== "ACTIVE");

  const totalLicenses = allLicenses.length;
  const totalTypeRatings = typeRatings.length;
  const expiringCount = expiringSoon.length;

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
              : "Specific aircraft-qualifikationen"
          }
          variant="secondary"
        />
        <StatCard
          icon="⏰"
          label="Bald ablaufend"
          value={expiringCount.toString()}
          subtext={
            expiringCount === 0
              ? "Keine licenses laufen in 30 tagen ab"
              : `In den nächsten 30 tagen — bitte renewal planen`
          }
          variant={expiringCount > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Expiring-warning — nur sichtbar wenn welche da sind. Listet die
          betroffenen licenses prominent oben damit pilot reagiert. */}
      {expiringCount > 0 && (
        <div className="mb-6 px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm">
          <p className="font-semibold mb-1">
            ⚠️ {expiringCount} {expiringCount === 1 ? "Lizenz läuft" : "Lizenzen laufen"} bald ab
          </p>
          <ul className="space-y-0.5">
            {expiringSoon.map((lic) => (
              <li key={lic.id}>
                {licenseDisplayName(lic.type)} — gültig bis{" "}
                {lic.expiresAt ? formatDate(lic.expiresAt) : "—"}
              </li>
            ))}
          </ul>
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
            <p className="mt-0.5">Gültig bis: {formatDate(license.expiresAt)}</p>
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
