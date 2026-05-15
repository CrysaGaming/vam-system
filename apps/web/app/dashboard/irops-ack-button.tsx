'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ackIropsEventAction } from './irops-actions';

/**
 * Welle P / P4 — Client-side acknowledge button.
 *
 * Wraps the ackIropsEventAction server action in useTransition so the
 * button shows a pending state while the request is in flight and
 * router.refresh() pulls the dashboard back from the server after the
 * ack lands — the IROP disappears from the list seamlessly.
 *
 * Keeping the client-side surface this thin lets the parent card stay
 * a server component. Only the button needs the use-client boundary.
 */
export function IropsAckButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await ackIropsEventAction(eventId);
          if (result.ok) {
            router.refresh();
          }
          // We swallow !ok intentionally — the only failure mode is
          // "already acknowledged or not yours", which is silent from
          // the user's POV (they'll see the list update on next render).
        });
      }}
      className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Bestätige…' : 'Verstanden'}
    </button>
  );
}
