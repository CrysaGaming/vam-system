/**
 * Welle L / L2 — /airline/pairings/new page.
 */

import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import NewPairingForm from './_form';

export const dynamic = 'force-dynamic';

export default async function NewPairingPage() {
  await requireAirlineManagerWithAirlinePage();

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-2xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/airline/pairings"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur Pairings-Liste
          </Link>
        </nav>
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="text-2xl font-bold">Neue Crew-Pairing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bündele mehrere scheduled-flights als duty-period.
          </p>
        </header>
        <NewPairingForm />
      </div>
    </main>
  );
}
