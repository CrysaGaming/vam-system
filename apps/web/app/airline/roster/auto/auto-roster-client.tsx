'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  previewAutoRoster,
  commitAutoRosterAssignments,
  type CommitAutoRosterResult,
} from '../actions';
import type { AutoRosterPreview } from '@/lib/roster/auto-roster';

/**
 * Track 5 #28 — Auto-Rostering wizard client-component
 *
 * Manages 3-stage flow: CONFIG → PREVIEW → COMMITTED.
 * Pure react-state + useTransition; kein form-library, kein store.
 */

type Pilot = {
  id: string;
  name: string | null;
  totalFlightHours: number;
  rankName: string | null;
};

type Props = {
  pilots: Pilot[];
  defaultFromDate: string;
  defaultToDate: string;
};

type Stage = 'config' | 'preview' | 'committed';

export function AutoRosterClient({ pilots, defaultFromDate, defaultToDate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stage, setStage] = useState<Stage>('config');
  const [error, setError] = useState<string | null>(null);

  // Config-state
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  // Filter-mode: 'all' = alle ACTIVE, 'whitelist' = nur diese, 'blacklist' = außer diese
  const [filterMode, setFilterMode] = useState<'all' | 'whitelist' | 'blacklist'>('all');
  const [filterPilotIds, setFilterPilotIds] = useState<Set<string>>(new Set());
  const [maxFlightsPerPilot, setMaxFlightsPerPilot] = useState<string>('');
  const [sendPushNotifications, setSendPushNotifications] = useState(true);

  // Preview-state
  const [preview, setPreview] = useState<AutoRosterPreview | null>(null);
  // Map<scheduledFlightId, includeInCommit (bool)>. Default: true für alle
  // assignable proposals. Admin kann individuell ausschalten.
  const [includeMap, setIncludeMap] = useState<Map<string, boolean>>(new Map());

  // Commit-state
  const [commitResult, setCommitResult] = useState<CommitAutoRosterResult | null>(null);

  function togglePilotInFilter(id: string) {
    setFilterPilotIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runPreview() {
    setError(null);
    startTransition(async () => {
      try {
        // Date-range patching: from = T00:00:00Z, to = T23:59:59Z
        const fromIso = `${fromDate}T00:00:00.000Z`;
        const toIso = `${toDate}T23:59:59.999Z`;

        const result = await previewAutoRoster({
          fromDate: fromIso,
          toDate: toIso,
          pilotIdsWhitelist:
            filterMode === 'whitelist' && filterPilotIds.size > 0
              ? Array.from(filterPilotIds)
              : undefined,
          pilotIdsBlacklist:
            filterMode === 'blacklist' && filterPilotIds.size > 0
              ? Array.from(filterPilotIds)
              : undefined,
          maxFlightsPerPilot: maxFlightsPerPilot
            ? Number(maxFlightsPerPilot)
            : undefined,
        });
        setPreview(result);
        // Auto-include alle assignable proposals
        const initialMap = new Map<string, boolean>();
        for (const p of result.proposals) {
          if (p.pickedPilotId) initialMap.set(p.scheduledFlightId, true);
        }
        setIncludeMap(initialMap);
        setStage('preview');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unbekannter Fehler bei der Generierung.',
        );
      }
    });
  }

  function toggleInclude(flightId: string) {
    setIncludeMap((prev) => {
      const next = new Map(prev);
      next.set(flightId, !next.get(flightId));
      return next;
    });
  }

  function runCommit() {
    if (!preview) return;
    setError(null);

    // Group: pilotId → [scheduledFlightIds...]
    const groups: Record<string, string[]> = {};
    for (const p of preview.proposals) {
      if (!p.pickedPilotId) continue;
      if (!includeMap.get(p.scheduledFlightId)) continue;
      groups[p.pickedPilotId] = groups[p.pickedPilotId] ?? [];
      groups[p.pickedPilotId].push(p.scheduledFlightId);
    }

    if (Object.keys(groups).length === 0) {
      setError('Keine Assignments zum Committen ausgewählt.');
      return;
    }

    startTransition(async () => {
      try {
        const result = await commitAutoRosterAssignments({
          assignmentsByPilot: groups,
          sendPushNotifications,
        });
        setCommitResult(result);
        setStage('committed');
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unbekannter Fehler beim Committen.',
        );
      }
    });
  }

  function resetAll() {
    setStage('config');
    setPreview(null);
    setCommitResult(null);
    setIncludeMap(new Map());
    setError(null);
  }

  // ─── Derived: aggregat-stats für preview-header ───
  const previewStats = useMemo(() => {
    if (!preview) return null;
    const assigned = preview.proposals.filter((p) => p.pickedPilotId).length;
    const included = Array.from(includeMap.values()).filter(Boolean).length;
    return {
      totalFlights: preview.proposals.length,
      assigned,
      unassignable: preview.unassignableCount,
      included,
    };
  }, [preview, includeMap]);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {stage === 'config' && (
        <ConfigForm
          pilots={pilots}
          fromDate={fromDate}
          setFromDate={setFromDate}
          toDate={toDate}
          setToDate={setToDate}
          filterMode={filterMode}
          setFilterMode={setFilterMode}
          filterPilotIds={filterPilotIds}
          togglePilotInFilter={togglePilotInFilter}
          maxFlightsPerPilot={maxFlightsPerPilot}
          setMaxFlightsPerPilot={setMaxFlightsPerPilot}
          sendPushNotifications={sendPushNotifications}
          setSendPushNotifications={setSendPushNotifications}
          onRun={runPreview}
          isPending={isPending}
        />
      )}

      {stage === 'preview' && preview && previewStats && (
        <PreviewView
          preview={preview}
          stats={previewStats}
          includeMap={includeMap}
          onToggleInclude={toggleInclude}
          onCommit={runCommit}
          onBack={() => setStage('config')}
          isPending={isPending}
        />
      )}

      {stage === 'committed' && commitResult && (
        <CommittedView
          result={commitResult}
          onAgain={resetAll}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ConfigForm
// ─────────────────────────────────────────────────────────────────────

type ConfigFormProps = {
  pilots: Pilot[];
  fromDate: string;
  setFromDate: (s: string) => void;
  toDate: string;
  setToDate: (s: string) => void;
  filterMode: 'all' | 'whitelist' | 'blacklist';
  setFilterMode: (m: 'all' | 'whitelist' | 'blacklist') => void;
  filterPilotIds: Set<string>;
  togglePilotInFilter: (id: string) => void;
  maxFlightsPerPilot: string;
  setMaxFlightsPerPilot: (s: string) => void;
  sendPushNotifications: boolean;
  setSendPushNotifications: (b: boolean) => void;
  onRun: () => void;
  isPending: boolean;
};

function ConfigForm(props: ConfigFormProps) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          1. Zeitraum
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Von (UTC)</span>
            <input
              type="date"
              value={props.fromDate}
              onChange={(e) => props.setFromDate(e.target.value)}
              className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Bis (UTC)</span>
            <input
              type="date"
              value={props.toDate}
              onChange={(e) => props.setToDate(e.target.value)}
              className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          2. Pilot-Filter
        </h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['all', 'whitelist', 'blacklist'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => props.setFilterMode(mode)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                props.filterMode === mode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {mode === 'all'
                ? 'Alle aktiven Piloten'
                : mode === 'whitelist'
                  ? 'Nur diese (Whitelist)'
                  : 'Außer diese (Blacklist)'}
            </button>
          ))}
        </div>
        {props.filterMode !== 'all' && (
          <div className="max-h-64 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {props.pilots.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <input
                      type="checkbox"
                      checked={props.filterPilotIds.has(p.id)}
                      onChange={() => props.togglePilotInFilter(p.id)}
                      className="accent-indigo-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{p.name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.rankName ?? 'Kein Rang'} · {p.totalFlightHours.toFixed(1)}h
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          3. Optionen
        </h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm max-w-xs">
            <span className="font-medium">Max Flüge pro Pilot</span>
            <span className="text-xs text-muted-foreground">
              Optional. Leer = kein Cap. Verhindert Überlastung einzelner Piloten.
            </span>
            <input
              type="number"
              min="1"
              value={props.maxFlightsPerPilot}
              onChange={(e) => props.setMaxFlightsPerPilot(e.target.value)}
              placeholder="z.B. 5"
              className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <label className="flex items-center gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={props.sendPushNotifications}
              onChange={(e) => props.setSendPushNotifications(e.target.checked)}
              className="accent-indigo-600"
            />
            <div>
              <div className="font-medium">📱 Push-Notifications senden</div>
              <div className="text-xs text-muted-foreground">
                Pro betroffener Pilot eine summary-notification beim Commit.
              </div>
            </div>
          </label>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/airline/roster"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Zurück zur Übersicht
        </Link>
        <button
          type="button"
          disabled={props.isPending}
          onClick={props.onRun}
          className="px-5 py-2.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {props.isPending ? 'Berechne…' : '🤖 Vorschau generieren'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PreviewView
// ─────────────────────────────────────────────────────────────────────

type PreviewViewProps = {
  preview: AutoRosterPreview;
  stats: {
    totalFlights: number;
    assigned: number;
    unassignable: number;
    included: number;
  };
  includeMap: Map<string, boolean>;
  onToggleInclude: (id: string) => void;
  onCommit: () => void;
  onBack: () => void;
  isPending: boolean;
};

function PreviewView(props: PreviewViewProps) {
  const { preview, stats } = props;
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDt = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Stats-header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Flüge gesamt" value={stats.totalFlights} tone="default" />
        <StatCard label="Zugewiesen" value={stats.assigned} tone="success" />
        <StatCard label="Unassignable" value={stats.unassignable} tone="amber" />
        <StatCard label="Inkludiert" value={stats.included} tone="indigo" />
      </div>

      {/* Per-pilot aggregate */}
      {preview.perPilotCounts.length > 0 && (
        <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h3 className="text-sm font-semibold mb-3">Verteilung pro Pilot</h3>
          <ul className="flex flex-wrap gap-2">
            {preview.perPilotCounts.map((p) => (
              <li
                key={p.pilotId}
                className="px-3 py-1.5 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-xs"
              >
                <span className="font-medium">{p.pilotName ?? '—'}</span>
                <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-200 dark:bg-indigo-800/50">
                  {p.assignmentCount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Proposals-table */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-left">
            <tr>
              <th className="px-3 py-2 font-medium w-10">✓</th>
              <th className="px-3 py-2 font-medium">Datum</th>
              <th className="px-3 py-2 font-medium">Flug</th>
              <th className="px-3 py-2 font-medium">Route</th>
              <th className="px-3 py-2 font-medium">Pilot</th>
              <th className="px-3 py-2 font-medium">Kandidaten</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {preview.proposals.map((p) => {
              const isAssigned = p.pickedPilotId !== null;
              const isIncluded = props.includeMap.get(p.scheduledFlightId) ?? false;
              return (
                <tr
                  key={p.scheduledFlightId}
                  className={
                    !isAssigned
                      ? 'bg-amber-50/30 dark:bg-amber-900/10'
                      : ''
                  }
                >
                  <td className="px-3 py-2">
                    {isAssigned ? (
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={() => props.onToggleInclude(p.scheduledFlightId)}
                        className="accent-indigo-600"
                      />
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400" title="Unassignable">
                        ⚠️
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{formatDt(p.departureTime)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                    {p.flightNumber}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {p.depIcao} → {p.arrIcao}
                    {p.aircraftTypeIcao && (
                      <span className="ml-2 text-gray-500">({p.aircraftTypeIcao})</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isAssigned ? (
                      <span className="font-medium">{p.pickedPilotName ?? '—'}</span>
                    ) : (
                      <span className="text-xs italic text-amber-700 dark:text-amber-400">
                        {p.unassignableReason ?? 'Kein Pilot'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {p.candidates.length}{' '}
                    {p.candidates.length > 0 && (
                      <span title={p.candidates.map((c) => `${c.pilotName ?? '?'}: ${c.fairnessScore.toFixed(1)}`).join('\n')}>
                        🛈
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {preview.proposals.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground italic">
                  Keine Planned-Flüge im gewählten Zeitraum gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={props.onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Filter ändern
        </button>
        <button
          type="button"
          disabled={props.isPending || stats.included === 0}
          onClick={props.onCommit}
          className="px-5 py-2.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {props.isPending ? 'Erstelle…' : `✅ ${stats.included} Zuweisungen übernehmen`}
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'default' | 'success' | 'amber' | 'indigo';
}) {
  const colorClass =
    tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'indigo'
          ? 'text-indigo-700 dark:text-indigo-400'
          : 'text-foreground';
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CommittedView
// ─────────────────────────────────────────────────────────────────────

function CommittedView({
  result,
  onAgain,
}: {
  result: CommitAutoRosterResult;
  onAgain: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 p-6 text-center">
        <div className="text-5xl mb-2" aria-hidden="true">🎉</div>
        <h2 className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mb-1">
          {result.totalCreated} Roster-Assignments erstellt
        </h2>
        <p className="text-sm text-muted-foreground">
          {result.pilotsNotified > 0 && `📱 ${result.pilotsNotified} Piloten benachrichtigt. `}
          {result.totalSkipped > 0 && `⚠️ ${result.totalSkipped} übersprungen.`}
        </p>
      </div>

      {result.perPilotBreakdown.length > 0 && (
        <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h3 className="text-sm font-semibold mb-3">Pro Pilot</h3>
          <ul className="text-xs space-y-1.5">
            {result.perPilotBreakdown.map((b) => (
              <li key={b.pilotId} className="flex items-center justify-between">
                <span className="font-mono text-muted-foreground">{b.pilotId.slice(-8)}</span>
                <span className="flex items-center gap-3">
                  <span className="text-emerald-700 dark:text-emerald-400">
                    +{b.created}
                  </span>
                  {b.skipped > 0 && (
                    <span className="text-amber-700 dark:text-amber-400">
                      −{b.skipped} skipped
                    </span>
                  )}
                  {b.pushSent && <span title="Push gesendet">📱</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/airline/roster"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Zur Roster-Übersicht
        </Link>
        <button
          type="button"
          onClick={onAgain}
          className="px-5 py-2.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
        >
          🔁 Nochmal generieren
        </button>
      </div>
    </div>
  );
}
