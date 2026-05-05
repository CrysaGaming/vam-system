'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setFlightSchoolActive } from './actions';

interface Props {
  schoolId: string;
  active: boolean;
}

/**
 * Inline-toggle button für active/inactive auf der list-page (Welle 13E-11).
 *
 * Hard-delete ist bewusst NICHT angeboten — siehe schema-comment + actions
 * setFlightSchoolActive: existing enrollments dürfen nicht orphaned werden,
 * also ist soft-delete via active=false die einzige offizielle "lösch"-
 * operation. Re-activate via gleicher button (toggle), kein separater
 * "wiederherstellen"-flow nötig.
 */
export function ActiveToggleButton({ schoolId, active }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pending) return;
    if (active && !confirm('FlightSchool deaktivieren? Bestehende Enrollments laufen weiter, aber neue werden blockiert.')) {
      return;
    }
    startTransition(async () => {
      try {
        await setFlightSchoolActive(schoolId, !active);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Fehler beim Toggle');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={`px-2.5 py-1 rounded text-xs font-medium transition disabled:opacity-50 ${
        active
          ? 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-500/25'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
      title={active ? 'Klick zum Deaktivieren' : 'Klick zum Aktivieren'}
    >
      {pending ? '…' : active ? '● Aktiv' : '○ Inaktiv'}
    </button>
  );
}
