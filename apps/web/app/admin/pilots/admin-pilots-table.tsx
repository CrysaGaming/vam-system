'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import {
  adminBulkAssignRole,
  adminBulkRemoveFromAirline,
} from './actions';

/**
 * Admin /admin/pilots client-component. Filter/sort/pagination clientside,
 * plus seit Phase 2 (2026-05-02) cross-airline bulk-actions:
 *   - Bulk-rolle-zuweisung an mehrere user
 *   - Bulk-remove-from-airline (setzt airlineId/rankId/roleId/joinedAirlineAt
 *     auf null, der user-account bleibt aber bestehen)
 *
 * Bewusst NICHT enthalten (separate design-doc nötig):
 *   - User-account löschen — FK-cascade-design auf PIREPs/Bookings braucht
 *     eigenes review (was passiert mit der history-anzeige?)
 *   - Force-airline-wechsel — manuell als 2-step machbar (remove + invite)
 *   - Impersonate — ist eigene security-feature mit audit-trail-impl
 *
 * Pattern-parallel zu airline/member-table.tsx — search, sort-toggle,
 * pagination, bulk-checkboxes kommen aus dem gleichen mental model.
 *
 * Performance-anmerkung: filter/sort/pagination + bulk-selection sind alle
 * clientside. Bei 500+ users würde der initial-data-payload + clientside-
 * arbeit spürbar — dann muss zu serverside-pagination mit URL-search-params
 * migriert werden (Next.js searchParams pattern). Bei aktuellem stand
 * (~handvoll users) ist clientside einfacher und schnell genug.
 */

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  totalFlightHours: number;
  totalFlights: number;
  createdAt: Date;
  rank: { name: string } | null;
  role: { name: string } | null;
  airline: { id: string; name: string; icao: string } | null;
}

interface Props {
  users: AdminUser[];
  /**
   * Distinct airlines die in der user-liste vorkommen — für den airline-
   * filter-dropdown. Wird im server-component aus den users-results
   * abgeleitet damit der dropdown nur airlines zeigt die auch tatsächlich
   * piloten haben (statt allen system-airlines).
   */
  availableAirlines: Array<{ id: string; name: string; icao: string }>;
  /**
   * Distinct rollen die in der user-liste vorkommen. Analog
   * availableAirlines — nur rollen die mind. 1x zugewiesen sind. Wird
   * für den FILTER-dropdown verwendet (ohne id, weil filter auf
   * role.name matcht).
   */
  availableRoles: Array<{ name: string }>;
  /**
   * ALLE rollen aus dem system mit ihrer id. Wird für den BULK-ASSIGN-
   * dropdown verwendet damit der admin auch rollen zuweisen kann die
   * bisher noch nicht in der user-liste vorkommen (z.B. neu erstellte
   * via /admin/roles).
   */
  allRoles: Array<{ id: string; name: string; description: string | null }>;
  currentUserId: string;
}

type SortKey = 'name' | 'airline' | 'hours' | 'flights' | 'created';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

/**
 * Special filter-values für die dropdowns. Empty string = "alle" (no
 * filter applied). `__none__` = explicit "kein wert gesetzt" (user ohne
 * airline / user ohne rolle). Wir verwenden eine sentinel-string statt
 * null/undefined damit native <select> das mit value="..." matchen kann.
 */
const FILTER_NONE = '__none__';

/**
 * Track 4 #47 (Section I): CSV-export helpers für die admin-pilots-
 * tabelle. Exportiert die AKTUELL gefilterten + sortierten rows (also
 * was der admin grade sieht), nicht den raw-bestand — sonst wäre der
 * filter-state irrelevant für den export.
 *
 * Format: RFC 4180-konform mit CRLF row-terminators und double-quote-
 * escaping. Excel + LibreOffice öffnen das ohne nachfragen. UTF-8 BOM
 * vorne damit Excel automatisch utf-8 erkennt (Umlaute in airline-namen
 * etc. sonst kaputt).
 */
function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Quoten wenn das field eines der RFC-relevanten zeichen enthält:
  // comma, double-quote, CR, LF. Double-quotes werden verdoppelt.
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows: AdminUser[]): string {
  const headers = [
    'Name',
    'Email',
    'Airline',
    'AirlineICAO',
    'Rank',
    'Rolle',
    'FlugStunden',
    'Anzahl Flüge',
    'Erstellt',
  ];
  const lines: string[] = [headers.map(escapeCsvField).join(',')];
  for (const u of rows) {
    lines.push(
      [
        escapeCsvField(u.name ?? ''),
        escapeCsvField(u.email),
        escapeCsvField(u.airline?.name ?? ''),
        escapeCsvField(u.airline?.icao ?? ''),
        escapeCsvField(u.rank?.name ?? ''),
        escapeCsvField(u.role?.name ?? ''),
        escapeCsvField(u.totalFlightHours.toFixed(1)),
        escapeCsvField(u.totalFlights),
        escapeCsvField(u.createdAt.toISOString().slice(0, 10)),
      ].join(','),
    );
  }
  // RFC 4180: CRLF zwischen rows. UTF-8 BOM (\uFEFF) am anfang damit
  // Excel utf-8 als encoding erkennt — sonst werden umlaute kaputt.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/**
 * Trigger CSV-download im browser. Nutzt einen object-URL der nach dem
 * click revoked wird damit die memory-page nicht wächst bei mehreren
 * exports pro session.
 */
function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke damit der browser den download initiieren kann bevor
  // der url ungültig wird. 1s ist konservativ genug.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AdminPilotsTable({
  users,
  availableAirlines,
  availableRoles,
  allRoles,
  currentUserId,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [airlineFilter, setAirlineFilter] = useState<string>(''); // '' = alle, FILTER_NONE = ohne airline, sonst airline.id
  const [roleFilter, setRoleFilter] = useState<string>(''); // '' = alle, FILTER_NONE = ohne rolle, sonst role.name

  const [sortKey, setSortKey] = useState<SortKey>('hours');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination — page-index 0-based intern, 1-based in der UI angezeigt
  const [page, setPage] = useState(0);

  // Bulk-selection state. Set<string> der ausgewählten user-ids. Wir
  // benutzen Set statt Array damit toggle/has O(1) sind und nicht O(n).
  // Selection bleibt ÜBER filter/sort/pagination hinweg erhalten — der
  // admin kann auf seite 1 user A auswählen, dann zur seite 2 wechseln
  // und user B dort markieren, beide werden zusammen ge-bulk-actioned.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk-assign-dropdown state. '' = nichts ausgewählt (button disabled),
  // 'null' = explizit "rolle entfernen", sonst die role.id.
  const [bulkRoleId, setBulkRoleId] = useState<string>('');

  // Banner state für error/success-feedback. Werden nach 6s automatisch
  // ausgeblendet weil der admin nach erfolgreichen actions weiterscrollt
  // und den banner sonst dauerhaft sehen würde.
  const [banner, setBanner] = useState<{
    kind: 'error' | 'info';
    text: string;
  } | null>(null);

  // useTransition für die server-action calls. Während pending ist der
  // bulk-button disabled + der spinner-text wird gezeigt.
  const [isPending, startTransition] = useTransition();

  // Filtered + sorted view. useMemo damit nicht bei jedem state-change
  // (z.B. page-toggle) die filter neu durchlaufen — nur wenn die inputs
  // (search/airline/role/sort) sich ändern.
  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let arr = users;

    // Suchfeld — über name + email. Lowercase einmal beim filtern.
    if (q) {
      arr = arr.filter((u) => {
        const name = (u.name ?? '').toLowerCase();
        const email = u.email.toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    // Airline-filter
    if (airlineFilter === FILTER_NONE) {
      arr = arr.filter((u) => u.airline === null);
    } else if (airlineFilter !== '') {
      arr = arr.filter((u) => u.airline?.id === airlineFilter);
    }

    // Rolle-filter
    if (roleFilter === FILTER_NONE) {
      arr = arr.filter((u) => u.role === null);
    } else if (roleFilter !== '') {
      arr = arr.filter((u) => u.role?.name === roleFilter);
    }

    // Stable copy vor sort, damit das original (props.users) nicht
    // mutiert wird. Ohne den copy würde React's reconciler unhappy.
    const sorted = [...arr].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name ?? '').localeCompare(b.name ?? '');
          break;
        case 'airline':
          // null-airlines ans ende der ascending sortierung. Falls
          // beide null, fall through zu cmp=0 (stable sort).
          cmp = (a.airline?.name ?? '\uFFFF').localeCompare(
            b.airline?.name ?? '\uFFFF',
          );
          break;
        case 'hours':
          cmp = a.totalFlightHours - b.totalFlightHours;
          break;
        case 'flights':
          cmp = a.totalFlights - b.totalFlights;
          break;
        case 'created':
          cmp = a.createdAt.getTime() - b.createdAt.getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [users, searchQuery, airlineFilter, roleFilter, sortKey, sortDir]);

  // Pagination derived state. Reset page wenn sich filtered-list ändert
  // (sonst landet man auf seite 5 mit nur 2 ergebnissen). useMemo macht
  // hier keinen sinn — das ist arithmetik, kein expensive computation.
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filteredAndSorted.length);
  const pageRows = filteredAndSorted.slice(pageStart, pageEnd);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Strings asc, numbers/dates desc — natural defaults
      setSortDir(key === 'name' || key === 'airline' ? 'asc' : 'desc');
    }
    setPage(0); // Reset auf erste seite bei sort-change
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <span className="opacity-30">↕</span>;
    return (
      <span className="text-indigo-500 dark:text-indigo-400">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );
  }

  // Reset-helper — ein klick statt 4 separate setStates
  function resetFilters() {
    setSearchQuery('');
    setAirlineFilter('');
    setRoleFilter('');
    setPage(0);
  }

  const hasActiveFilters =
    searchQuery !== '' || airlineFilter !== '' || roleFilter !== '';

  // === BULK-SELECTION HELPERS ===

  // Single-row toggle. Mutiert state immutable über new Set + setState.
  function toggleRow(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  // Header-checkbox: toggle für alle PAGE-ROWS (nicht alle filtered users).
  // Rationale: bei mehreren pages will der admin meist nur die sichtbare
  // page bulk-selecten, sonst wäre "alle 200 users auswählen" nur 1 klick
  // weg was zu unfälle führt. Will der admin wirklich alle: page-size auf
  // alle setzen oder mehrere pages durchgehen.
  const allOnPageSelected =
    pageRows.length > 0 && pageRows.every((u) => selectedIds.has(u.id));
  const someOnPageSelected =
    pageRows.some((u) => selectedIds.has(u.id)) && !allOnPageSelected;

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        // Alle abwählen die auf der page sind (selection auf anderen
        // pages bleibt erhalten — siehe state-comment oben)
        for (const u of pageRows) next.delete(u.id);
      } else {
        // Alle hinzufügen (bei partial schon selected: rest dazu)
        for (const u of pageRows) next.add(u.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkRoleId('');
  }

  // Auto-dismiss banner nach 6s. UseRef-pattern wäre purer aber ein
  // setTimeout im action-handler reicht hier — der banner wird jeweils
  // direkt nach action neu gesetzt und nach 6s gecleared. Wenn der admin
  // schnell zwei actions hintereinander macht, wird der banner-text
  // direkt überschrieben und der alte timer ist harmlos (cleared den
  // schon-überschriebenen banner nochmal auf null).
  function showBanner(kind: 'error' | 'info', text: string) {
    setBanner({ kind, text });
    setTimeout(() => setBanner(null), 6000);
  }

  // === BULK-ACTION HANDLERS ===

  function handleBulkAssignRole() {
    if (selectedIds.size === 0 || bulkRoleId === '') return;

    // Confirm-dialog mit konkretem text. Native confirm() ist hässlich
    // aber für admin-only-tools (kein customer-facing) absolut OK und
    // 0 dependencies. Wenn die UX später schöner werden soll: shadcn's
    // AlertDialog component (siehe roadmap track-3 shadcn-migration).
    const targetRole = bulkRoleId === 'null'
      ? '(keine Rolle)'
      : allRoles.find((r) => r.id === bulkRoleId)?.name ?? bulkRoleId;
    const confirmed = window.confirm(
      `${selectedIds.size} ${selectedIds.size === 1 ? 'User' : 'Usern'} die Rolle "${targetRole}" zuweisen?`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      try {
        const result = await adminBulkAssignRole({
          userIds: Array.from(selectedIds),
          roleId: bulkRoleId === 'null' ? null : bulkRoleId,
        });
        // Server-action gibt {succeeded, failed[]} zurück. Pro-user-fehler
        // kommen als failed-array — der bulk an sich war erfolgreich.
        if (result.failed.length === 0) {
          showBanner(
            'info',
            `${result.succeeded} ${result.succeeded === 1 ? 'User' : 'Users'} aktualisiert.`,
          );
        } else {
          // Mixed-result: zeige sowohl success-count als auch top-3
          // error-messages damit der admin sieht WAS schiefgegangen ist.
          const errSummary = result.failed
            .slice(0, 3)
            .map((f) => f.error)
            .join(' · ');
          const more = result.failed.length > 3 ? ` (+${result.failed.length - 3} weitere)` : '';
          showBanner(
            'error',
            `${result.succeeded} OK, ${result.failed.length} fehlgeschlagen: ${errSummary}${more}`,
          );
        }
        clearSelection();
      } catch (err) {
        showBanner(
          'error',
          err instanceof Error ? err.message : 'Unbekannter Fehler',
        );
      }
    });
  }

  function handleBulkRemoveFromAirline() {
    if (selectedIds.size === 0) return;

    // Stärkerer confirm-dialog — das ist eine destructive action die
    // role/rank/airline-membership wegnimmt. Texteingabe-confirmation
    // wäre überengineert für dieses scope, aber wir spezifizieren
    // explizit was passiert.
    const confirmed = window.confirm(
      `${selectedIds.size} ${selectedIds.size === 1 ? 'User' : 'Users'} aus ihrer Airline entfernen?\n\n` +
        `Dies setzt für jeden user airlineId, rankId, roleId und joinedAirlineAt auf null.\n` +
        `Der user-account selbst bleibt bestehen — die membership wird nur aufgelöst.\n\n` +
        `Diese Aktion kann durch invite-flow rückgängig gemacht werden.`,
    );
    if (!confirmed) return;

    startTransition(async () => {
      try {
        const result = await adminBulkRemoveFromAirline({
          userIds: Array.from(selectedIds),
        });
        if (result.failed.length === 0) {
          showBanner(
            'info',
            `${result.succeeded} ${result.succeeded === 1 ? 'User' : 'Users'} aus Airline entfernt.`,
          );
        } else {
          const errSummary = result.failed
            .slice(0, 3)
            .map((f) => f.error)
            .join(' · ');
          const more = result.failed.length > 3 ? ` (+${result.failed.length - 3} weitere)` : '';
          showBanner(
            'error',
            `${result.succeeded} OK, ${result.failed.length} fehlgeschlagen: ${errSummary}${more}`,
          );
        }
        clearSelection();
      } catch (err) {
        showBanner(
          'error',
          err instanceof Error ? err.message : 'Unbekannter Fehler',
        );
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* Banner für error/success-feedback. Auto-dismiss nach 6s, siehe
          showBanner(). Position: ganz oben in der card damit auch bei
          gescrollter tabelle sichtbar. */}
      {banner && (
        <div
          className={`px-4 py-3 text-sm border-b ${
            banner.kind === 'error'
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900/50 text-red-900 dark:text-red-200'
              : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/50 text-emerald-900 dark:text-emerald-200'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Bulk-action-bar — nur sichtbar wenn mind. 1 user selected ist.
          Layout: links count + bulk-controls, rechts auswahl-aufheben.
          Bewusst über der filter-bar damit klar ist dass die selection
          nicht von filter abhängig ist (beide arbeiten auf dem master-
          users-array, filter ändert nur die anzeige). */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-200 dark:border-indigo-900/50 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            {selectedIds.size} {selectedIds.size === 1 ? 'User' : 'Users'} ausgewählt
          </span>

          <span className="h-5 w-px bg-indigo-300 dark:bg-indigo-700" />

          {/* Rolle-zuweisen group */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-indigo-900 dark:text-indigo-200">Rolle:</span>
            <select
              value={bulkRoleId}
              onChange={(e) => setBulkRoleId(e.target.value)}
              disabled={isPending}
              className="px-2 py-1 bg-white dark:bg-gray-900 border border-indigo-300 dark:border-indigo-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-50"
            >
              <option value="">— bitte wählen —</option>
              <option value="null">— Rolle entfernen —</option>
              {allRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleBulkAssignRole}
              disabled={isPending || bulkRoleId === ''}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition"
            >
              {isPending ? 'läuft…' : 'Zuweisen'}
            </button>
          </label>

          <span className="h-5 w-px bg-indigo-300 dark:bg-indigo-700" />

          {/* Airline-entfernen */}
          <button
            type="button"
            onClick={handleBulkRemoveFromAirline}
            disabled={isPending}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition"
          >
            {isPending ? 'läuft…' : 'Aus Airline entfernen'}
          </button>

          <button
            type="button"
            onClick={clearSelection}
            disabled={isPending}
            className="ml-auto px-3 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 rounded text-xs transition"
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      {/* Filter-bar — sticky-feel nicht nötig, die tabelle hat ihren
          eigenen scroll-container. Wrap auf flex-wrap für schmale viewports. */}
      <div className="border-b border-gray-200 dark:border-gray-800 p-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Suche (Name, Email)…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(0);
          }}
          className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none w-64"
        />

        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Airline:</span>
          <select
            value={airlineFilter}
            onChange={(e) => {
              setAirlineFilter(e.target.value);
              setPage(0);
            }}
            className="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          >
            <option value="">Alle</option>
            <option value={FILTER_NONE}>— ohne Airline —</option>
            {availableAirlines.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icao} {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Rolle:</span>
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(0);
            }}
            className="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          >
            <option value="">Alle</option>
            <option value={FILTER_NONE}>— ohne Rolle —</option>
            {availableRoles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded transition"
          >
            Filter zurücksetzen
          </button>
        )}

        {/* Track 4 #47 (Section I): CSV-Export. Nur sichtbar wenn mind.
            1 row zum exportieren da ist — bei leerer ergebnisliste wäre
            der button useless. Exportiert filteredAndSorted (also was
            der admin grade sieht), nicht users (raw bestand). Filename
            enthält ISO-datum damit mehrere exports nicht überschreiben. */}
        {filteredAndSorted.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              const csv = rowsToCsv(filteredAndSorted);
              downloadCsv(`admin-pilots-${today}.csv`, csv);
            }}
            className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded transition inline-flex items-center gap-1"
            title={`${filteredAndSorted.length} Zeilen als CSV exportieren`}
          >
            <span aria-hidden="true">📥</span>
            CSV-Export
          </button>
        )}

        {/* Result-counter rechts. Zeigt die filter-wirkung sofort. */}
        <span className="ml-auto text-xs text-gray-500">
          {filteredAndSorted.length === users.length
            ? `${users.length} ${users.length === 1 ? 'User' : 'User'}`
            : `${filteredAndSorted.length} von ${users.length}`}
        </span>
      </div>

      {filteredAndSorted.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {hasActiveFilters
              ? 'Keine Treffer für die aktuellen Filter.'
              : 'Noch keine User registriert.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {/* Bulk-checkbox-spalte. Header-checkbox toggelt
                      page-rows (siehe toggleAllOnPage rationale). Tri-state
                      via indeterminate (in useEffect-pattern später, native
                      input.indeterminate property — wir setzen sie via
                      ref-callback damit React keinen warning gibt). */}
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPageSelected;
                      }}
                      onChange={toggleAllOnPage}
                      aria-label="Alle auf dieser Seite auswählen"
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('name')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                    >
                      Pilot {sortIcon('name')}
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('airline')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                    >
                      Airline {sortIcon('airline')}
                    </button>
                  </th>
                  <th className="px-4 py-3">Rang</th>
                  <th className="px-4 py-3">Rolle</th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('hours')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 uppercase tracking-wider"
                    >
                      Stunden {sortIcon('hours')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('flights')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 uppercase tracking-wider"
                    >
                      Flüge {sortIcon('flights')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('created')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 uppercase tracking-wider"
                    >
                      Registriert {sortIcon('created')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pageRows.map((user) => {
                  const isMe = user.id === currentUserId;
                  const isSelected = selectedIds.has(user.id);
                  return (
                    <tr
                      key={user.id}
                      className={`group transition ${
                        isSelected
                          ? 'bg-indigo-100 dark:bg-indigo-900/30'
                          : isMe
                            ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }`}
                    >
                      {/* Checkbox-cell. Klick auf die checkbox toggelt
                          row-selection ohne dass der row-link folgt
                          (native browser-behavior — input fängt den click). */}
                      <td className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(user.id)}
                          aria-label={`User ${user.name ?? 'Unbenannt'} auswählen`}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/pilots/${user.id}`}
                          className="flex items-center gap-3"
                        >
                          {user.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={user.image}
                              alt={user.name ?? 'Avatar'}
                              className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700" />
                          )}
                          <div>
                            <p className="font-semibold flex items-center gap-2">
                              {user.name ?? 'Unbenannt'}
                              {isMe && (
                                <span className="text-xs text-indigo-600 dark:text-indigo-400">
                                  (Du)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-500 truncate max-w-[14rem]">
                              {user.email}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {user.airline ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {user.airline.icao}
                            </span>
                            <span className="text-gray-700 dark:text-gray-300 truncate max-w-[12rem]">
                              {user.airline.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-gray-400 dark:text-gray-600">
                            keine
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {user.rank?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {user.role?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {user.totalFlightHours.toFixed(1)} h
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {user.totalFlights}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                        {new Date(user.createdAt).toLocaleDateString('de-DE', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination-bar — nur sichtbar wenn mehr als 1 page nötig ist.
              Layout: links die page-info ("Seite 1 von 3 · Zeilen 1–25 von 67"),
              rechts die navigation-buttons. */}
          {totalPages > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between flex-wrap gap-3 text-sm">
              <span className="text-gray-500 dark:text-gray-400 text-xs">
                Seite {safePage + 1} von {totalPages} · Zeilen {pageStart + 1}–
                {pageEnd} von {filteredAndSorted.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(0)}
                  disabled={safePage === 0}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Erste Seite"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  ← Zurück
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  Vor →
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages - 1)}
                  disabled={safePage >= totalPages - 1}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Letzte Seite"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
