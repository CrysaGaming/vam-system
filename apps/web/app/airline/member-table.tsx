'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignRoleToMember,
  assignRankToMember,
  removeMemberFromAirline,
  bulkAssignRoleToMembers,
  bulkRemoveMembersFromAirline,
  type AirlineMember,
} from './actions';

interface Props {
  members: AirlineMember[];
  roles: Array<{ id: string; name: string; description: string | null }>;
  ranks: Array<{ id: string; name: string; minFlightHours: number; order: number }>;
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

type SortKey = 'name' | 'rank' | 'hours' | 'flights' | 'joined';
type SortDir = 'asc' | 'desc';

/**
 * Member-table mit voll-feature-set. Phase 5 (2026-05-02) ergänzungen:
 *
 * Per-row actions:
 *   - Rolle ändern (dropdown) — admin-rolle gegated für non-system-admins
 *   - Rang ändern (dropdown) — manuelle override der auto-promotion
 *   - Aus airline entfernen (button mit confirm)
 *
 * Tabellen-features:
 *   - Suchfeld (clientside filter auf name + email)
 *   - Sortier-buttons in headern (Pilot, Rang, Stunden, Flüge, Beigetreten)
 *   - Bulk-checkboxes pro row + "alle auswählen" im header
 *   - Bulk-action-bar oben wenn mind. 1 row ausgewählt
 *
 * State-management:
 *   - Optimistic UI: dropdowns ändern sofort, server fires async; bei
 *     fehler wird die page refreshed und der state snappt zurück
 *   - Suche/sort sind reine clientside-states, nichts persistiert
 *   - Selection wird gecleart wenn page refreshed (router.refresh())
 *
 * Beigetreten-spalte: bevorzugt joinedAirlineAt, fallback auf createdAt.
 * Legacy-users (vor migration 20260502161030) haben null joinedAirlineAt;
 * für die zeigen wir createdAt mit einem subtle "~"-prefix als hinweis
 * dass es eine schätzung ist.
 */
export function MemberTable({
  members,
  roles,
  ranks,
  currentUserId,
  currentUserIsAdmin,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const router = useRouter();

  // Selection für bulk-actions. Set<string> für O(1) lookup pro row.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Search query — clientside filter über name + email. Lowercase einmal
  // beim filtern, nicht pro vergleich.
  const [searchQuery, setSearchQuery] = useState('');

  // Sort-state. Default ist 'hours desc' was der server bereits liefert
  // (siehe listAirlineMembers orderBy). Beim toggle des selben keys flippt
  // die direction; bei wechsel zu anderem key fängt direction wieder bei
  // 'desc' an für numerische felder, 'asc' für strings.
  const [sortKey, setSortKey] = useState<SortKey>('hours');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Bulk-role-dropdown-value (was der user oben in der bulk-bar gewählt
  // hat bevor er auf "Anwenden" klickt). Empty string = "Keine Rolle"
  // pseudo-option, exakt analog zu per-row dropdown.
  const [bulkRoleId, setBulkRoleId] = useState<string>('');

  // Filtered + sorted view der members. useMemo damit es nicht bei jedem
  // re-render durchlaufen muss.
  const visibleMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let arr = members;
    if (q) {
      arr = arr.filter((m) => {
        const name = (m.name ?? '').toLowerCase();
        const email = m.email.toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }
    // Stable copy vor sort, damit wir das original nicht mutieren
    arr = [...arr].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name ?? '').localeCompare(b.name ?? '');
          break;
        case 'rank':
          // Rank-name als sort-key. Nicht ideal weil ranks eine logische
          // hierarchie haben (Trainee < FO < Capt), aber AirlineMember-typ
          // hat nur den name nicht den order-field. Falls echte order-
          // sortierung wichtig wird, listAirlineMembers muss rank.order
          // includen.
          cmp = (a.rankName ?? '').localeCompare(b.rankName ?? '');
          break;
        case 'hours':
          cmp = a.totalFlightHours - b.totalFlightHours;
          break;
        case 'flights':
          cmp = a.totalFlights - b.totalFlights;
          break;
        case 'joined': {
          // joinedAirlineAt mit fallback auf createdAt für legacy-users
          const aDate = (a.joinedAirlineAt ?? a.createdAt).getTime();
          const bDate = (b.joinedAirlineAt ?? b.createdAt).getTime();
          cmp = aDate - bDate;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [members, searchQuery, sortKey, sortDir]);

  // Selection gegen visibleMembers gecheckt — wenn der user filtert und
  // dann "alle auswählen" klickt, soll das nur die sichtbaren rows
  // selecten, nicht versteckte ausgefilterte rows hinzufügen.
  const allVisibleSelected =
    visibleMembers.length > 0 &&
    visibleMembers.every((m) => selectedIds.has(m.id));
  const someVisibleSelected = visibleMembers.some((m) => selectedIds.has(m.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        // Deselect nur die visible — versteckt-selected bleiben drin
        // (consistent mit dem checkbox-state)
        for (const m of visibleMembers) next.delete(m.id);
      } else {
        for (const m of visibleMembers) next.add(m.id);
      }
      return next;
    });
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Strings asc, numbers desc — natural defaults
      setSortDir(key === 'name' || key === 'rank' ? 'asc' : 'desc');
    }
  }

  function handleRoleChange(userId: string, newRoleId: string) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        await assignRoleToMember({
          userId,
          roleId: newRoleId === '' ? null : newRoleId,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleRankChange(userId: string, newRankId: string) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        await assignRankToMember({
          userId,
          rankId: newRankId === '' ? null : newRankId,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleRemoveOne(userId: string, name: string | null) {
    setError(null);
    setInfo(null);
    if (
      !confirm(
        `${name ?? 'Diesen Pilot'} wirklich aus der Airline entfernen?\n\n` +
          `Der User-Account bleibt bestehen, nur die Airline-Mitgliedschaft wird aufgelöst.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await removeMemberFromAirline({ userId });
        // Aus selection nehmen falls vorher selected
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleBulkAssignRole() {
    setError(null);
    setInfo(null);
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const roleLabel =
      bulkRoleId === ''
        ? 'Keine Rolle'
        : roles.find((r) => r.id === bulkRoleId)?.name ?? 'Rolle';
    if (
      !confirm(
        `Rolle "${roleLabel}" an ${ids.length} ausgewählte Pilot${ids.length === 1 ? '' : 'en'} zuweisen?`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await bulkAssignRoleToMembers({
          userIds: ids,
          roleId: bulkRoleId === '' ? null : bulkRoleId,
        });
        if (res.failed.length > 0) {
          setError(
            `${res.succeeded} erfolgreich, ${res.failed.length} fehlgeschlagen: ` +
              res.failed.map((f) => f.error).join('; '),
          );
        } else {
          setInfo(
            `${res.succeeded} Rolle${res.succeeded === 1 ? '' : 'n'} zugewiesen.`,
          );
        }
        setSelectedIds(new Set());
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleBulkRemove() {
    setError(null);
    setInfo(null);
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (
      !confirm(
        `${ids.length} ausgewählte Pilot${ids.length === 1 ? '' : 'en'} aus der Airline entfernen?\n\n` +
          `Die User-Accounts bleiben bestehen, nur die Airline-Mitgliedschaften werden aufgelöst.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await bulkRemoveMembersFromAirline({ userIds: ids });
        if (res.failed.length > 0) {
          setError(
            `${res.succeeded} erfolgreich, ${res.failed.length} fehlgeschlagen: ` +
              res.failed.map((f) => f.error).join('; '),
          );
        } else {
          setInfo(
            `${res.succeeded} Pilot${res.succeeded === 1 ? '' : 'en'} entfernt.`,
          );
        }
        setSelectedIds(new Set());
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  // Helper für sort-icons im header
  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <span className="opacity-30">↕</span>;
    return (
      <span className="text-indigo-500 dark:text-indigo-400">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Mitglieder</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="search"
            placeholder="Suche (Name, Email)…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none w-64"
          />
          <span className="text-xs text-gray-500">
            {visibleMembers.length === members.length
              ? `${members.length} ${members.length === 1 ? 'Pilot' : 'Piloten'}`
              : `${visibleMembers.length} von ${members.length}`}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-4 px-4 py-3 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-sm">
          {info}
        </div>
      )}

      {/* Bulk-action-bar — sichtbar wenn mind. 1 row selected. Sticky-feel
          nicht nötig weil die tabelle nicht extrem lang ist; wenn die
          tabelle mal 100+ rows hat, könnte man `position: sticky; top:0`
          dazugeben. */}
      {selectedIds.size > 0 && (
        <div className="mb-4 px-4 py-3 rounded border bg-indigo-500/10 border-indigo-500/30 flex items-center gap-3 flex-wrap text-sm">
          <span className="font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} ausgewählt
          </span>
          <span className="text-gray-400">·</span>
          <label className="flex items-center gap-2">
            <span className="text-gray-600 dark:text-gray-400">Rolle:</span>
            <select
              value={bulkRoleId}
              onChange={(e) => setBulkRoleId(e.target.value)}
              disabled={pending}
              className="px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-50"
            >
              <option value="">Keine Rolle</option>
              {roles.map((r) => {
                const isPrivilegedRole = r.name === 'admin';
                const isLocked = isPrivilegedRole && !currentUserIsAdmin;
                return (
                  <option key={r.id} value={r.id} disabled={isLocked}>
                    {r.name}
                    {isLocked ? ' (nur System-Admins)' : ''}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={handleBulkAssignRole}
              disabled={pending}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition disabled:opacity-50"
            >
              Zuweisen
            </button>
          </label>
          <span className="text-gray-400">·</span>
          <button
            type="button"
            onClick={handleBulkRemove}
            disabled={pending}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition disabled:opacity-50"
          >
            Entfernen
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            disabled={pending}
            className="px-3 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded text-sm transition disabled:opacity-50 ml-auto"
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 text-xs uppercase tracking-wider text-gray-500">
              <th className="text-left py-3 pr-2 w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                  }}
                  onChange={toggleSelectAll}
                  disabled={pending || visibleMembers.length === 0}
                  className="cursor-pointer"
                  aria-label="Alle auswählen"
                />
              </th>
              <th className="text-left py-3 pr-4">
                <button
                  type="button"
                  onClick={() => handleSort('name')}
                  className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                >
                  Pilot {sortIcon('name')}
                </button>
              </th>
              <th className="text-left py-3 px-4">
                <button
                  type="button"
                  onClick={() => handleSort('rank')}
                  className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                >
                  Rang {sortIcon('rank')}
                </button>
              </th>
              <th className="text-left py-3 px-4">
                <button
                  type="button"
                  onClick={() => handleSort('hours')}
                  className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                >
                  Stunden {sortIcon('hours')}
                </button>
              </th>
              <th className="text-left py-3 px-4">
                <button
                  type="button"
                  onClick={() => handleSort('flights')}
                  className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                >
                  Flüge {sortIcon('flights')}
                </button>
              </th>
              <th className="text-left py-3 px-4">
                <button
                  type="button"
                  onClick={() => handleSort('joined')}
                  className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                >
                  Beigetreten {sortIcon('joined')}
                </button>
              </th>
              <th className="text-left py-3 px-4">Rolle</th>
              <th className="text-right py-3 pl-4 w-20">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {visibleMembers.map((m) => {
              const isMe = m.id === currentUserId;
              const isSelected = selectedIds.has(m.id);
              const joinedDate = m.joinedAirlineAt ?? m.createdAt;
              const isLegacyJoinDate = m.joinedAirlineAt === null;
              return (
                <tr
                  key={m.id}
                  className={`border-b border-gray-200 dark:border-gray-800/60 last:border-b-0 transition ${
                    isSelected ? 'bg-indigo-500/5' : ''
                  }`}
                >
                  <td className="py-3 pr-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectOne(m.id)}
                      disabled={pending}
                      className="cursor-pointer"
                      aria-label={`${m.name ?? m.email} auswählen`}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      {m.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.image}
                          alt=""
                          className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700"
                        />
                      )}
                      <div>
                        <Link
                          href={`/pilots/${m.id}`}
                          className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline transition"
                        >
                          {m.name ?? 'Unbenannt'}
                        </Link>
                        {isMe && (
                          <span className="ml-2 text-xs text-indigo-500 dark:text-indigo-400">
                            (Du)
                          </span>
                        )}
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      defaultValue={m.rankId ?? ''}
                      onChange={(e) => handleRankChange(m.id, e.target.value)}
                      disabled={pending}
                      className="px-2 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs focus:border-indigo-500 outline-none disabled:opacity-50"
                    >
                      <option value="">— kein Rang —</option>
                      {ranks.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.minFlightHours}h+)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    {m.totalFlightHours.toFixed(1)}h
                  </td>
                  <td className="py-3 px-4 tabular-nums">{m.totalFlights}</td>
                  <td
                    className="py-3 px-4 text-xs text-gray-600 dark:text-gray-400 tabular-nums"
                    title={
                      isLegacyJoinDate
                        ? `Geschätzt aus Account-Erstellung (${joinedDate.toISOString()})`
                        : joinedDate.toISOString()
                    }
                  >
                    {isLegacyJoinDate && (
                      <span
                        className="text-gray-400 dark:text-gray-600"
                        aria-label="geschätzt"
                      >
                        ~
                      </span>
                    )}
                    {joinedDate.toLocaleDateString('de-DE', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </td>
                  <td className="py-3 px-4">
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
                        // Description bewusst NICHT in den option-text — sie
                        // bläht die spalte auf ~280px auf weil die select-
                        // breite vom längsten option bestimmt wird (z.B.
                        // 'airline-admin — Verwaltet die zugewiesene Airline'
                        // ~280px). Das war bis 2026-05-02 der haupttreiber
                        // für horizontal-scroll der Mitglieder-tabelle. Jetzt
                        // landet die description als title-attribut → tooltip
                        // beim hover, und die spalte ist ~150px statt 280px.
                        return (
                          <option
                            key={r.id}
                            value={r.id}
                            disabled={isLocked}
                            title={r.description ?? undefined}
                          >
                            {r.name}
                            {isLocked ? ' (nur System-Admins)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemoveOne(m.id, m.name)}
                      disabled={pending}
                      title="Aus Airline entfernen"
                      className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded transition disabled:opacity-50"
                    >
                      Entfernen
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleMembers.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="py-8 text-center text-sm text-gray-500 italic"
                >
                  {searchQuery
                    ? `Keine Treffer für "${searchQuery}".`
                    : 'Keine Mitglieder. Mit Invite-Flow (#22) kannst du Piloten einladen.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
