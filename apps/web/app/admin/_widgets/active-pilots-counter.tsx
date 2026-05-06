import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Innovation-Item #1 (Track 3 #11.2.5 v1-Full Widget) — Active-Pilots-
 * Counter (Live). vision-doc §9.1.13.
 *
 * # Was zeigt das?
 *
 * Drei zahlen am puls der plattform:
 *
 *   1. **Live in flight** — count distinct user mit Pirep.state in
 *      [Departed, Airborne]. "Wer ist gerade in der luft." Verbleibt
 *      bis der pilot Landed/Cancelled drückt — bei stale Pireps
 *      (nie geclosed) zählt's weiter, das ist der bekannte rauschpegel.
 *
 *   2. **Recent submits (30 min)** — count distinct user mit
 *      Pirep.submittedAt > now - 30min. "Wer hat gerade einen flight
 *      eingecheckt." Tracking-perspektive auf den approval-flow am
 *      airline-/admin-table.
 *
 *   3. **Total active (union)** — distinct user-IDs aus beiden mengen.
 *      Das ist die "lebenszeichen-zahl" für das gesamte vam-system.
 *
 * # Datasource
 *
 * Wir queryn nur Pirep — KEINE separate AcarsEvent-position-tabelle
 * weil das (a) optional ist (acars-clients sind opt-in) und (b) die
 * recency hier sowieso aus dem Pirep-state ableitbar ist (state-
 * transitions schreiben ja PIREP-rows). Für die ZUKUNFT könnten wir
 * AcarsEvent.createdAt > now-5min als drittes signal addieren — der
 * helper hier ist deliberat klein gehalten damit das einfach ist.
 *
 * # Live-update-strategie
 *
 * Server-component mit `revalidate = 30` (next.js segment-config).
 * Heißt: bei jedem render (page-visit) max 30 sekunden alt. Reicht
 * für den "puls-feel" ohne websockets. Echter realtime-push ist
 * separates ticket (vision-doc §9.2.1 Live-Settings via WebSockets).
 *
 * # Caveats
 *
 * - Stale Pireps (state=Airborne aber pilot ist offline) verzerren
 *   den live-count nach oben. Lösung wäre staleness-window (z.B.
 *   ignore wenn submittedAt > 12h alt UND noch nicht Landed). Für
 *   v1 akzeptiert; bei merklichen problemen ergänzen.
 * - "Distinct user" über union der zwei mengen muss in app-code
 *   gemerged werden weil Prisma kein UNION-distinct out-of-box.
 *   Bei wenigen aktiven (< 50) trivial; bei skala kommt eine
 *   raw-query.
 */

const LOOKBACK_MINUTES = 30;

async function getActivityCounts() {
  const lookbackCutoff = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);

  // Parallel-fetch beide mengen, jeweils nur die userIds.
  const [liveFlying, recentSubmits] = await Promise.all([
    prisma.pirep.findMany({
      where: { state: { in: ['Departed', 'Airborne'] } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.pirep.findMany({
      where: { submittedAt: { gt: lookbackCutoff } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  const liveSet = new Set(liveFlying.map((p) => p.userId));
  const recentSet = new Set(recentSubmits.map((p) => p.userId));
  const totalActive = new Set([...liveSet, ...recentSet]);

  return {
    liveCount: liveSet.size,
    recentCount: recentSet.size,
    totalCount: totalActive.size,
  };
}

export async function ActivePilotsCounter() {
  const { liveCount, recentCount, totalCount } = await getActivityCounts();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden="true">🟢</span>
          <span>Live-Aktivität</span>
        </CardTitle>
        <CardDescription>
          Wer ist gerade aktiv im VAM-System.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <Stat
            value={liveCount}
            label="Live in Flight"
            sublabel="state=Departed|Airborne"
          />
          <Stat
            value={recentCount}
            label="Submits"
            sublabel={`letzte ${LOOKBACK_MINUTES} min`}
          />
          <Stat
            value={totalCount}
            label="Aktive Piloten"
            sublabel="distinct (live ∪ recent)"
            highlight
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface StatProps {
  value: number;
  label: string;
  sublabel: string;
  highlight?: boolean;
}

function Stat({ value, label, sublabel, highlight = false }: StatProps) {
  return (
    <div>
      <div
        className={
          highlight
            ? 'text-3xl font-bold text-primary'
            : 'text-3xl font-bold text-gray-900 dark:text-white'
        }
      >
        {value}
      </div>
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
        {label}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {sublabel}
      </div>
    </div>
  );
}
