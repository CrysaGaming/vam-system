import {
  getActiveIropsForUser,
  iropsEventTypeLabel,
  iropsEventTypeEmoji,
  iropsSeverityStyle,
  type ActiveIropsRow,
} from '@/lib/irops/dispatcher';
import { IropsAckButton } from './irops-ack-button';

/**
 * Welle P / P4 — Dashboard IROPs card.
 *
 * Server component. Lists unacknowledged irregular-operations events
 * for the pilot's bookings and offers a one-click acknowledge per
 * event. The card renders nothing when there are no active IROPs —
 * the dashboard stays clean for pilots who are flying smoothly.
 *
 * Why one-click ack: the design isn't to make the pilot type a reason
 * or assess severity. Real-airline ops eats irregular ops as a cost
 * of doing business; the acknowledgment is just "I saw it" so we
 * don't keep nagging on every dashboard load.
 *
 * The severity color is the only differential treatment — MAJOR
 * events get a rose border so the pilot's eye lands on them first
 * if there are multiple stacked.
 */

export async function IropsCard({ userId }: { userId: string }) {
  const events = await getActiveIropsForUser(userId);

  // Empty-state: render nothing. The dashboard parent gate keeps it
  // out of the grid entirely so we don't even allocate space.
  if (events.length === 0) return null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            🌪️ Irregular Ops
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {events.length === 1
              ? '1 offene Disruption zum Bestätigen'
              : `${events.length} offene Disruptionen zum Bestätigen`}
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {events.map((event) => (
          <IropsEventRow key={event.id} event={event} />
        ))}
      </ul>
    </section>
  );
}

function IropsEventRow({ event }: { event: ActiveIropsRow }) {
  const sev = iropsSeverityStyle(event.severity);
  const route = event.booking.route;
  const departure = route?.departure?.icao ?? '???';
  const arrival = route?.arrival?.icao ?? '???';
  const flightNumber = route?.flightNumber ?? 'Direct flight';

  return (
    <li
      className={`rounded-md border ${sev.border} ${sev.bg} p-3`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span aria-hidden="true">{iropsEventTypeEmoji(event.eventType)}</span>
            <span className={`font-semibold ${sev.text}`}>
              {iropsEventTypeLabel(event.eventType)}
            </span>
            {event.delayMin > 0 && (
              <span className={`font-mono ${sev.text}`}>
                · +{event.delayMin} min
              </span>
            )}
            <span className="ml-auto font-mono text-[10px] text-gray-500 dark:text-gray-400">
              {flightNumber} · {departure}→{arrival}
            </span>
          </div>
          <p className={`mt-2 text-xs leading-snug ${sev.text}`}>
            {event.message}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <IropsAckButton eventId={event.id} />
      </div>
    </li>
  );
}
