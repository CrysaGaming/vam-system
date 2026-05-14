/**
 * Welle K / K5 — /trips/new page.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import NewTripForm from './_form';

export const dynamic = 'force-dynamic';

export default async function NewTripPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-2xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/trips"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur trip-liste
          </Link>
        </nav>
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="text-2xl font-bold">Neuer Inter-Airline-Trip</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Du wirst auto-participant + organizer. Pilots aus ALLEN airlines
            können dem trip beitreten.
          </p>
        </header>
        <NewTripForm />
      </div>
    </main>
  );
}
