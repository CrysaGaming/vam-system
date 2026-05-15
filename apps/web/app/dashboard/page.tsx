import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@vam/db";
import Link from "next/link";
import { WalletCard } from "./wallet-card";
import { CurrencyCard } from "./currency-card";
import { GoalCard } from "./goal-card";
import { DashboardRosterCard } from "./roster-card";
import { DutyCard } from "./duty-card";
import { IropsCard } from "./irops-card";

export default async function Dashboard() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      airline: true,
      rank: true,
      role: true,
    },
  });

  if (!user) {
    redirect("/");
  }

  // Nächster Rang (für Progress-Bar)
  const nextRank = user.airlineId
    ? await prisma.rank.findFirst({
        where: {
          airlineId: user.airlineId,
          minFlightHours: { gt: user.totalFlightHours },
        },
        orderBy: { order: "asc" },
      })
    : null;

  // Letzte 5 PIREPs des aktuellen Users
  const recentPireps = await prisma.pirep.findMany({
    where: { userId: user.id },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
    },
    orderBy: { submittedAt: "desc" },
    take: 5,
  });

  // Top 3 Piloten der Airline (für Mini-Leaderboard)
  const topPilots = user.airlineId
    ? await prisma.user.findMany({
        where: {
          airlineId: user.airlineId,
          totalFlights: { gt: 0 },
        },
        include: { rank: true },
        orderBy: { totalFlightHours: "desc" },
        take: 3,
      })
    : [];

  // Progress in Prozent
  const progressPercent = nextRank
    ? Math.min(
        100,
        Math.round(
          (user.totalFlightHours / nextRank.minFlightHours) * 100
        )
      )
    : 100;

  const hoursToNextRank = nextRank
    ? Math.max(0, nextRank.minFlightHours - user.totalFlightHours)
    : 0;

  // === Track 4 #56 (Section K): "This Month" delta-card ===
  //
  // Vergleich aktueller monat vs vormonat (gleiche tage-anzahl bis heute).
  // Wir zählen Approved PIREPs + summieren flightTimeMin in beiden fenstern.
  //
  // Fenster-definition: "this month" = ab erstem-des-monats 00:00 lokal bis
  // jetzt. "last month" = ganzer vormonat. Bewusst NICHT same-day-of-month-
  // ratio nehmen (das wäre fairer aber komplizierter zu erklären) — die
  // user-erwartung an "diesen monat vs letzten" ist "wie viel hab ich
  // bisher diesen monat geschafft, wie viel letzten ganzen monat insgesamt".
  // Das produziert in monatsmitte zwar einen scheinbar negativen delta, ist
  // aber semantisch klar.
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [thisMonthStats, lastMonthStats] = await Promise.all([
    prisma.pirep.aggregate({
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: thisMonthStart },
      },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),
    prisma.pirep.aggregate({
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: lastMonthStart, lt: thisMonthStart },
      },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),
  ]);

  const thisMonthFlights = thisMonthStats._count._all;
  const lastMonthFlights = lastMonthStats._count._all;
  const thisMonthHours = (thisMonthStats._sum.flightTimeMin ?? 0) / 60;
  const lastMonthHours = (lastMonthStats._sum.flightTimeMin ?? 0) / 60;

  const flightsDelta = thisMonthFlights - lastMonthFlights;
  const hoursDelta = thisMonthHours - lastMonthHours;

  // === Track 4 #59 (Section K): Annual Goal-Tracking data ===
  //
  // Wir brauchen current-year-hours für den progress-balken + day-of-year +
  // days-in-year für die rate-projection im GoalCard. Year-start/end-grenzen
  // mirroren year-in-review (#57). Wenn der user noch kein ziel gesetzt hat
  // (user.annualHourGoal=null), zeigen wir trotzdem die query-resultate weil
  // der GoalCard im CTA-state den current-hours-count nicht braucht — aber
  // wir laden's eh damit umschalten ohne reload geht.
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const yearStats = await prisma.pirep.aggregate({
    where: {
      userId: user.id,
      status: 'Approved',
      submittedAt: { gte: yearStart, lt: yearEnd },
    },
    _sum: { flightTimeMin: true },
  });
  const currentYearHours = (yearStats._sum.flightTimeMin ?? 0) / 60;

  // Day-of-year (1-indexed): tage seit jahresanfang inkl. heute.
  // Schaltjahr-handling via simple subtraction (Date-arithmetic in JS macht
  // DST/leap-day-arithmetic für uns).
  const dayOfYear = Math.floor((now.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysInYear = Math.floor((yearEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24));

  // Welle 13D-2: Wallet-card opt-in. Nur sichtbar wenn beide flags ON.
  // Logik gespiegelt zur EconomyCard's success-state in /settings —
  // wallet-features sind LIVE wenn user.economyEnabled && airline.
  // economyEnabled. Bei nicht-vorhandener airline ist die airline-flag
  // nicht prüfbar, also implizit false → kein wallet-display.
  const showWallet = !!(user.economyEnabled && user.airline?.economyEnabled);

  // Option #28: Currency-Check widget opt-in. Same dual-flag pattern als
  // wallet — career-features sind LIVE wenn user.careerEnabled && airline.
  // careerEnabled. Sonst keine licenses/type-ratings → kein currency-
  // tracking sinnvoll, kein widget-display.
  const showCurrency = !!(user.careerEnabled && user.airline?.careerEnabled);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold">VAM Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">Willkommen zurück, {user.name ?? "Pilot"}</p>
        </header>

        {/* Profile + Airline (+ optional Wallet) — 13D-2 fügt eine
            4. spalte hinzu wenn beide economy-flags ON sind. Layout
            klappt 4→3 cols zurück wenn !showWallet, damit der platz
            nicht leer steht. */}
        <div className={`grid ${showWallet ? "md:grid-cols-4" : "md:grid-cols-3"} gap-6`}>
          <section className="md:col-span-1 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Profil
            </h2>
            {/* user.image wird in <picture> gewrapped — siehe
                components/AppShell.tsx:BrandLink für den vollen kontext zur
                preload-warning + warum comments außerhalb des ternary
                stehen müssen (Turbopack-comment-stripping bug). */}
            {user.image && (
              <picture>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={user.image}
                  alt={user.name ?? "Avatar"}
                  className="w-24 h-24 rounded-full mb-4 border-2 border-gray-300 dark:border-gray-700"
                />
              </picture>
            )}
            <p className="text-xl font-semibold">{user.name ?? "Unbenannt"}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{user.email}</p>
          </section>

          <section className="md:col-span-2 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Airline
            </h2>
            {user.airline ? (
              <div>
                <p className="text-2xl font-bold">{user.airline.name}</p>
                <p className="text-gray-600 dark:text-gray-400">
                  ICAO: {user.airline.icao} · Callsign: {user.airline.callsign}
                </p>
                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">
                      Rang
                    </p>
                    <p className="font-semibold mt-2">
                      {user.rank?.name ?? "Kein Rang"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">
                      Rolle
                    </p>
                    <p className="font-semibold mt-2">
                      {user.role?.name ?? "Keine Rolle"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">
                      Flugstunden
                    </p>
                    <p className="font-semibold mt-2">
                      {user.totalFlightHours.toFixed(1)} h
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">
                      Flüge
                    </p>
                    <p className="font-semibold mt-2">{user.totalFlights}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Du bist noch keiner Airline zugeordnet.
                </p>
                <p className="text-sm text-gray-500">
                  In einer späteren Version wirst du hier einer Airline
                  beitreten können.
                </p>
              </div>
            )}
          </section>

          {showWallet && <WalletCard userId={user.id} />}
        </div>

        {/* Currency-Check widget (option #28). Compact full-width banner.
            Two-state render: green strip when all-current, amber alert
            when issues. Self-fetches data — caller just gates on the
            dual careerEnabled flags. */}
        {showCurrency && <CurrencyCard userId={user.id} />}

        {/* Next-Rank Progress */}
        {user.airline && (
          <section className="mt-6 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Nächster Rang
            </h2>
            {nextRank ? (
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <p>
                    <span className="text-gray-600 dark:text-gray-400">Aktuell: </span>
                    <span className="font-semibold">{user.rank?.name ?? "—"}</span>
                    <span className="text-gray-500 mx-2">→</span>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">{nextRank.name}</span>
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Noch <span className="text-gray-900 dark:text-white font-semibold">{hoursToNextRank.toFixed(1)} h</span>
                  </p>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {user.totalFlightHours.toFixed(1)} / {nextRank.minFlightHours} Stunden ({progressPercent}%)
                </p>
              </div>
            ) : (
              <p className="text-gray-600 dark:text-gray-400">
                🏆 <span className="font-semibold text-yellow-600 dark:text-yellow-400">Höchster Rang erreicht!</span>
              </p>
            )}
          </section>
        )}

        {/* Welle P / P4 — IROPs card. Renders only when the pilot has
            unacknowledged irregular-ops events on their bookings —
            empty state returns null so the dashboard stays clean. */}
        {user.airline && (
          <div className="mt-6">
            <IropsCard userId={user.id} />
          </div>
        )}

        {/* Welle P / P2 — Duty/Fatigue card. Pure aggregation over
            approved PIREPs (no schema). Always shown for airline-
            members; for solo pilots the "OK" state is harmless. */}
        {user.airline && (
          <div className="mt-6">
            <DutyCard userId={user.id} />
          </div>
        )}

        {/* === Track 4 #56 (Section K): "This Month"-card ===

            Zeigt flights + flight-hours für aktuellen monat vs vormonat
            als delta-cards. Position bewusst NACH next-rank (das ist der
            primary-progress) und VOR letzte-pireps (recent-activity).

            Layout: 2-spaltiges grid (flights | hours). Jede zelle zeigt:
              - großes haupt-value (this-month)
              - delta-pill (+ oder - vs last-month, color-coded)
              - micro-label "vs letzter monat (lastMonthValue)"

            Delta-farben:
              positive (mehr geflogen)  → emerald
              zero / negative           → gray (keine "rote" warnung,
                                          weil weniger ≠ schlecht)

            Edge: brandneuer pilot ohne PIREPs → cards mit 0/0/—-display,
            keine prozent-rechnung (would be NaN/Infinity).

            Monatsname in der überschrift: deutsche locale. */}
        {user.airline && (
          <section className="mt-6 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm uppercase tracking-wider text-gray-500">
                📅 Diesen Monat
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {now.toLocaleDateString('de-DE', {
                  month: 'long',
                  year: 'numeric',
                })}{' '}
                · vs{' '}
                {lastMonthStart.toLocaleDateString('de-DE', {
                  month: 'long',
                })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Flights this month */}
              <div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <p className="text-3xl font-bold tabular-nums">
                    {thisMonthFlights}
                  </p>
                  <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                    Flüge
                  </p>
                  {/* Delta-pill: nur rendern wenn last-month auch daten hatte
                      ODER es nicht-null this-month gibt. Bei beide=0 zeigen
                      wir kein delta (== ist konfusionsfrei genug). */}
                  {(thisMonthFlights > 0 || lastMonthFlights > 0) && (
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded ${
                        flightsDelta > 0
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : flightsDelta < 0
                            ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {flightsDelta > 0 ? '+' : ''}
                      {flightsDelta}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  letzter Monat: {lastMonthFlights}
                </p>
              </div>

              {/* Hours this month */}
              <div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <p className="text-3xl font-bold tabular-nums">
                    {thisMonthHours.toFixed(1)}
                    <span className="text-base font-normal text-gray-500 ml-1">
                      h
                    </span>
                  </p>
                  <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                    Flugzeit
                  </p>
                  {(thisMonthHours > 0 || lastMonthHours > 0) && (
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded ${
                        hoursDelta > 0
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {hoursDelta > 0 ? '+' : ''}
                      {hoursDelta.toFixed(1)}h
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  letzter Monat: {lastMonthHours.toFixed(1)} h
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Track 4 #59 (Section K): Annual Goal-Tracking card. Nach
            "Diesen Monat" weil das die natural-progression ist: monatlich →
            jährlich. Gated auf user.airline weil PIREP-aggregation ohne
            airline-mitgliedschaft sinnlos ist. Self-contained client-
            component mit inline server-action für set/edit/clear. */}
        {user.airline && (
          <GoalCard
            userId={user.id}
            currentGoal={user.annualHourGoal}
            currentYearHours={currentYearHours}
            dayOfYear={dayOfYear}
            daysInYear={daysInYear}
          />
        )}

        {/* Track 5 #26 (Section F): Roster-card mit den nächsten roster-
            assignments. Server-component die selbst 0-state handhabt (renders
            null wenn keine assignments). Gated auf user.airline weil ohne
            airline-mitgliedschaft keine assignments existieren — das spart
            eine DB-round-trip im "kein airline"-fall. Sitzt zwischen GoalCard
            (forward-looking ziel) und Letzte Flüge (backward-looking history)
            damit der "what's next" gedanken-flow konsistent läuft. */}
        {user.airline && (
          <div className="mt-6">
            <DashboardRosterCard pilotId={user.id} />
          </div>
        )}

        {/* Letzte PIREPs + Top-3-Leaderboard */}
        <div className="mt-6 grid md:grid-cols-3 gap-6">
          {/* Letzte PIREPs */}
          <section className="md:col-span-2 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm uppercase tracking-wider text-gray-500">
                Letzte Flüge
              </h2>
              <Link
                href="/pireps"
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
              >
                Alle ansehen →
              </Link>
            </div>
            {recentPireps.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Noch keine Flüge eingereicht.{" "}
                <Link
                  href="/pireps/new"
                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                >
                  Ersten Flug einreichen →
                </Link>
              </p>
            ) : (
              <div className="space-y-2">
                {recentPireps.map((pirep) => {
                  const hours = Math.floor((pirep.flightTimeMin ?? 0) / 60);
                  const mins = (pirep.flightTimeMin ?? 0) % 60;
                  const flightTime = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
                  const flightNo = pirep.route?.flightNumber ?? "—";

                  return (
                    <Link
                      key={pirep.id}
                      href={`/pireps/${pirep.id}`}
                      className="flex justify-between items-center px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 rounded border border-gray-200 dark:border-gray-800 hover:border-indigo-500 dark:hover:border-indigo-600/50 transition group"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition">
                          {flightNo}
                        </span>
                        <span className="text-sm">
                          <span className="font-mono">{pirep.departure.icao}</span>
                          <span className="text-gray-500 mx-2">→</span>
                          <span className="font-mono">{pirep.arrival.icao}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-600 dark:text-gray-400">{flightTime}</span>
                        {pirep.aircraft && (
                          <span className="text-gray-500 font-mono text-xs">
                            {pirep.aircraft.registration}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Top-3-Leaderboard */}
          <section className="md:col-span-1 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Top Piloten
            </h2>
            {topPilots.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400 text-sm">Noch keine Flüge.</p>
            ) : (
              <div className="space-y-3">
                {topPilots.map((pilot, idx) => {
                  const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                  const isMe = pilot.id === user.id;
                  return (
                    <div
                      key={pilot.id}
                      className={`flex items-center gap-3 p-2 rounded ${
                        isMe ? "bg-indigo-50 dark:bg-indigo-600/10 border border-indigo-300 dark:border-indigo-600/30" : ""
                      }`}
                    >
                      <span className="text-xl">{medal}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {pilot.name ?? "Unbekannt"}
                          {isMe && (
                            <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400">(Du)</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {pilot.rank?.name ?? "—"}
                        </p>
                      </div>
                      <p className="text-sm font-semibold">
                        {pilot.totalFlightHours.toFixed(1)}h
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Quick Actions — nur die zwei häufigsten flying-aktionen.
            "Bookings", "Piloten", "Alle PIREPs" wurden entfernt weil sie
            schon im Sidebar-Nav (Flying / Admin) zu finden sind und es
            redundant gewesen wäre. */}
        <div className="mt-6 grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Link
            href="/pireps/new"
            className="group bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-300 dark:border-indigo-700/50 hover:border-indigo-500 rounded-lg p-6 transition"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold mb-1">Neuen Flug</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">PIREP einreichen</p>
              </div>
              <span className="text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 transition-transform">
                →
              </span>
            </div>
          </Link>

          <Link
            href="/routes"
            className="group bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800 hover:border-indigo-500 dark:hover:border-indigo-600/50 rounded-lg p-6 transition"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold mb-1">Routen</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Verfügbare Strecken ansehen
                </p>
              </div>
              <span className="text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 transition-transform">
                →
              </span>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}