import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { LiveMap } from './live-map';

export default async function LivePage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (!mapboxToken) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
        <p>Mapbox nicht konfiguriert</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Live Tracker</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Echtzeit-Tracker</p>
        </div>
        <a href="/dashboard" className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition">Dashboard</a>
      </header>
      <LiveMap mapboxToken={mapboxToken} />
    </main>
  );
}
