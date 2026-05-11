import Link from 'next/link';
import type { EventKind } from '@vam/db';

/**
 * Track 4 #95 (Section S) — Event-Calendar-View.
 *
 * Month-grid component für /events page. Toggle zwischen list + calendar
 * via ?view=calendar. Zeigt alle published-events (upcoming + past) im
 * gewählten monat als grid mit weekdays-header.
 *
 * # Display-strategie
 *
 * Calendar zeigt 5-6 wochen — von der ersten woche des monats (inkl.
 * trailing-tage vom vor-monat ab Montag) bis zur letzten woche (inkl.
 * leading-tage vom nach-monat bis Sonntag). Total: 35 oder 42 zellen.
 * Trailing/leading-tage werden gedimmt rendered damit der visuelle
 * fokus auf dem aktuellen monat liegt.
 *
 * Events landen auf ihrem startsAt-tag. Für multi-day events (endsAt
 * vorhanden + > startsAt) wird das event auf JEDEN tag des span gerendert
 * — das matched der intuition von gantt-charts/google-calendar.
 *
 * Per zelle max 3 events sichtbar. Bei overflow: "+N weitere" link der
 * zur list-view mit dem entsprechenden monat filtert (out-of-scope für
 * v1 — wir zeigen einfach den count ohne deep-link).
 *
 * # Navigation
 *
 * URL-param ?month=YYYY-MM. Default = current month. Prev/next-buttons
 * navigieren um einen monat. Heute-button springt zum current month.
 *
 * # Kind-colors
 *
 * Synchron mit der event-card kind-styling (KIND_LABELS aus page.tsx).
 * TOUR=violet, SINGLE_FLIGHT=sky, THEMED=amber, GROUP_FLIGHT=emerald,
 * SEASONAL=pink.
 */

const KIND_COLORS: Record<
  EventKind,
  { bg: string; text: string; border: string; ringFocus: string }
> = {
  TOUR: {
    bg: 'bg-violet-100 dark:bg-violet-500/20',
    text: 'text-violet-900 dark:text-violet-200',
    border: 'border-violet-300 dark:border-violet-500/40',
    ringFocus: 'hover:ring-violet-400 dark:hover:ring-violet-500',
  },
  SINGLE_FLIGHT: {
    bg: 'bg-sky-100 dark:bg-sky-500/20',
    text: 'text-sky-900 dark:text-sky-200',
    border: 'border-sky-300 dark:border-sky-500/40',
    ringFocus: 'hover:ring-sky-400 dark:hover:ring-sky-500',
  },
  THEMED: {
    bg: 'bg-amber-100 dark:bg-amber-500/20',
    text: 'text-amber-900 dark:text-amber-200',
    border: 'border-amber-300 dark:border-amber-500/40',
    ringFocus: 'hover:ring-amber-400 dark:hover:ring-amber-500',
  },
  GROUP_FLIGHT: {
    bg: 'bg-emerald-100 dark:bg-emerald-500/20',
    text: 'text-emerald-900 dark:text-emerald-200',
    border: 'border-emerald-300 dark:border-emerald-500/40',
    ringFocus: 'hover:ring-emerald-400 dark:hover:ring-emerald-500',
  },
  SEASONAL: {
    bg: 'bg-pink-100 dark:bg-pink-500/20',
    text: 'text-pink-900 dark:text-pink-200',
    border: 'border-pink-300 dark:border-pink-500/40',
    ringFocus: 'hover:ring-pink-400 dark:hover:ring-pink-500',
  },
};

const KIND_ICONS: Record<EventKind, string> = {
  TOUR: '🗺️',
  SINGLE_FLIGHT: '✈️',
  THEMED: '🎨',
  GROUP_FLIGHT: '👥',
  SEASONAL: '🎄',
};

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

interface CalendarEvent {
  id: string;
  slug: string;
  title: string;
  kind: EventKind;
  startsAt: Date;
  endsAt: Date | null;
}

interface Props {
  events: CalendarEvent[];
  /** YYYY-MM string. Default = current month if undefined. */
  monthParam?: string;
  /** Optional kind-filter from URL (für prev/next preservation) */
  kindParam?: string;
}

/**
 * Parse YYYY-MM into a Date pointing to first of that month (UTC).
 * Returns current month's first if param invalid or missing.
 */
function parseMonth(param: string | undefined): Date {
  const now = new Date();
  if (!param) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const match = /^(\d{4})-(\d{2})$/.exec(param);
  if (!match) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const year = parseInt(match[1], 10);
  const monthIdx = parseInt(match[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(year, monthIdx, 1));
}

function formatMonthParam(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Returns ISO-weekday (1=Mo .. 7=Su) for given UTC-date. */
function isoWeekday(date: Date): number {
  // getUTCDay returns 0=Su .. 6=Sa → convert to 1=Mo .. 7=Su
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

/** YYYY-MM-DD key for grouping events by day */
function dayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build a 35- or 42-cell grid for the given month. Starts at Monday of
 * the week containing first-of-month, ends at Sunday of the week
 * containing last-of-month.
 */
function buildGridDays(month: Date): Date[] {
  const firstOfMonth = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
  );
  // Move back to Monday of that week (weekday 1)
  const gridStartOffset = isoWeekday(firstOfMonth) - 1; // 0..6
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStartOffset);

  // Last day of month
  const lastOfMonth = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  );
  // Move forward to Sunday of that week (weekday 7)
  const gridEndOffset = 7 - isoWeekday(lastOfMonth); // 0..6
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + gridEndOffset);

  const days: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Group events by day-key. For multi-day events (endsAt > startsAt),
 * the event appears on each day of its span (capped at 31 days to
 * avoid runaway open-ended events filling the grid).
 */
function groupEventsByDay(
  events: CalendarEvent[],
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    // startsAt-only: just the starting day
    const start = new Date(
      Date.UTC(
        ev.startsAt.getUTCFullYear(),
        ev.startsAt.getUTCMonth(),
        ev.startsAt.getUTCDate(),
      ),
    );
    if (!ev.endsAt) {
      const key = dayKey(start);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
      continue;
    }
    const end = new Date(
      Date.UTC(
        ev.endsAt.getUTCFullYear(),
        ev.endsAt.getUTCMonth(),
        ev.endsAt.getUTCDate(),
      ),
    );
    // Span: iterate days from start to end (cap 31 days)
    let safety = 31;
    const cursor = new Date(start);
    while (cursor <= end && safety > 0) {
      const key = dayKey(cursor);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      safety -= 1;
    }
  }
  return map;
}

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

export function EventCalendar({ events, monthParam, kindParam }: Props) {
  const month = parseMonth(monthParam);
  const days = buildGridDays(month);
  const grouped = groupEventsByDay(events);
  const monthIdx = month.getUTCMonth();
  const year = month.getUTCFullYear();

  // Prev/next month
  const prev = new Date(Date.UTC(year, monthIdx - 1, 1));
  const next = new Date(Date.UTC(year, monthIdx + 1, 1));
  const todayKey = dayKey(new Date());

  // Query-string helper für nav-links
  const baseQs = (m: Date) => {
    const parts = [`view=calendar`, `month=${formatMonthParam(m)}`];
    if (kindParam) parts.push(`kind=${kindParam}`);
    return parts.join('&');
  };

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 sm:p-6">
      {/* Month-navigation header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Link
            href={`/events?${baseQs(prev)}`}
            aria-label="Vorheriger Monat"
            className="px-2.5 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-sm transition"
          >
            ←
          </Link>
          <h2 className="text-xl font-bold min-w-[10rem] text-center">
            {MONTH_NAMES[monthIdx]} {year}
          </h2>
          <Link
            href={`/events?${baseQs(next)}`}
            aria-label="Nächster Monat"
            className="px-2.5 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-sm transition"
          >
            →
          </Link>
        </div>
        <Link
          href={`/events?view=calendar${kindParam ? `&kind=${kindParam}` : ''}`}
          className="text-xs px-2.5 py-1.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-500/30 transition font-medium"
        >
          Heute
        </Link>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="py-1">
            {wd}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = day.getUTCMonth() === monthIdx;
          const isToday = dayKey(day) === todayKey;
          const dayEvents = grouped.get(dayKey(day)) ?? [];
          const visibleEvents = dayEvents.slice(0, 3);
          const overflowCount = dayEvents.length - visibleEvents.length;

          return (
            <div
              key={dayKey(day)}
              className={`min-h-[6rem] sm:min-h-[7rem] rounded border p-1 sm:p-1.5 flex flex-col gap-0.5 text-xs ${
                inMonth
                  ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
                  : 'bg-gray-50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800/50 opacity-50'
              } ${
                isToday
                  ? 'ring-2 ring-indigo-500 dark:ring-indigo-400'
                  : ''
              }`}
            >
              <div
                className={`flex items-baseline justify-between gap-1 ${
                  isToday
                    ? 'font-bold text-indigo-700 dark:text-indigo-300'
                    : inMonth
                      ? 'font-semibold text-gray-700 dark:text-gray-300'
                      : 'text-gray-400 dark:text-gray-600'
                }`}
              >
                <span>{day.getUTCDate()}</span>
                {dayEvents.length > 0 && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                    {dayEvents.length}
                  </span>
                )}
              </div>
              {visibleEvents.map((ev) => {
                const colors = KIND_COLORS[ev.kind];
                return (
                  <Link
                    key={ev.id}
                    href={`/events/${ev.slug}`}
                    title={ev.title}
                    className={`block px-1 py-0.5 rounded border ${colors.bg} ${colors.text} ${colors.border} hover:ring-1 ${colors.ringFocus} truncate text-[10px] sm:text-[11px] leading-tight transition`}
                  >
                    <span className="mr-0.5" aria-hidden="true">
                      {KIND_ICONS[ev.kind]}
                    </span>
                    {ev.title}
                  </Link>
                );
              })}
              {overflowCount > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-gray-500 italic px-1">
                  +{overflowCount} weitere
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 flex flex-wrap gap-2 text-[11px]">
        <span className="text-gray-500 dark:text-gray-400 mr-1">Legende:</span>
        {(Object.entries(KIND_COLORS) as Array<
          [EventKind, (typeof KIND_COLORS)[EventKind]]
        >).map(([kind, colors]) => (
          <span
            key={kind}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${colors.bg} ${colors.text} ${colors.border}`}
          >
            <span aria-hidden="true">{KIND_ICONS[kind]}</span>
            <span className="font-medium">
              {kind === 'TOUR'
                ? 'Tour'
                : kind === 'SINGLE_FLIGHT'
                  ? 'Single-Flight'
                  : kind === 'THEMED'
                    ? 'Themen'
                    : kind === 'GROUP_FLIGHT'
                      ? 'Group'
                      : 'Saison'}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}
