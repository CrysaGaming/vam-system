'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignRoleToMember, type AirlineMember } from './actions';

interface Props {
  members: AirlineMember[];
  roles: Array<{ id: string; name: string; description: string | null }>;
  currentUserId: string;
  /**
   * Ist der aktuell eingeloggte user ein system-admin? Wird verwendet
   * um zu entscheiden ob die "admin"-rolle im dropdown auswählbar ist.
   * Backend (assignRoleToMember in actions.ts) blockiert die zuweisung
   * für non-admins eh, aber wir wollen die option erst gar nicht
   * klickbar anbieten — sonst kriegt der user einen error-toast statt
   * direktes feedback.
   */
  currentUserIsAdmin: boolean;
}

/**
 * Member table with inline role-assignment dropdowns. Optimistic UI:
 * the dropdown changes immediately on selection, then the server action
 * fires; if it fails, the error message shows + the page refresh
 * snaps the state back to actual.
 *
 * Self-demotion: the current user appears in their own list with a
 * "(Du)" suffix. The dropdown still works on themselves — the last-
 * admin guard on the server prevents the dangerous case where this
 * would lock them out.
 *
 * Privilege-escalation guard (UI-side): die "admin"-rolle ist im
 * dropdown nur für system-admins auswählbar. Für airline-admin oder
 * instructor erscheint sie als disabled mit hint-text. Das ist
 * defense-in-depth — der echte schutz steht im backend, aber UI
 * sollte unmögliche aktionen erst gar nicht anbieten.
 */
export function MemberTable({ members, roles, currentUserId, currentUserIsAdmin }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleRoleChange(userId: string, newRoleId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await assignRoleToMember({
          userId,
          // Empty string from the "Keine Rolle" <option> represents null
          roleId: newRoleId === '' ? null : newRoleId,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Mitglieder</h2>
        <span className="text-xs text-gray-500">
          {members.length} {members.length === 1 ? 'Pilot' : 'Piloten'}
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded border bg-red-500/10 border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 text-xs uppercase tracking-wider text-gray-500">
              <th className="text-left py-3 pr-4">Pilot</th>
              <th className="text-left py-3 px-4">Rang</th>
              <th className="text-left py-3 px-4">Stunden</th>
              <th className="text-left py-3 px-4">Flüge</th>
              <th className="text-left py-3 pl-4">Rolle</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isMe = m.id === currentUserId;
              return (
                <tr
                  key={m.id}
                  className="border-b border-gray-200 dark:border-gray-800/60 last:border-b-0"
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      {m.image && (
                        <img
                          src={m.image}
                          alt=""
                          className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700"
                        />
                      )}
                      <div>
                        <p className="font-semibold">
                          {m.name ?? 'Unbenannt'}
                          {isMe && (
                            <span className="ml-2 text-xs text-indigo-400">
                              (Du)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-500 dark:text-gray-400">
                    {m.rankName ?? '—'}
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    {m.totalFlightHours.toFixed(1)}h
                  </td>
                  <td className="py-3 px-4 tabular-nums">{m.totalFlights}</td>
                  <td className="py-3 pl-4">
                    <select
                      defaultValue={
                        m.roleName
                          ? roles.find((r) => r.name === m.roleName)?.id ?? ''
                          : ''
                      }
                      onChange={(e) => handleRoleChange(m.id, e.target.value)}
                      disabled={pending}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-50"
                    >
                      <option value="">Keine Rolle</option>
                      {roles.map((r) => {
                        // admin-rolle ist nur für system-admins zuweisbar.
                        // Backend wirft eh wenn ein non-admin sie zu setzen
                        // versucht (siehe assignRoleToMember privilege-
                        // escalation guard), aber UI-side disabled bevor
                        // der user den fehler erlebt.
                        const isPrivilegedRole = r.name === 'admin';
                        const isLocked = isPrivilegedRole && !currentUserIsAdmin;
                        return (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={isLocked}
                          >
                            {r.name}
                            {isLocked
                              ? ' (nur System-Admins)'
                              : r.description
                                ? ` — ${r.description}`
                                : ''}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 text-center text-sm text-gray-500 italic"
                >
                  Keine Mitglieder. Mit Invite-Flow (#22) kannst du Piloten
                  einladen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
