'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Prisma } from '@vam/db';
import {
  approveAirportRequest,
  rejectAirportRequest,
} from '@/app/airports/actions';
import {
  approveAircraftTypeRequest,
  rejectAircraftTypeRequest,
} from '@/app/aircraft-types/actions';

// ───── Types ─────

type AirportRequestRow = Prisma.AirportRequestGetPayload<{
  include: {
    requestedBy: { select: { id: true; name: true; email: true } };
    requestedAirline: { select: { id: true; icao: true; name: true } };
  };
}>;

type AircraftTypeRequestRow = Prisma.AircraftTypeRequestGetPayload<{
  include: {
    requestedBy: { select: { id: true; name: true; email: true } };
    requestedAirline: { select: { id: true; icao: true; name: true } };
  };
}>;

interface RequestsQueueProps {
  airportRequests: AirportRequestRow[];
  aircraftTypeRequests: AircraftTypeRequestRow[];
}

// ───── Helpers ─────

function relativeTime(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `vor ${hr} h`;
  const d = Math.floor(hr / 24);
  return `vor ${d} d`;
}

// ───── Main Component ─────

export function RequestsQueue({
  airportRequests,
  aircraftTypeRequests,
}: RequestsQueueProps) {
  const empty =
    airportRequests.length === 0 && aircraftTypeRequests.length === 0;

  if (empty) {
    return (
      <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="text-5xl mb-4">📭</div>
        <p className="text-lg font-semibold">Keine offenen Requests</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Wenn Airlines neue Airports oder Aircraft-Types vorschlagen, erscheinen
          sie hier zur Review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {airportRequests.length > 0 && (
        <AirportRequestsTable rows={airportRequests} />
      )}
      {aircraftTypeRequests.length > 0 && (
        <AircraftTypeRequestsTable rows={aircraftTypeRequests} />
      )}
    </div>
  );
}

// ───── Airport Table ─────

function AirportRequestsTable({ rows }: { rows: AirportRequestRow[] }) {
  return (
    <section>
      <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
        🛫 Airports
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
          ({rows.length})
        </span>
      </h2>
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-800/50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">ICAO/IATA</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Land</th>
              <th className="px-4 py-3 font-semibold">Eingereicht</th>
              <th className="px-4 py-3 font-semibold text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((r) => (
              <AirportRow key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AirportRow({ row }: { row: AirportRequestRow }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleApprove(asVerified: boolean) {
    if (
      !confirm(
        `Airport "${row.icao} – ${row.name}" als ${
          asVerified ? 'VERIFIED' : 'UNVERIFIED'
        } anlegen?`,
      )
    )
      return;

    startTransition(async () => {
      try {
        await approveAirportRequest({ requestId: row.id, asVerified });
        router.refresh();
      } catch (e) {
        alert(
          `Fehler beim Approve: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }

  function handleReject() {
    const reason = prompt(
      `Ablehnungsgrund für "${row.icao} – ${row.name}":`,
      '',
    );
    if (reason === null) return; // user cancelled
    if (!reason.trim()) {
      alert('Bitte einen Grund angeben.');
      return;
    }

    startTransition(async () => {
      try {
        await rejectAirportRequest(row.id, reason.trim());
        router.refresh();
      } catch (e) {
        alert(
          `Fehler beim Reject: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }

  return (
    <tr
      className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
        isPending ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      <td className="px-4 py-3 font-mono">
        <div className="font-semibold">{row.icao}</div>
        {row.iata && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {row.iata}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        {row.city && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {row.city}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
        {row.country}
        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          {row.latitude.toFixed(3)}, {row.longitude.toFixed(3)}
        </div>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
        <div className="text-xs">{relativeTime(row.submittedAt)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {row.requestedBy.name ?? row.requestedBy.email}
          {row.requestedAirline && (
            <span className="ml-1">({row.requestedAirline.icao})</span>
          )}
        </div>
        {row.reason && (
          <div className="text-xs italic mt-1 text-gray-500 dark:text-gray-400 max-w-xs truncate">
            «{row.reason}»
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1 justify-end">
          <button
            onClick={() => handleApprove(true)}
            disabled={isPending}
            className="px-2 py-1 text-xs font-semibold rounded bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
            title="Approve as verified — Daten geprüft, kein Warning-Badge"
          >
            ✓ Verified
          </button>
          <button
            onClick={() => handleApprove(false)}
            disabled={isPending}
            className="px-2 py-1 text-xs font-semibold rounded bg-yellow-600 hover:bg-yellow-700 text-white transition disabled:opacity-50"
            title="Approve as unverified — provisional, mit Warning-Badge"
          >
            ✓ Unverified
          </button>
          <button
            onClick={handleReject}
            disabled={isPending}
            className="px-2 py-1 text-xs font-semibold rounded bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-50"
          >
            ✗ Reject
          </button>
        </div>
      </td>
    </tr>
  );
}

// ───── AircraftType Table ─────

function AircraftTypeRequestsTable({
  rows,
}: {
  rows: AircraftTypeRequestRow[];
}) {
  return (
    <section>
      <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
        ✈️ Aircraft-Types
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
          ({rows.length})
        </span>
      </h2>
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-800/50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">ICAO</th>
              <th className="px-4 py-3 font-semibold">Modell</th>
              <th className="px-4 py-3 font-semibold">Specs</th>
              <th className="px-4 py-3 font-semibold">Eingereicht</th>
              <th className="px-4 py-3 font-semibold text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((r) => (
              <AircraftTypeRow key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AircraftTypeRow({ row }: { row: AircraftTypeRequestRow }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleApprove(asVerified: boolean) {
    if (
      !confirm(
        `Aircraft-Type "${row.icaoType} – ${row.name}" als ${
          asVerified ? 'VERIFIED' : 'UNVERIFIED'
        } anlegen?`,
      )
    )
      return;

    startTransition(async () => {
      try {
        await approveAircraftTypeRequest({ requestId: row.id, asVerified });
        router.refresh();
      } catch (e) {
        alert(
          `Fehler beim Approve: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }

  function handleReject() {
    const reason = prompt(
      `Ablehnungsgrund für "${row.icaoType} – ${row.name}":`,
      '',
    );
    if (reason === null) return;
    if (!reason.trim()) {
      alert('Bitte einen Grund angeben.');
      return;
    }

    startTransition(async () => {
      try {
        await rejectAircraftTypeRequest(row.id, reason.trim());
        router.refresh();
      } catch (e) {
        alert(
          `Fehler beim Reject: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }

  return (
    <tr
      className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
        isPending ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      <td className="px-4 py-3 font-mono font-semibold">{row.icaoType}</td>
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {row.manufacturer} · {row.category}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
        <div>Range: {row.rangeNm} nm</div>
        <div>Pax: {row.capacityPax}</div>
        <div>
          Cruise: {row.cruiseSpeedKt} kt · Burn: {row.fuelBurnKgH} kg/h
        </div>
      </td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
        <div className="text-xs">{relativeTime(row.submittedAt)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {row.requestedBy.name ?? row.requestedBy.email}
          {row.requestedAirline && (
            <span className="ml-1">({row.requestedAirline.icao})</span>
          )}
        </div>
        {row.reason && (
          <div className="text-xs italic mt-1 text-gray-500 dark:text-gray-400 max-w-xs truncate">
            «{row.reason}»
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1 justify-end">
          <button
            onClick={() => handleApprove(true)}
            disabled={isPending}
            className="px-2 py-1 text-xs font-semibold rounded bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
          >
            ✓ Verified
          </button>
          <button
            onClick={() => handleApprove(false)}
            disabled={isPending}
            className="px-2 py-1 text-xs font-semibold rounded bg-yellow-600 hover:bg-yellow-700 text-white transition disabled:opacity-50"
          >
            ✓ Unverified
          </button>
          <button
            onClick={handleReject}
            disabled={isPending}
            className="px-2 py-1 text-xs font-semibold rounded bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-50"
          >
            ✗ Reject
          </button>
        </div>
      </td>
    </tr>
  );
}
