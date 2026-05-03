import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { listRanksWithStats } from './actions';
import { RankForm } from './rank-form';
import { DeleteRankButton } from './delete-rank-button';
import { ReEvaluateRanksButton } from './re-evaluate-button';

/**
 * /airline/ranks — Rank-Verwaltung für airline-admins (Welle 6 commit 6B-1,
 * erweitert in 6B-3 mit re-evaluate-action).
 *
 * Zeigt alle ranks der eigenen airline sortiert nach order asc, mit add-form
 * inline oben (analog /airline/aircraft pattern). Pro rank: name, minHours-
 * threshold, user-count, edit-link, delete-button. Plus re-evaluate-button
 * in einer eigenen section (6B-3) für manual bulk-promotion-runs.
 *
 * Auth-gate: AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor) —
 * spiegelt actions.ts requireAirlineAdmin.
 *
 * Layout-decisions:
 * - Server-component für initial-render (kein client-fetch-flicker)
 * - Add-form inline oben statt /airline/ranks/new — ranks sind so simpel
 *   (3 felder), eine separate page wäre overkill
 * - Edit hingegen läuft über separate page weil das form 100% gleich aussieht
 *   wie das add-form aber mit pre-filled values; inline-edit pro row wäre
 *   visual-clutter mit allen den disclosure-elements
 *
 * Out-of-scope:
 * - Drag-drop reorder → wenn user-feedback kommt
 * - Per-rank discord-role-mapping → existiert in DiscordRoleMapping table,
 *   aber UI-flow gehört in einen separaten "Discord-Integration"-bereich
 * - Promotion-history (audit-log) → später
 */
export default async function AirlineRanksPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: { select: { name: true } } },
  });

  const allowedRoles = ['admin', 'airline-admin', 'instructor'];
  if (
    !user?.role ||
    !allowedRoles.includes(user.role.name) ||
    !user.airlineId ||
    !user.airline
  ) {
    redirect('/dashboard');
  }

  const ranks = await listRanksWithStats();

  // Duplicate-order-detection für UI-warning (admin sieht dass zwei ranks
  // dieselbe order haben — kann visuell konfusion erzeugen). Nicht blockierend,
  // nur informativ — oft transient während admin reorganisiert.
  const orderCounts = new Map<number, number>();
  for (const r of ranks) {
    orderCounts.set(r.order, (orderCounts.get(r.order) ?? 0) + 1);
  }
  const duplicateOrders = Array.from(orderCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([order]) => order);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Ränge</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} —{' '}
              {ranks.length === 0
                ? 'Noch keine Ränge angelegt'
                : `${ranks.length} ${ranks.length === 1 ? 'Rang' : 'Ränge'} definiert`}
            </p>
          </div>

          <Link
            href="/airline"
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Airline-Verwaltung
          </Link>
        </header>

        {/* Add-form section */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-1">Neuen Rang anlegen</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Definiere einen neuen Rang mit Stunden-Threshold für die
            auto-promotion. Reihenfolge bestimmt die Hierarchie (niedrig =
            unten, hoch = oben).
          </p>
          <RankForm mode={{ kind: 'create' }} compact />
        </section>

        {/* Duplicate-order warning */}
        {duplicateOrders.length > 0 && (
          <div className="mb-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
            ⚠ Mehrere Ränge teilen sich die Reihenfolge{' '}
            {duplicateOrders.map((o, i) => (
              <span key={o} className="font-mono">
                {o}
                {i < duplicateOrders.length - 1 ? ', ' : ''}
              </span>
            ))}
            . Das ist OK während du umorganisierst, aber für die finale
            Hierarchie sollte jeder Rang eine eindeutige Reihenfolge haben.
          </div>
        )}

        {/* Ranks list */}
        {ranks.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
              Noch keine Ränge angelegt
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-md mx-auto">
              Lege oben deinen ersten Rang an. Eine typische Hierarchie:
              Cadet (0h) → First Officer (50h) → Senior FO (250h) → Captain
              (1500h) → Senior Captain (3000h).
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 w-16 text-center">#</th>
                  <th className="px-4 py-3">Rang</th>
                  <th className="px-4 py-3 text-right">Min. Std.</th>
                  <th className="px-4 py-3 text-right">Piloten</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {ranks.map((rank) => (
                  <tr
                    key={rank.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition"
                  >
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center justify-center w-8 h-8 rounded font-mono text-xs font-semibold ${
                          duplicateOrders.includes(rank.order)
                            ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                            : 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                        }`}
                      >
                        {rank.order}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{rank.name}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">
                      {rank.minFlightHours.toFixed(1)} h
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rank.userCount === 0 ? (
                        <span className="text-gray-400 dark:text-gray-600 text-xs italic">
                          keine
                        </span>
                      ) : (
                        <span
                          className="inline-block px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 tabular-nums"
                          title={`${rank.userCount} ${rank.userCount === 1 ? 'Pilot hat' : 'Piloten haben'} diesen Rang`}
                        >
                          {rank.userCount}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/airline/ranks/${rank.id}/edit`}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
                        >
                          Bearbeiten
                        </Link>
                        <DeleteRankButton
                          rankId={rank.id}
                          rankName={rank.name}
                          hasUsers={rank.userCount > 0}
                          userCount={rank.userCount}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Re-evaluate section (Welle 6B-3). Nur sinnvoll wenn ranks UND
            piloten existieren — sonst hat auto-promotion eh nichts zu tun. */}
        {ranks.length > 0 && (
          <section className="mt-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-1">Auto-Promotion neu auswerten</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Lässt die promotion-logik manuell über alle piloten der airline
              laufen. Sinnvoll nach änderung an{' '}
              <code>minFlightHours</code>-Thresholds oder nach einfügen
              eines neuen Zwischenrangs — sonst würden piloten erst beim
              nächsten PIREP-submit hochgestuft. Demote läuft NICHT — wer
              jetzt unter dem threshold ist, behält seinen rang.
            </p>
            <ReEvaluateRanksButton />
          </section>
        )}

        {/* Info-footer */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Auto-Promotion:
            </strong>{' '}
            Piloten werden automatisch in den höchsten Rang promotet, dessen{' '}
            <code>minFlightHours</code>-Threshold sie erreicht haben. Die
            Auto-Promotion läuft nach jedem PIREP-Submit (sofort beim
            einreichen, nicht erst beim approval) und kann oben über
            &ldquo;Ränge neu auswerten&rdquo; auch manuell für alle piloten
            getriggert werden.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Manuelle Zuweisung:
            </strong>{' '}
            Admins können Ränge auch manuell setzen — z.B. wenn ein neuer
            Pilot schon Stunden aus einer anderen Airline mitbringt. Die
            manuelle Zuweisung passiert in der{' '}
            <Link
              href="/airline"
              className="text-indigo-600 dark:text-indigo-400 underline"
            >
              Airline-Verwaltung
            </Link>{' '}
            (Member-Tabelle).
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Reihenfolge:
            </strong>{' '}
            Der <code>Reihenfolge</code>-Wert legt die Hierarchie fest. 0 ist
            der niedrigste Rang (Entry-level), 999 der höchste. Standard-
            Hierarchie: 0 (Cadet), 10 (FO), 20 (Senior FO), 30 (Captain),
            40 (Senior Captain). Lass platz dazwischen damit du später
            Zwischenränge einfügen kannst.
          </p>
        </aside>
      </div>
    </main>
  );
}
