import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { LiveMap } from './live-map';

export default async function LivePage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (!mapboxToken) {
    return (
      <main className="min-h-screen bg-gray-950 text-white p-8">
        <p>Mapbox nicht konfiguriert</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <header className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Live Tracker</h1>
          <p className="text-xs text-gray-400">Echtzeit-Tracker</p>
        </div>
        <a href="/dashboard" className="px-4 py-2 bg-gray-800 rounded text-sm">Dashboard</a>
      </header>
      <LiveMap mapboxToken={mapboxToken} />
    </main>
  );
}