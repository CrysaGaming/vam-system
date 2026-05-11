import Link from 'next/link';
import { prisma } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';

/**
 * Track 4 #100 (Section T) — System-Status-Dashboard.
 *
 * /admin/status — operational visibility für admins. Zeigt:
 *   - DB-connectivity + query-latency (per real prisma-roundtrip gemessen)
 *   - Entity-counts (users, airlines, events, pireps, bookings, ...)
 *   - Last-activity timestamps (letzter PIREP, letzte booking, last login)
 *   - Active live-sessions (ACARS connected pilots right now)
 *   - System-info (Node.js version, process-uptime, build-time)
 *
 * # Scope
 *
 * Read-only. Keine actions auf der page — pure information-display.
 * Hinter requireAdminPage (admins only). Page-segment cache: revalidate=15
 * für eine "fast-live"-experience ohne DB-thrashing.
 *
 * # Komplementär zum bestehenden /admin
 *
 * /admin ist das innovation-items-dashboard mit live-widgets + UI-glamour.
 * /admin/status ist die operations-perspective: "läuft die VM? wann war
 * letzter PIREP? wieviele user existieren?". Ergänzt nicht ersetzt.
 */

// 15s page-cache — "fast-live" ohne dauer-pressure auf DB.
export const revalidate = 15;

const BUILD_TIME = new Date().toISOString();
const PROCESS_START = Date.now();

interface SummaryCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: 'default' | 'emerald' | 'amber' | 'red';
}

function SummaryCard({ label, value, sublabel, tone = 'default' }: SummaryCardProps) {
  const toneStyles = {
    default: 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
    emerald:
      'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10',
    amber:
      'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10',
    red: 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10',
  };
  const labelTones = {
    default: 'text-gray-500 dark:text-gray-400',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-red-700 dark:text-red-400',
  };
  return (
    <div className={`border rounded-lg p-4 ${toneStyles[tone]}`}>
      <p
        className={`text-[10px] uppercase tracking-wide font-medium ${labelTones[tone]}`}
      >
        {label}
      </p>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
      {sublabel && (
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
          {sublabel}
        </p>
      )}
    </div>
  );
}

function formatRelative(date: Date | null): string {
  if (!date) return 'nie';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `vor ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `vor ${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `vor ${diffDay}d`;
}

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
}

export default async function AdminStatusPage() {
  await requireAdminPage();

  // DB-roundtrip-latency: ein leichter SELECT 1, gemessen via wall-clock.
  // Nicht perfekt — JIT/cache/connection-pool tainted das — aber für
  // "ist die DB reachable + ungefähr wie schnell"-display reicht's.
  const dbStartedAt = performance.now();
  let dbHealthy = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }
  const dbLatencyMs = Math.round(performance.now() - dbStartedAt);

  // Parallel: entity-counts + last-activity-timestamps. Alle queries sind
  // simple COUNT/MAX, das ist auch bei 10k+ rows schnell (sec-indexed
  // wo's relevant ist).
  //
  // "Active ACARS sessions" = LiveSession mit lastAcarsHeartbeat innerhalb
  // der letzten 2 minuten. Das matched dem Welle-9-heartbeat-pattern
  // (ACARS-client schickt ~jede 10s heartbeat; 2min cutoff fängt sowohl
  // network-blips als auch sauber-disconnected sessions).
  const acarsActiveCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const [
    userCount,
    airlineCount,
    aircraftCount,
    eventCount,
    pirepCount,
    pirepApprovedCount,
    pirepDraftCount,
    bookingCount,
    activeAcarsSessionsCount,
    lastPirep,
    lastBooking,
    lastAcarsEvent,
    lastEventCreated,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.airline.count(),
    prisma.aircraft.count(),
    prisma.event.count(),
    prisma.pirep.count(),
    prisma.pirep.count({ where: { status: 'Approved' } }),
    prisma.pirep.count({ where: { status: 'Draft' } }),
    prisma.booking.count(),
    prisma.liveSession.count({
      where: { lastAcarsHeartbeat: { gte: acarsActiveCutoff } },
    }),
    prisma.pirep.findFirst({
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true },
    }),
    prisma.booking.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.acarsEvent.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    }),
    prisma.event.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  // Process-info
  const uptimeMs = Date.now() - PROCESS_START;
  const nodeVersion = process.version;
  const memUsageMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">🩺 System-Status</h1>
            <Link
              href="/admin"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Admin-Dashboard
            </Link>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Operational health der instanz. Stand:{' '}
            {new Date().toLocaleString('de-DE')} · cache: 15s
          </p>
        </header>

        {/* DB Health + Process info */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Health & Process</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              label="DB-Status"
              value={dbHealthy ? '✓ OK' : '✗ FAIL'}
              sublabel="postgres reachable"
              tone={dbHealthy ? 'emerald' : 'red'}
            />
            <SummaryCard
              label="DB-Latency"
              value={`${dbLatencyMs}ms`}
              sublabel="SELECT 1 roundtrip"
              tone={
                dbLatencyMs < 20 ? 'emerald' : dbLatencyMs < 100 ? 'default' : 'amber'
              }
            />
            <SummaryCard
              label="Process-Uptime"
              value={formatUptime(uptimeMs)}
              sublabel="since dev-server start"
            />
            <SummaryCard
              label="RSS-Memory"
              value={`${memUsageMb} MB`}
              sublabel={nodeVersion}
              tone={memUsageMb < 512 ? 'default' : memUsageMb < 1024 ? 'amber' : 'red'}
            />
          </div>
        </section>

        {/* Entity counts */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Entities</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="User" value={userCount} sublabel="alle accounts" />
            <SummaryCard
              label="Airlines"
              value={airlineCount}
              sublabel="virtual airlines"
            />
            <SummaryCard
              label="Aircraft"
              value={aircraftCount}
              sublabel="alle airframes"
            />
            <SummaryCard label="Events" value={eventCount} sublabel="alle stati" />
            <SummaryCard label="Bookings" value={bookingCount} />
            <SummaryCard
              label="PIREPs"
              value={pirepCount}
              sublabel={`${pirepApprovedCount} approved`}
              tone="emerald"
            />
            <SummaryCard
              label="PIREPs draft"
              value={pirepDraftCount}
              sublabel="auto-PIREPs to review"
              tone={pirepDraftCount > 0 ? 'amber' : 'default'}
            />
            <SummaryCard
              label="ACARS active"
              value={activeAcarsSessionsCount}
              sublabel="heartbeat ≤ 2min"
              tone={activeAcarsSessionsCount > 0 ? 'emerald' : 'default'}
            />
          </div>
        </section>

        {/* Last-activity timestamps */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Letzte Aktivität</h2>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            <ActivityRow
              label="Letzter PIREP submitted"
              date={lastPirep?.submittedAt ?? null}
            />
            <ActivityRow
              label="Letzte Booking erstellt"
              date={lastBooking?.createdAt ?? null}
            />
            <ActivityRow
              label="Letztes ACARS-Event"
              date={lastAcarsEvent?.timestamp ?? null}
            />
            <ActivityRow
              label="Letztes Event erstellt"
              date={lastEventCreated?.createdAt ?? null}
            />
          </div>
        </section>

        {/* Info footer */}
        <aside className="bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Verwandte tools:</strong>{' '}
            <Link href="/admin/audit" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              📜 Audit-Log
            </Link>{' '}
            zeigt admin-action-history.{' '}
            <Link href="/admin/perf" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              ⏱ Perf-Monitor
            </Link>{' '}
            zeigt slow-queries (≥ 200ms) im in-memory ring-buffer.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              DB-Latency-bewertung:
            </strong>{' '}
            &lt;20ms = lokal/optimal (emerald), 20-100ms = ok (default), &gt;100ms
            = beobachten.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Process-Uptime:
            </strong>{' '}
            Misst seit dem letzten Node.js-process-start, nicht seit deployment.
            Bei dev-server-restart resettet.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Cache:</strong>{' '}
            Page-segment caches 15s — bei page-visit wird der wert max 15s alt
            sein. Force-refresh: hard-reload (Ctrl+Shift+R).
          </p>
        </aside>
      </div>
    </main>
  );
}

function ActivityRow({ label, date }: { label: string; date: Date | null }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <div className="text-right">
        <div className="font-mono text-sm font-medium">{formatRelative(date)}</div>
        {date && (
          <div className="text-[10px] text-gray-500 dark:text-gray-500">
            {date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
        )}
      </div>
    </div>
  );
}
