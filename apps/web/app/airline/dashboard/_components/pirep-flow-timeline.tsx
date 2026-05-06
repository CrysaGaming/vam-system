import { prisma } from '@vam/db';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

/**
 * PirepFlowTimeline — Track 3 #11.2.5 v1-Full Operations-Widget #1.
 *
 * Zeigt die letzten 10 PIREPs der airline mit status-flow + click-through
 * zur PIREP-detail-page. Ergänzt die "PIREPs zur Prüfung"-KPI auf dem
 * /airline/dashboard mit kontext (welche pirep, von wem, in welchem status).
 *
 * # Design-Entscheidungen
 *
 * **Cross-status-anzeige**: Wir zeigen Submitted + Approved + Rejected,
 * nicht nur pending. Dashboards-vision §7.3 spricht von "PIREP-flow-
 * timeline" — der punkt ist die activity-übersicht, nicht die approval-
 * queue. Letztere hat ihre eigene seite (/pireps/pending). Cross-status
 * macht das widget auch nützlich wenn nichts pending ist.
 *
 * **Take 10**: Bewusst klein. Dashboard ist überblicks-tool, nicht das
 * full PIREP-listing (das ist /pireps oder /pireps/pending). 10 zeilen
 * passen in einen ungescrollten viewport-bereich neben den KPI-cards.
 *
 * **Status-badges semantic, nicht brand**: Submitted=gelb, Approved=grün,
 * Rejected=rot. Diese colors werden bewusst NICHT von --primary
 * gepickt — semantic-status soll konsistent über alle airlines lesbar
 * bleiben. Brand-color overflows in semantic-roles wäre ein UX-bug.
 *
 * **Relative time inline statt date-fns**: Das eine helper-pattern hier
 * lohnt keine library-dependency. Bei mehreren widgets/pages mit
 * relative-time-bedarf wird ein zentrales `lib/time.ts` extrahiert.
 */

interface PirepFlowTimelineProps {
  airlineId: string;
}

export async function PirepFlowTimeline({ airlineId }: PirepFlowTimelineProps) {
  const pireps = await prisma.pirep.findMany({
    where: { airlineId },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      flightTimeMin: true,
      user: { select: { name: true } },
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      route: { select: { flightNumber: true } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 10,
  });

  // Empty-state: keine PIREPs in der airline → widget komplett ausblenden.
  // Das vermeidet eine "leere tabelle"-anomalie. Der TODO-bereich für
  // Operations-Widgets weiter unten zeigt ohnehin dass mehr kommt.
  if (pireps.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">PIREP-Aktivität</h2>
        <Link
          href="/pireps/pending"
          className="text-xs text-primary hover:underline"
        >
          Alle anzeigen →
        </Link>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Pilot</th>
                <th className="px-4 py-3">Strecke</th>
                <th className="px-4 py-3">Flug</th>
                <th className="px-4 py-3 text-right">Dauer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Eingereicht</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {pireps.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <Link href={`/pireps/${p.id}`} className="block font-medium">
                      {p.user.name ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                    <Link href={`/pireps/${p.id}`} className="block">
                      {p.departure.icao} → {p.arrival.icao}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">
                    <Link href={`/pireps/${p.id}`} className="block">
                      {p.route?.flightNumber ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    <Link href={`/pireps/${p.id}`} className="block">
                      {formatDuration(p.flightTimeMin)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/pireps/${p.id}`} className="block">
                      <StatusBadge status={p.status} />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                    <Link href={`/pireps/${p.id}`} className="block">
                      {formatRelativeTime(p.submittedAt)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Status-badge mit semantic-colors. Approved=grün, Rejected=rot,
 * Submitted=gelb (= "warten auf review"). Bewusst nicht --primary
 * weil semantic-status kein brand-konzept ist.
 */
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Submitted:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    Approved:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    Rejected:
      'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  const labels: Record<string, string> = {
    Submitted: 'Wartet',
    Approved: 'Approved',
    Rejected: 'Rejected',
  };
  const className = styles[status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function formatDuration(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, '0')}min`;
}

/**
 * Relative-time formatter. "gerade eben" / "vor Nmin" / "vor Nh" / "vor NT"
 * für recent items, sonst absolute datum. Server-side rendered — kein
 * timezone-mismatch weil submittedAt UTC ist und wir mit Date.now() in der
 * server-timezone arbeiten. Für sub-minute-präzision: irrelevant, das
 * widget refresht beim nächsten dashboard-besuch.
 */
function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `vor ${days}T`;
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
