import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';

export default async function Dashboard() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
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
    redirect('/');
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-12 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">VAM Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">Willkommen zurück</p>
          </div>
          <form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
            <button
              type="submit"
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm transition"
            >
              Abmelden
            </button>
          </form>
        </header>

        <div className="grid md:grid-cols-3 gap-6">
          <section className="md:col-span-1 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">Profil</h2>
            {user.image && (
              <img
                src={user.image}
                alt={user.name ?? 'Avatar'}
                className="w-24 h-24 rounded-full mb-4 border-2 border-gray-700"
              />
            )}
            <p className="text-xl font-semibold">{user.name ?? 'Unbenannt'}</p>
            <p className="text-sm text-gray-400">{user.email}</p>
          </section>

          <section className="md:col-span-2 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">Airline</h2>
            {user.airline ? (
              <div>
                <p className="text-2xl font-bold">{user.airline.name}</p>
                <p className="text-gray-400">ICAO: {user.airline.icao} · Callsign: {user.airline.callsign}</p>
                <div className="mt-4 pt-4 border-t border-gray-800 flex gap-6 text-sm">
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">Rang</p>
                    <p className="font-medium mt-1">{user.rank?.name ?? 'Kein Rang'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">Rolle</p>
                    <p className="font-medium mt-1">{user.role?.name ?? 'Keine Rolle'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">Flugstunden</p>
                    <p className="font-medium mt-1">{user.totalFlightHours.toFixed(1)} h</p>
                  </div>
                  <div>
                    <p className="text-gray-500 uppercase tracking-wider text-xs">Flüge</p>
                    <p className="font-medium mt-1">{user.totalFlights}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-gray-400 mb-3">Du bist noch keiner Airline zugeordnet.</p>
                <p className="text-sm text-gray-500">
                  In einer späteren Version wirst du hier einer Airline beitreten können.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
