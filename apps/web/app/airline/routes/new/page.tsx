import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { RouteForm } from '../route-form';

/**
 * /airline/routes/new — wrapper für RouteForm im create-mode. Server-
 * component für auth-gate (gleiches pattern wie /airline/routes), passt
 * dann nur ein einfaches `mode: { kind: 'create' }` an die client-form
 * weiter.
 */
export default async function NewRoutePage() {
  const user = await requireAirlineManagerWithAirlinePage();
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Neue Route</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Lege eine einzelne route manuell an. Für viele routes auf einmal:{' '}
              <Link
                href="/airline/routes/import"
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                CSV-import
              </Link>
              .
            </p>
          </div>
          <Link
            href="/airline/routes"
            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
          >
            ← Zurück
          </Link>
        </header>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <RouteForm mode={{ kind: 'create' }} />
        </div>
      </div>
    </main>
  );
}
