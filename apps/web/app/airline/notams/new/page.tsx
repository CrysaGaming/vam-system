/**
 * Welle L / L5 — /airline/notams/new page.
 */

import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import NewNotamForm from './_form';

export const dynamic = 'force-dynamic';

export default async function NewNotamPage() {
  await requireAirlineManagerWithAirlinePage();

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/airline/notams"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur NOTAM-Liste
          </Link>
        </nav>
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="text-2xl font-bold">Neuer NOTAM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informiere deine pilots über schedule-änderungen, closures,
            procedures.
          </p>
        </header>
        <NewNotamForm />
      </div>
    </main>
  );
}
