'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSwapRequestAction } from '../actions';

/**
 * Track 5 #29 — Initiate-swap client form.
 *
 * Layout: meine assignment-card oben (read-only "Du gibst ab"),
 * darunter scrollbare liste der eligible targets gruppiert by pilot,
 * dann optional message-textarea, dann submit.
 */

type MyAssignment = {
  id: string;
  flightNumber: string;
  departureTime: string;
  depIcao: string;
  arrIcao: string;
  aircraftTypeIcao: string | null;
};

type Candidate = {
  id: string;
  pilotId: string;
  pilotName: string | null;
  rankName: string | null;
  flightNumber: string;
  departureTime: string;
  depIcao: string;
  arrIcao: string;
  aircraftTypeIcao: string | null;
};

type Props = {
  myAssignment: MyAssignment;
  candidates: Candidate[];
};

export function SwapNewForm({ myAssignment, candidates }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Filter candidates by free-text search (pilot name, flight, ICAOs)
  const filteredCandidates = useMemo(() => {
    if (!search.trim()) return candidates;
    const needle = search.toLowerCase().trim();
    return candidates.filter(
      (c) =>
        (c.pilotName ?? '').toLowerCase().includes(needle) ||
        c.flightNumber.toLowerCase().includes(needle) ||
        c.depIcao.toLowerCase().includes(needle) ||
        c.arrIcao.toLowerCase().includes(needle) ||
        (c.aircraftTypeIcao ?? '').toLowerCase().includes(needle),
    );
  }, [candidates, search]);

  // Group by pilot
  const byPilot = useMemo(() => {
    const groups = new Map<string, { pilotName: string | null; rankName: string | null; assignments: Candidate[] }>();
    for (const c of filteredCandidates) {
      const existing = groups.get(c.pilotId);
      if (existing) {
        existing.assignments.push(c);
      } else {
        groups.set(c.pilotId, {
          pilotName: c.pilotName,
          rankName: c.rankName,
          assignments: [c],
        });
      }
    }
    return groups;
  }, [filteredCandidates]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDt = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  };

  function submit() {
    if (!targetId) {
      setError('Bitte wähle eine Ziel-Assignment.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createSwapRequestAction({
        requesterAssignmentId: myAssignment.id,
        targetAssignmentId: targetId,
        message: message.trim() || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push('/roster/swaps?tab=outgoing');
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* My assignment (read-only) */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Du gibst ab
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono font-medium text-indigo-700 dark:text-indigo-400">
            {myAssignment.flightNumber}
          </span>
          <span className="font-mono text-muted-foreground">
            {myAssignment.depIcao} → {myAssignment.arrIcao}
          </span>
          <span className="font-mono text-muted-foreground">
            {formatDt(myAssignment.departureTime)}
          </span>
          {myAssignment.aircraftTypeIcao && (
            <span className="text-xs text-gray-500">
              ({myAssignment.aircraftTypeIcao})
            </span>
          )}
        </div>
      </section>

      {/* Candidates */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Was möchtest du dafür? ({candidates.length} verfügbar)
        </h2>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suche nach Pilot, Flugnummer, Flughafen…"
          className="w-full mb-3 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {filteredCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-6 text-center">
            {candidates.length === 0
              ? 'Keine passenden Assignments anderer Piloten gefunden.'
              : 'Kein Match für die Suche.'}
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded">
            {Array.from(byPilot.entries()).map(([pilotId, group]) => (
              <div key={pilotId} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-700 dark:text-gray-300 sticky top-0">
                  {group.pilotName ?? '—'}{' '}
                  {group.rankName && (
                    <span className="text-muted-foreground">· {group.rankName}</span>
                  )}
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {group.assignments.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <input
                          type="radio"
                          name="target"
                          value={c.id}
                          checked={targetId === c.id}
                          onChange={() => setTargetId(c.id)}
                          className="accent-indigo-600"
                        />
                        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-mono font-medium text-indigo-700 dark:text-indigo-400">
                            {c.flightNumber}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {c.depIcao} → {c.arrIcao}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatDt(c.departureTime)}
                          </span>
                          {c.aircraftTypeIcao && (
                            <span className="text-xs text-gray-500">
                              ({c.aircraftTypeIcao})
                            </span>
                          )}
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Optional message */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Notiz (optional)
        </h2>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Optional: Warum tauschen? z.B. Kann nicht, hab Termin, etc."
          className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-muted-foreground mt-1">{message.length}/500 Zeichen</p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Zurück
        </Link>
        <button
          type="button"
          disabled={isPending || !targetId}
          onClick={submit}
          className="px-5 py-2.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isPending ? 'Sende…' : '🔄 Swap anfragen'}
        </button>
      </div>
    </div>
  );
}
