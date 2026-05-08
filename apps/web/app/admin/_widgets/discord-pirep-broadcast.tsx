import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Innovation-Item #4 (Track 3 #11.2.5 v1-Full Widget) — Realtime-Discord-
 * PIREP-Embed. vision-doc §9.2.10.
 *
 * # Was zeigt das?
 *
 * Status-card für die Discord-Bot-Bridge: PIREPs werden via fire-and-
 * forget HTTP an einen lokalen bot-server (localhost:BOT_HTTP_PORT)
 * geschickt, der dann discord-embeds in konfigurierten channels postet.
 *
 * Drei stats:
 *   1. **Bot-Health** — TCP-ping auf BOT_HTTP_PORT (3001 default).
 *      Online = bot läuft + akzeptiert events. Offline = events sind
 *      verloren (kein retry, fire-and-forget).
 *   2. **Broadcasts (24h)** — PIREP-events die in letzten 24h getriggered
 *      wurden: submitted, approved, rejected. Jedes flippt einen
 *      bot-call (der entweder erfolg oder fail-silent). Wir sehen hier
 *      nur die submission-side, nicht ob bot tatsächlich gepostet hat.
 *   3. **Latest broadcasts** — die 3 letzten PIREP-state-changes im
 *      system, mit pilot+route+timestamp.
 *
 * # Caveats
 *
 * - Kein direkter "broadcasts succeeded"-counter — das würde requesten
 *   dass der bot uns acknowledgements schickt + wir sie persistieren.
 *   Fire-and-forget ist absichtliche design-entscheidung um latency
 *   im pirep-submit-flow zu vermeiden.
 *
 * - Bot-health-check nutzt next.js fetch mit cache: 'no-store' + 1s
 *   timeout. Bei bot-offline wird der widget mit error-state rendern
 *   ohne die page komplett zu blockieren.
 */

interface BroadcastEntry {
  id: string;
  flightNumber: string | null;
  pilotName: string | null;
  departureIcao: string;
  arrivalIcao: string;
  // Drafts (option #19) are deliberately excluded — they're not
  // broadcast to Discord (the bot only fires on Submit). The status-
  // narrowing here matches the where-clause in getBroadcastStats which
  // filters status=Draft out before mapping to BroadcastEntry.
  status: 'Submitted' | 'Approved' | 'Rejected';
  changedAt: Date;
}

async function checkBotHealth(): Promise<'online' | 'offline' | 'unknown'> {
  const port = process.env.BOT_HTTP_PORT ?? '3001';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://localhost:${port}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}

async function getBroadcastStats() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [submitted24h, approved24h, rejected24h, recent] = await Promise.all([
    prisma.pirep.count({
      // Submitted-broadcasts (24h) means "PIREPs that were actually
      // submitted to Discord" — Drafts (option #19) write submittedAt
      // at Draft-create-time but don't fire emitPirepSubmitted until
      // the pilot manually submits. So filter to status=Submitted
      // here; Approved/Rejected are also already-broadcast (they
      // necessarily passed through Submitted earlier).
      where: { status: 'Submitted', submittedAt: { gte: last24h } },
    }),
    prisma.pirep.count({
      where: { approvedAt: { gte: last24h } },
    }),
    prisma.pirep.count({
      where: { rejectedAt: { gte: last24h } },
    }),
    prisma.pirep.findMany({
      where: {
        // Drafts (option #19) are not broadcast — exclude from the
        // recent-broadcasts list explicitly so the type narrows to
        // Submitted/Approved/Rejected and matches BroadcastEntry. The
        // submitted24h count above also stays clean: a Draft has the
        // default submittedAt=NOW() at create-time, but it doesn't go
        // out via emitPirepSubmitted until the pilot actually submits.
        status: { in: ['Submitted', 'Approved', 'Rejected'] },
        OR: [
          { submittedAt: { gte: last24h } },
          { approvedAt: { gte: last24h } },
          { rejectedAt: { gte: last24h } },
        ],
      },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        approvedAt: true,
        rejectedAt: true,
        route: { select: { flightNumber: true } },
        user: { select: { name: true } },
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
      },
      orderBy: [
        { rejectedAt: { sort: 'desc', nulls: 'last' } },
        { approvedAt: { sort: 'desc', nulls: 'last' } },
        { submittedAt: 'desc' },
      ],
      take: 3,
    }),
  ]);

  const recentEntries: BroadcastEntry[] = recent.map((p) => {
    // Pick the most-recent state-change timestamp for sorting/display
    const changedAt = p.rejectedAt ?? p.approvedAt ?? p.submittedAt;
    return {
      id: p.id,
      flightNumber: p.route?.flightNumber ?? null,
      pilotName: p.user.name,
      departureIcao: p.departure.icao,
      arrivalIcao: p.arrival.icao,
      // The where-clause above filtered out Draft, but Prisma's
      // generated PirepStatus type still includes it. Cast is safe
      // because the runtime guarantees match the type narrowing.
      status: p.status as BroadcastEntry['status'],
      changedAt,
    };
  });

  return { submitted24h, approved24h, rejected24h, recent: recentEntries };
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
}

export async function DiscordPirepBroadcast() {
  const [botHealth, stats] = await Promise.all([checkBotHealth(), getBroadcastStats()]);

  const totalBroadcasts = stats.submitted24h + stats.approved24h + stats.rejected24h;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden="true">💬</span>
          <span>Discord-PIREP-Broadcast</span>
        </CardTitle>
        <CardDescription>
          PIREP-events werden fire-and-forget an den Bot weitergeleitet.{' '}
          {botHealth === 'online' && (
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
              🟢 Bot online
            </span>
          )}
          {botHealth === 'offline' && (
            <span className="text-rose-700 dark:text-rose-400 font-medium">
              🔴 Bot offline (events verloren)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Stat value={stats.submitted24h} label="Submitted" sublabel="letzte 24h" />
          <Stat
            value={stats.approved24h}
            label="Approved"
            sublabel="letzte 24h"
            tone="emerald"
          />
          <Stat
            value={stats.rejected24h}
            label="Rejected"
            sublabel="letzte 24h"
            tone="rose"
          />
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
          Letzte Broadcasts
        </div>
        {stats.recent.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Keine Aktivität in den letzten 24h.{' '}
            {totalBroadcasts === 0 && '(Aggregat: 0 events)'}
          </p>
        ) : (
          <ul className="space-y-2">
            {stats.recent.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between text-sm p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={b.status} />
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {b.flightNumber ?? '(no route)'}{' '}
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {b.departureIcao}→{b.arrivalIcao}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {b.pilotName ?? '(unbenannt)'}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 ml-2">
                  {formatRelativeTime(b.changedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface StatProps {
  value: number;
  label: string;
  sublabel: string;
  tone?: 'default' | 'emerald' | 'rose';
}

function Stat({ value, label, sublabel, tone = 'default' }: StatProps) {
  const valueClass =
    tone === 'emerald'
      ? 'text-2xl font-bold text-emerald-700 dark:text-emerald-400'
      : tone === 'rose'
        ? 'text-2xl font-bold text-rose-700 dark:text-rose-400'
        : 'text-2xl font-bold text-gray-900 dark:text-white';

  return (
    <div>
      <div className={valueClass}>{value}</div>
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
        {label}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{sublabel}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: BroadcastEntry['status'] }) {
  const styles = {
    Submitted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    Approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    Rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  } as const;

  return (
    <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${styles[status]}`}>{status}</span>
  );
}
