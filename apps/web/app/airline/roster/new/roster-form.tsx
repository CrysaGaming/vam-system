'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  createRosterAssignments,
  type CreateRosterAssignmentsResult,
} from '../actions';

/**
 * Track 5 #27 (Section F) — Roster-Creator Form (Client Component)
 *
 * Layout (top-to-bottom):
 *   1. Pilot picker — radio-list mit search-filter
 *   2. Flight multi-select — checkboxes gruppiert nach datum
 *   3. Aircraft override — optional dropdown (NULL = pilot wählt selbst /
 *      ScheduledFlight.preferredAircraft greift)
 *   4. Note textarea
 *   5. Options-row — push toggle + allowWarnings toggle
 *   6. Submit + result-panel
 *
 * # UX-philosophy
 *
 * KEIN live-eligibility-preview im MVP. Begründung:
 *   - Live-check würde server-round-trips bei jedem pilot/flight-change
 *     erfordern (oder massive client-side cache). Both kompliziert die
 *     komponente.
 *   - Submit-with-result-feedback ist genauso gute UX: admin sieht NACH
 *     submit eine klare aufschlüsselung "5 erstellt, 2 skipped weil X,
 *     1 skipped weil Y". Wenn issues da sind, kann admin nachschauen
 *     und allowWarnings flag setzen + nochmal submitten.
 *   - Single-source-of-truth: server-action ist der eligibility-judge,
 *     client zeigt was er sagt. Kein drift zwischen client-preview und
 *     server-decision.
 *
 * # State-management
 *
 * Pure React-state mit useState. Kein zustand-store, kein form-library —
 * das form ist self-contained und braucht keine cross-component-sync.
 * Submit-state via useTransition() um pending-UI zu zeigen ohne der
 * action selbst pending-checks aufzudrücken.
 */

type Pilot = {
  id: string;
  name: string | null;
  image: string | null;
  totalFlightHours: number;
  rankName: string | null;
};

type Flight = {
  id: string;
  departureTime: string; // ISO
  flightNumber: string;
  aircraftTypeIcao: string | null;
  estimatedMinutes: number;
  depIcao: string;
  arrIcao: string;
  existingAssignmentCount: number;
};

type Aircraft = {
  id: string;
  registration: string;
  type: string;
};

type Props = {
  pilots: Pilot[];
  flights: Flight[];
  aircraft: Aircraft[];
};

export function RosterCreatorForm({ pilots, flights, aircraft }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedPilotId, setSelectedPilotId] = useState<string | null>(null);
  const [selectedFlightIds, setSelectedFlightIds] = useState<Set<string>>(new Set());
  const [pilotSearch, setPilotSearch] = useState('');
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sendPush, setSendPush] = useState(true);
  const [allowWarnings, setAllowWarnings] = useState(false);
  const [result, setResult] = useState<CreateRosterAssignmentsResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ─── Derived: pilot-filter + flight-grouping ───

  const filteredPilots = useMemo(() => {
    if (!pilotSearch.trim()) return pilots;
    const needle = pilotSearch.toLowerCase().trim();
    return pilots.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(needle) ||
        (p.rankName ?? '').toLowerCase().includes(needle),
    );
  }, [pilots, pilotSearch]);

  // Group flights by date (UTC) für übersichtliche selection. Map preserved
  // insertion-order, was bei sortierter input-list = chronologisch.
  const flightsByDate = useMemo(() => {
    const groups = new Map<string, Flight[]>();
    for (const f of flights) {
      const d = new Date(f.departureTime);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const arr = groups.get(key) ?? [];
      arr.push(f);
      groups.set(key, arr);
    }
    return groups;
  }, [flights]);

  // ─── Handlers ───

  function toggleFlight(id: string) {
    setSelectedFlightIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllInDate(dateKey: string) {
    const flightsForDate = flightsByDate.get(dateKey) ?? [];
    setSelectedFlightIds((prev) => {
      const next = new Set(prev);
      const allSelected = flightsForDate.every((f) => next.has(f.id));
      if (allSelected) {
        // toggle off
        for (const f of flightsForDate) next.delete(f.id);
      } else {
        for (const f of flightsForDate) next.add(f.id);
      }
      return next;
    });
  }

  function submit() {
    setResult(null);
    setSubmitError(null);
    if (!selectedPilotId) {
      setSubmitError('Bitte wähle einen Piloten.');
      return;
    }
    if (selectedFlightIds.size === 0) {
      setSubmitError('Bitte wähle mindestens einen Flug.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await createRosterAssignments({
          pilotId: selectedPilotId,
          scheduledFlightIds: Array.from(selectedFlightIds),
          assignedAircraftId: selectedAircraftId,
          note: note.trim() || null,
          allowWarnings,
          sendPushNotification: sendPush,
        });
        setResult(res);
        // Wenn ALLES erstellt wurde, deselect-en wir die flights damit
        // admin nicht versehentlich doppelt-submitted. Wenn skipped
        // existieren, lassen wir sie ausgewählt — admin kann nach
        // allowWarnings-toggle nochmal submitten.
        if (res.skipped.length === 0) {
          setSelectedFlightIds(new Set());
        } else {
          // Successful entfernen, skipped behalten
          const skippedIds = new Set(res.skipped.map((s) => s.scheduledFlightId));
          setSelectedFlightIds((prev) => {
            const next = new Set<string>();
            for (const id of prev) if (skippedIds.has(id)) next.add(id);
            return next;
          });
        }
        router.refresh(); // revalidatePath triggered RSC re-render
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Unbekannter Fehler beim Erstellen.',
        );
      }
    });
  }

  // ─── Render ───

  return (
    <div className="flex flex-col gap-6">
      {/* ─── 1. Pilot picker ─── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          1. Pilot wählen
        </h2>
        <input
          type="search"
          value={pilotSearch}
          onChange={(e) => setPilotSearch(e.target.value)}
          placeholder="Suche nach Name oder Rang…"
          className="w-full mb-3 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="max-h-64 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded">
          {filteredPilots.length === 0 ? (
            <p className="text-sm text-muted-foreground italic p-3">
              Keine Piloten gefunden.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredPilots.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <input
                      type="radio"
                      name="pilot"
                      value={p.id}
                      checked={selectedPilotId === p.id}
                      onChange={() => setSelectedPilotId(p.id)}
                      className="accent-indigo-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {p.name ?? '—'}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.rankName ?? 'Kein Rang'} · {p.totalFlightHours.toFixed(1)}h
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ─── 2. Flight multi-select ─── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            2. Flüge wählen
          </h2>
          <span className="text-xs text-muted-foreground">
            {selectedFlightIds.size} ausgewählt
          </span>
        </div>
        <div className="max-h-96 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded">
          {Array.from(flightsByDate.entries()).map(([dateKey, dateFlights]) => {
            const dt = new Date(`${dateKey}T00:00:00Z`);
            const weekday = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][dt.getUTCDay()];
            const dateLabel = `${weekday}, ${dateKey}`;
            const allSelected = dateFlights.every((f) => selectedFlightIds.has(f.id));
            return (
              <div key={dateKey} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/50 sticky top-0">
                  <span className="text-xs font-mono font-medium text-gray-700 dark:text-gray-300">
                    {dateLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectAllInDate(dateKey)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {allSelected ? 'Tag abwählen' : 'Tag wählen'}
                  </button>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {dateFlights.map((f) => {
                    const dep = new Date(f.departureTime);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    const timeStr = `${pad(dep.getUTCHours())}:${pad(dep.getUTCMinutes())}Z`;
                    return (
                      <li key={f.id}>
                        <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <input
                            type="checkbox"
                            checked={selectedFlightIds.has(f.id)}
                            onChange={() => toggleFlight(f.id)}
                            className="accent-indigo-600"
                          />
                          <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap text-sm">
                            <span className="font-mono font-medium">{timeStr}</span>
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">
                              {f.flightNumber}
                            </span>
                            <span className="text-muted-foreground font-mono text-xs">
                              {f.depIcao} → {f.arrIcao}
                            </span>
                            {f.aircraftTypeIcao && (
                              <span className="text-xs text-gray-500 font-mono">
                                {f.aircraftTypeIcao}
                              </span>
                            )}
                            {f.existingAssignmentCount > 0 && (
                              <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                                {f.existingAssignmentCount} bereits zugewiesen
                              </span>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── 3. Aircraft override (optional) ─── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
          3. Aircraft (optional)
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Wenn leer, greift ScheduledFlight.preferredAircraft oder der
          Pilot wählt selbst beim Antritt.
        </p>
        <select
          value={selectedAircraftId ?? ''}
          onChange={(e) => setSelectedAircraftId(e.target.value || null)}
          className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— Keine Vorgabe —</option>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} ({a.type})
            </option>
          ))}
        </select>
      </section>

      {/* ─── 4. Note ─── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
          4. Notiz (optional)
        </h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="z.B. Training-Flug, Bemerkung zur Strecke, oder anderer Kontext für den Piloten…"
          className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {note.length}/500 Zeichen
        </p>
      </section>

      {/* ─── 5. Options ─── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-1">
          5. Optionen
        </h2>
        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={sendPush}
            onChange={(e) => setSendPush(e.target.checked)}
            className="accent-indigo-600"
          />
          <div>
            <div className="font-medium">📱 Push-Notification senden</div>
            <div className="text-xs text-muted-foreground">
              Pilot bekommt sofort eine Benachrichtigung über die Zuweisung (sofern push aktiviert).
            </div>
          </div>
        </label>
        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={allowWarnings}
            onChange={(e) => setAllowWarnings(e.target.checked)}
            className="accent-amber-600"
          />
          <div>
            <div className="font-medium">⚠️ Warnungen ignorieren</div>
            <div className="text-xs text-muted-foreground">
              Erstelle Assignments auch bei fehlenden Type-Ratings, Lizenzen oder Zeitkonflikten.
            </div>
          </div>
        </label>
      </section>

      {/* ─── Submit + result ─── */}
      <section className="flex flex-col gap-4">
        {submitError && (
          <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
            {submitError}
          </div>
        )}

        {result && <ResultPanel result={result} flights={flights} />}

        <div className="flex items-center justify-between gap-3">
          <Link
            href="/airline/roster"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Zurück zur Übersicht
          </Link>
          <button
            type="button"
            disabled={isPending || !selectedPilotId || selectedFlightIds.size === 0}
            onClick={submit}
            className="px-5 py-2.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isPending
              ? 'Erstelle…'
              : `${selectedFlightIds.size} Zuweisung${selectedFlightIds.size === 1 ? '' : 'en'} erstellen`}
          </button>
        </div>
      </section>
    </div>
  );
}

function ResultPanel({
  result,
  flights,
}: {
  result: CreateRosterAssignmentsResult;
  flights: Flight[];
}) {
  // Look up flight metadata für display (we got just IDs back from server).
  const flightById = useMemo(() => {
    const map = new Map<string, Flight>();
    for (const f of flights) map.set(f.id, f);
    return map;
  }, [flights]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Ergebnis</h3>
        {result.pushNotificationSent && (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
            📱 Push gesendet
          </span>
        )}
      </div>

      {result.created.length > 0 && (
        <div>
          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1.5">
            ✅ {result.created.length} erstellt
          </div>
          <ul className="text-xs space-y-1 ml-4 list-disc">
            {result.created.map((c) => {
              const f = flightById.get(c.scheduledFlightId);
              return (
                <li key={c.assignmentId} className="text-muted-foreground">
                  {f
                    ? `${f.flightNumber} · ${f.depIcao}→${f.arrIcao} · ${f.departureTime.slice(0, 16).replace('T', ' ')}Z`
                    : c.scheduledFlightId}
                  {c.warnings.length > 0 && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">
                      (mit {c.warnings.length} Warnung{c.warnings.length === 1 ? '' : 'en'})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {result.skipped.length > 0 && (
        <div>
          <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5">
            ⚠️ {result.skipped.length} übersprungen
          </div>
          <ul className="text-xs space-y-2 ml-4">
            {result.skipped.map((s) => {
              const f = flightById.get(s.scheduledFlightId);
              return (
                <li key={s.scheduledFlightId} className="list-disc">
                  <div className="text-muted-foreground">
                    {f
                      ? `${f.flightNumber} · ${f.depIcao}→${f.arrIcao} · ${f.departureTime.slice(0, 16).replace('T', ' ')}Z`
                      : s.scheduledFlightId}{' '}
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      ({s.reason === 'errors' ? 'Fehler' : s.reason === 'warnings-blocked' ? 'Warnungen' : s.reason === 'duplicate' ? 'Doppelt' : 'Unbekannt'})
                    </span>
                  </div>
                  {s.issues.length > 0 && (
                    <ul className="ml-4 mt-1 text-xs text-amber-600 dark:text-amber-400 list-square">
                      {s.issues.map((iss, i) => (
                        <li key={i}>{iss.message}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {result.skipped.some((s) => s.reason === 'warnings-blocked') && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 italic">
              Tipp: Aktiviere „Warnungen ignorieren" oben und submit nochmal um die übersprungenen anzulegen.
            </p>
          )}
        </div>
      )}

      {result.created.length === 0 && result.skipped.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Keine Aktionen ausgeführt.
        </p>
      )}
    </div>
  );
}
