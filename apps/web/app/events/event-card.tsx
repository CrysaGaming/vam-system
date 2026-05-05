import Link from 'next/link';
import type { EventWithCounts, RuntimeStatus, EventKind } from '@vam/db';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Event-card für catalog-grid.
 *
 * Stateless component, server-renderable. Zeigt:
 *   - Optional cover-image als top-banner (16:9 aspect)
 *   - Title (clickable → detail-page)
 *   - Kind-badge
 *   - Runtime-status-badge (UPCOMING/IN_PROGRESS/ENDED/COMPLETED/CANCELLED)
 *   - Datum/zeit (startsAt formatiert in de-DE locale)
 *   - Description-snippet (max 120 chars)
 *   - participantCount + optional maxParticipants ("12/25 Teilnehmer")
 *   - bonusReward wenn > 0
 *
 * Layout: ganze card ist als Link ausgelegt damit cursor:pointer + hover-
 * border feedback gibt. Image wird mit <picture><img> wrapper gerendert
 * um Next.js 16 / React 19 Float auto-preload-warning zu unterdrücken
 * (siehe userMemories: "Wrap plain <img> with external URLs in a
 * <picture> element").
 */

const KIND_LABELS: Record<EventKind, string> = {
  TOUR: 'Tour',
  SINGLE_FLIGHT: 'Single-Flight',
  THEMED: 'Themen-Event',
  GROUP_FLIGHT: 'Group-Flight',
  SEASONAL: 'Saison-Event',
};

const STATUS_LABELS: Record<RuntimeStatus, string> = {
  DRAFT: 'Entwurf',
  UPCOMING: 'Bald',
  IN_PROGRESS: 'Läuft',
  ENDED: 'Beendet',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgesagt',
};

const STATUS_STYLES: Record<RuntimeStatus, string> = {
  DRAFT: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  UPCOMING:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  IN_PROGRESS:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  ENDED: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  COMPLETED:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  CANCELLED:
    'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
};

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

export function EventCard({ event }: { event: EventWithCounts }) {
  const bonus = Number(event.bonusReward);
  const cover = event.coverImageUrl;
  const showImage = cover && cover.startsWith('http');

  return (
    <Link
      href={`/events/${event.slug}`}
      className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-lg overflow-hidden transition"
    >
      {showImage && (
        // <picture> wrapper unterdrückt React 19 Float auto-preload-warning
        // für externe img-URLs. Comment hier (vor return) — NIE direkt
        // vor <picture> in JSX-ternary (Turbopack stripping → hydration
        // mismatch, siehe commit 227f70f auf cc-experiment).
        <picture>
          <img
            src={cover}
            alt=""
            className="w-full aspect-video object-cover"
            loading="lazy"
          />
        </picture>
      )}
      <div className="p-4">
        <div className="flex items-start gap-2 mb-2">
          <h3 className="font-semibold text-base leading-tight flex-1">
            {event.title}
          </h3>
          <span
            className={`shrink-0 text-xs px-2 py-0.5 rounded ${STATUS_STYLES[event.runtimeStatus]}`}
          >
            {STATUS_LABELS[event.runtimeStatus]}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 text-xs mb-3">
          <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded">
            {KIND_LABELS[event.kind]}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {formatDateTime(event.startsAt)}
          </span>
        </div>

        {event.description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 leading-snug">
            {truncate(event.description, 120)}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            <span className="font-semibold text-gray-700 dark:text-gray-300">
              {event.participantCount}
            </span>
            {event.maxParticipants !== null && (
              <span>/{event.maxParticipants}</span>
            )}{' '}
            Teilnehmer
          </span>
          {bonus > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              +{bonus} VAM$ Bonus
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
