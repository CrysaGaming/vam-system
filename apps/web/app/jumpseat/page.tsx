import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { JumpseatForm } from './jumpseat-form';

/**
 * /jumpseat — Pilot-self-service zum repositionieren ohne flug. Listet
 * alle hubs der user-airline als wählbare ziele und zeigt die letzten
 * 10 transfers als history.
 *
 * Auth-gate: jeder eingeloggte user mit airline-zuordnung. Keine spezielle
 * rolle nötig — jumpseat ist ein pilot-feature, kein admin-tool. Server-
 * action validiert nochmal dass der user eine airline hat.
 *
 * Layout-decisions:
 * - Server-component für initial-render (hubs + history vor-fetched)
 * - Form als client-component eingebettet (radio-cards mit hover-states,
 *   useActionState für error/success-feedback)
 * - History rechts (lg+) bzw. unten (mobile) — bewusst sichtbar damit
 *   der user seinen audit-trail nachvollziehen kann
 *
 * Out-of-scope für Welle 4:
 * - Kosten-display (alle transfers free in Welle 4)
 * - Ranking/cooldown-UI
 * - Admin-jumpseat-flow (admin verschiebt anderen pilot) — kommt
 *   separat unter /admin/pilots
 */
export default async function JumpseatPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      airlineId: true,
      airline: { select: { name: true } },
      baseIcao: true,
      currentLocationIcao: true,
      currentLocationSource: true,
      currentLocationAt: true,
    },
  });

  if (!user || !user.airlineId || !user.airline) {
    redirect('/dashboard');
  }

  // Hubs der eigenen airline. Primary first damit der user die default-
  // option oben sieht (auch wenn pre-select base-driven ist).
  const hubs = await prisma.airlineHub.findMany({
    where: { airlineId: user.airlineId },
    include: {
      airport: {
        select: { icao: true, name: true, city: true, country: true },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { airportIcao: 'asc' }],
  });

  // Wenn die airline 0 hubs hat → kein jumpseat möglich. Showe stattdessen
  // hint mit verlink zur hub-admin-seite (für admins) bzw zur info dass
  // ein admin erst hubs anlegen muss.
  const hasHubs = hubs.length > 0;

  // Position-context (für header-block + form-default).
  const currentLocation = user.currentLocationIcao
    ? await prisma.airport.findUnique({
        where: { icao: user.currentLocationIcao },
        select: { icao: true, name: true, city: true, country: true },
      })
    : null;

  // Letzte 10 transfers — zeigen wir als history-list rechts/unten.
  const recentTransfers = await prisma.jumpseatTransfer.findMany({
    where: { userId: user.id },
    include: {
      fromAirport: { select: { icao: true, name: true, city: true } },
      toAirport: { select: { icao: true, name: true, city: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Map hubs → form-prop-shape mit isCurrent-flag.
  const hubOptions = hubs.map((h) => ({
    airportIcao: h.airportIcao,
    airportName: h.airport.name,
    airportCity: h.airport.city,
    isPrimary: h.isPrimary,
    isCurrent: h.airportIcao === user.currentLocationIcao,
  }));

  // Reason-display-helper für history-list (enum → human-readable).
  const reasonLabel = (
    r: 'RETURN_TO_HUB' | 'HUB_TO_HUB' | 'POSITIONING' | 'ADMIN_TRANSFER',
  ): string => {
    switch (r) {
      case 'RETURN_TO_HUB':
        return 'Return to Hub';
      case 'HUB_TO_HUB':
        return 'Hub to Hub';
      case 'POSITIONING':
        return 'Positioning';
      case 'ADMIN_TRANSFER':
        return 'Admin Transfer';
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Jumpseat</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} — Reposition ohne Flug zwischen deinen Hubs
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        {/* Position-status-block */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-2">
            Aktueller Standort
          </h2>
          {user.currentLocationIcao ? (
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-2xl" aria-hidden="true">📍</span>
              <p className="text-xl font-mono font-bold">
                {user.currentLocationIcao}
              </p>
              {currentLocation && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {currentLocation.name}
                  {currentLocation.city && ` · ${currentLocation.city}`}
                </p>
              )}
              {user.currentLocationAt && (
                <p className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                  Quelle: {user.currentLocationSource} ·{' '}
                  {user.currentLocationAt.toLocaleString('de-DE', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-500 italic">
              Position unbekannt — reiche erst einen PIREP ein.
            </p>
          )}
        </section>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Form-section (col-span-2 auf lg+) */}
          <section className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Neues Jumpseat-Transfer</h2>

            {!hasHubs ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-4 text-sm text-amber-700 dark:text-amber-300">
                <p className="font-medium mb-1">Keine Hubs verfügbar</p>
                <p>
                  Deine Airline hat noch keine Hubs angelegt.
                  Bitte einen Airline-Admin{' '}
                  <Link href="/airline/hubs" className="underline hover:no-underline">
                    Hubs hinzuzufügen
                  </Link>
                  , bevor du Jumpseats nutzen kannst.
                </p>
              </div>
            ) : !user.currentLocationIcao ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-4 text-sm text-amber-700 dark:text-amber-300">
                <p className="font-medium mb-1">Keine bekannte Position</p>
                <p>
                  Du brauchst eine bekannte Position bevor du jumpseaten kannst.
                  Reiche einen PIREP ein oder lass dich vom Admin manuell
                  positionieren.
                </p>
              </div>
            ) : hubs.length === 1 && hubs[0]!.airportIcao === user.currentLocationIcao ? (
              <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-4 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  Deine Airline hat nur einen Hub und du bist bereits dort.
                  Es gibt nichts wohin du jumpseaten könntest.
                </p>
              </div>
            ) : (
              <JumpseatForm hubs={hubOptions} baseIcao={user.baseIcao} />
            )}
          </section>

          {/* History-section (col-span-1 rechts) */}
          <aside className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Letzte Jumpseats</h2>
            {recentTransfers.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-500 italic">
                Noch keine Jumpseats durchgeführt.
              </p>
            ) : (
              <ol className="space-y-3">
                {recentTransfers.map((t) => (
                  <li
                    key={t.id}
                    className="text-sm border-l-2 border-indigo-500/40 pl-3 py-1"
                  >
                    <p className="font-mono">
                      <span className="text-gray-600 dark:text-gray-400">{t.fromIcao}</span>
                      <span className="mx-2 text-gray-400">→</span>
                      <span className="font-bold">{t.toIcao}</span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                      {reasonLabel(t.reason)}{' '}
                      ·{' '}
                      {t.createdAt.toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {t.notes && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic">
                        {t.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>

        {/* Info-footer */}
        <aside className="mt-8 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Was ist ein Jumpseat?</strong>{' '}
            Ein Jumpseat ist eine Repositionierung ohne Flug — typischerweise
            wenn du nach einem Flug an einem Outstation gestrandet bist und
            zurück zu deiner Base willst, oder zwischen Hubs wechseln möchtest.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Welle 4:</strong>{' '}
            Aktuell sind alle Jumpseats kostenlos und unrestricted. Mit dem
            Economy-System (Welle 12+) kommen Kosten und Cooldowns hinzu.
          </p>
        </aside>
      </div>
    </main>
  );
}
