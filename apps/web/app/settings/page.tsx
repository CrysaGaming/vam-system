import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { ConnectionCard } from './connection-card';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; provider?: string; reason?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await searchParams;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      discordId: true,
      vatsimCid: true,
      vatsimVerifiedAt: true,
      ivaoVid: true,
      ivaoVerifiedAt: true,
    },
  });

  if (!user) redirect('/');

  const statusBanner =
    params.status === 'success' && params.provider
      ? {
          type: 'success' as const,
          message: `${params.provider.toUpperCase()} erfolgreich verbunden`,
        }
      : params.status === 'error' && params.provider
        ? {
            type: 'error' as const,
            message: `Verbindung mit ${params.provider.toUpperCase()} fehlgeschlagen${params.reason ? `: ${params.reason}` : ''}`,
          }
        : params.status === 'disconnected' && params.provider
          ? {
              type: 'success' as const,
              message: `${params.provider.toUpperCase()} getrennt`,
            }
          : null;

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Einstellungen</h1>
            <p className="text-gray-400 text-sm mt-1">
              Account-Verknüpfungen und Präferenzen
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        {statusBanner && (
          <div
            className={`mb-6 px-4 py-3 rounded border text-sm ${
              statusBanner.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}
          >
            {statusBanner.message}
          </div>
        )}

        {/* Profil-Übersicht */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Profil
          </h2>
          <div className="flex items-center gap-4">
            {user.image ? (
              <img
                src={user.image}
                alt={user.name ?? 'Avatar'}
                className="w-16 h-16 rounded-full border border-gray-700"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700" />
            )}
            <div>
              <p className="text-lg font-semibold">{user.name ?? 'Unbenannt'}</p>
              <p className="text-sm text-gray-400">{user.email}</p>
            </div>
          </div>
        </section>

        {/* Account-Verknüpfungen */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Account-Verknüpfungen
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            Verknüpfe deine Netzwerk-Accounts um Live-Tracking, Flight-Stats und
            automatische PIREP-Erkennung zu aktivieren.
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            {/* Discord (already linked via NextAuth) */}
            <ConnectionCard
              provider="discord"
              name="Discord"
              icon="💬"
              colorClass="bg-indigo-500"
              connected={!!user.discordId}
              accountId={user.discordId}
              verified={true}
              note="Über Discord verbunden — wird für Login verwendet"
              canDisconnect={false}
            />

            {/* VATSIM */}
            <ConnectionCard
              provider="vatsim"
              name="VATSIM"
              icon="✈️"
              colorClass="bg-blue-500"
              connected={!!user.vatsimCid}
              accountId={user.vatsimCid?.toString() ?? null}
              verified={!!user.vatsimVerifiedAt}
              verifiedAt={user.vatsimVerifiedAt}
              canDisconnect={true}
            />

            {/* IVAO */}
            <ConnectionCard
              provider="ivao"
              name="IVAO"
              icon="🛫"
              colorClass="bg-emerald-500"
              connected={!!user.ivaoVid}
              accountId={user.ivaoVid?.toString() ?? null}
              verified={!!user.ivaoVerifiedAt}
              verifiedAt={user.ivaoVerifiedAt}
              canDisconnect={true}
            />
          </div>
        </section>
      </div>
    </main>
  );
}