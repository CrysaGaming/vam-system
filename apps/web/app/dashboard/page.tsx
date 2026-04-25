import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@vam/db";
import Link from "next/link";

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

   // Admin-Stats: Anzahl pending PIREPs der Airline
  const isApprover =
    !!user.role && ['admin', 'instructor'].includes(user.role.name);

  const pendingCount =
    isApprover && user.airlineId
      ? await prisma.pirep.count({
          where: {
            airlineId: user.airlineId,
            status: 'Submitted',
          },
        })
      : 0; 

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

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">VAM Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">Willkommen zurück, {user.name ?? "Pilot"}</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm transition"
            >
              Abmelden
            </button>
          </form>
        </header>

        {/* Profile + Airline (bestehende Sektion) */}
        <div className="grid md:grid-cols-3 gap-6">
          <section className="md:col-span-1 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Profil
            </h2>
            {user.image && (
              <img
                src={user.image}
                alt={user.name ?? "Avatar"}
                className="w-24 h-24 rounded-full mb-4 border-2 border-gray-700"
              />
            )}
            <p className="text-xl font-semibold">{user.name ?? "Unbenannt"}</p>
            <p className="text-sm text-gray-400">{user.email}</p>
          </section>

          <section className="md:col-span-2 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Airline
            </h2>
            {user.airline ? (
              <div>
                <p className="text-2xl font-bold">{user.airline.name}</p>
                <p className="text-gray-400">
                  ICAO: {user.airline.icao} · Callsign: {user.airline.callsign}
                </p>
                <div className="mt-6 pt-6 border-t border-gray-800 grid grid-cols-4 gap-4">
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
                <p className="text-gray-400 mb-3">
                  Du bist noch keiner Airline zugeordnet.
                </p>
                <p className="text-sm text-gray-500">
                  In einer späteren Version wirst du hier einer Airline
                  beitreten können.
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Next-Rank Progress */}
        {user.airline && (
          <section className="mt-6 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Nächster Rang
            </h2>
            {nextRank ? (
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <p>
                    <span className="text-gray-400">Aktuell: </span>
                    <span className="font-semibold">{user.rank?.name ?? "—"}</span>
                    <span className="text-gray-500 mx-2">→</span>
                    <span className="font-semibold text-indigo-400">{nextRank.name}</span>
                  </p>
                  <p className="text-sm text-gray-400">
                    Noch <span className="text-white font-semibold">{hoursToNextRank.toFixed(1)} h</span>
                  </p>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
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
              <p className="text-gray-400">
                🏆 <span className="font-semibold text-yellow-400">Höchster Rang erreicht!</span>
              </p>
            )}
          </section>
        )}

        {/* Letzte PIREPs + Top-3-Leaderboard */}
        <div className="mt-6 grid md:grid-cols-3 gap-6">
          {/* Letzte PIREPs */}
          <section className="md:col-span-2 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm uppercase tracking-wider text-gray-500">
                Letzte Flüge
              </h2>
              <Link
                href="/pireps"
                className="text-xs text-indigo-400 hover:text-indigo-300 transition"
              >
                Alle ansehen →
              </Link>
            </div>
            {recentPireps.length === 0 ? (
              <p className="text-gray-400 text-sm">
                Noch keine Flüge eingereicht.{" "}
                <Link
                  href="/pireps/new"
                  className="text-indigo-400 hover:text-indigo-300"
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
                      className="flex justify-between items-center px-4 py-3 bg-gray-800/50 hover:bg-gray-800 rounded border border-gray-800 hover:border-indigo-600/50 transition group"
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-sm text-indigo-400 group-hover:text-indigo-300 transition">
                          {flightNo}
                        </span>
                        <span className="text-sm">
                          <span className="font-mono">{pirep.departure.icao}</span>
                          <span className="text-gray-500 mx-2">→</span>
                          <span className="font-mono">{pirep.arrival.icao}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-400">{flightTime}</span>
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
          <section className="md:col-span-1 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Top Piloten
            </h2>
            {topPilots.length === 0 ? (
              <p className="text-gray-400 text-sm">Noch keine Flüge.</p>
            ) : (
              <div className="space-y-3">
                {topPilots.map((pilot, idx) => {
                  const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                  const isMe = pilot.id === user.id;
                  return (
                    <div
                      key={pilot.id}
                      className={`flex items-center gap-3 p-2 rounded ${
                        isMe ? "bg-indigo-600/10 border border-indigo-600/30" : ""
                      }`}
                    >
                      <span className="text-xl">{medal}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {pilot.name ?? "Unbekannt"}
                          {isMe && (
                            <span className="ml-2 text-xs text-indigo-400">(Du)</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">
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

        {/* Admin-Bereich: nur für admin/instructor */}
        {isApprover && (
          <section className="mt-6 bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm uppercase tracking-wider text-gray-500">
                Admin-Bereich
              </h2>
              <span className="text-xs text-gray-500">
                {user.role?.name === 'admin' ? 'Administrator' : 'Instructor'}
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Link
                href="/pireps/pending"
                style={
                  pendingCount > 0
                    ? {
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        borderColor: 'rgba(99, 102, 241, 0.3)',
                      }
                    : undefined
                }
                className={`group flex justify-between items-center p-4 rounded border transition ${
                  pendingCount > 0
                    ? 'hover:opacity-90'
                    : 'bg-gray-800/50 border-gray-800 hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className="text-2xl">📋</span>
                  <div>
                    <p className="font-semibold">PIREPs zur Prüfung</p>
                    <p className="text-xs text-gray-400">
                      {pendingCount === 0
                        ? 'Alle PIREPs sind geprüft'
                        : `${pendingCount} ${pendingCount === 1 ? 'PIREP wartet' : 'PIREPs warten'} auf Prüfung`}
                    </p>
                  </div>
                </div>
                {pendingCount > 0 && (
                  <span
                    style={{ backgroundColor: '#6366f1' }}
                    className="px-3 py-1 rounded-full text-xs font-bold text-white"
                  >
                    {pendingCount}
                  </span>
                )}
                {pendingCount === 0 && (
                  <span className="text-gray-500 group-hover:translate-x-1 transition-transform">
                    →
                  </span>
                )}
              </Link>

              <div className="flex justify-between items-center p-4 rounded border border-gray-800 bg-gray-800/30 opacity-50">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">📊</span>
                  <div>
                    <p className="font-semibold">Statistiken</p>
                    <p className="text-xs text-gray-400">In Entwicklung</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Quick Actions (bestehende Sektion mit drittem Button erweitert) */}
        <div className="mt-6 grid md:grid-cols-3 gap-6">
          <Link
            href="/pireps/new"
            className="group bg-indigo-900/20 hover:bg-indigo-900/40 border border-indigo-700/50 hover:border-indigo-500 rounded-lg p-6 transition"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold mb-1">Neuen Flug</h3>
                <p className="text-sm text-gray-400">PIREP einreichen</p>
              </div>
              <span className="text-indigo-400 group-hover:translate-x-1 transition-transform">
                →
              </span>
            </div>
          </Link>

          <Link
            href="/routes"
            className="group bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-indigo-600/50 rounded-lg p-6 transition"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold mb-1">Routen</h3>
                <p className="text-sm text-gray-400">
                  Verfügbare Strecken ansehen
                </p>
              </div>
              <span className="text-indigo-400 group-hover:translate-x-1 transition-transform">
                →
              </span>
            </div>
          </Link>

          <Link
            href="/pireps"
            className="group bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-indigo-600/50 rounded-lg p-6 transition"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold mb-1">Alle PIREPs</h3>
                <p className="text-sm text-gray-400">
                  Flugberichte ansehen
                </p>
              </div>
              <span className="text-indigo-400 group-hover:translate-x-1 transition-transform">
                →
              </span>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}