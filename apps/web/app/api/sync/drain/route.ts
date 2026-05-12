import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { sendPushToUser, isPushConfigured } from '@/lib/push/vapid';

/**
 * Track 5 #25 (Section E) — POST /api/sync/drain
 *
 * Batched drain-endpoint für offline-queued drafts. Wird sowohl vom SW
 * sync-handler (Background Sync API, chrome/edge) als auch vom client
 * direkt (online-event-fallback, firefox/safari) aufgerufen — beide
 * pfade haben die selbe payload-shape.
 *
 * # Request body
 *
 *   { drafts: [{ id: number, kind: string, payload: unknown, createdAt: number, retryCount?: number }, ...] }
 *
 * # Response
 *
 *   200: { processedIds: number[], failedIds: number[], skippedIds: number[] }
 *      processedIds: drafts die erfolgreich verarbeitet wurden → client/SW
 *                    löscht die rows aus IndexedDB
 *      failedIds:    drafts die mit permanent-failure abgewiesen wurden →
 *                    client/SW bumped retryCount, evtl. dead-letter
 *      skippedIds:   drafts die wir gar nicht verarbeiten wollten (unknown
 *                    kind, malformed payload) → behandelt wie failed
 *
 *   401: nicht angemeldet — drafts bleiben offline-queued
 *   400: malformed request — caller bug, drafts bleiben queued
 *   500: server error — drafts bleiben queued (retry-count NICHT gebumped
 *        auf SW-side weil network/server-error transient ist)
 *
 * # Per-kind dispatch
 *
 * Aktuell unterstützte kinds:
 *
 *   'demo-ping' — testet die full-stack pipeline. Triggert eine push-
 *                 notification an den user (wenn #24 push-subscribed +
 *                 VAPID configured) und gibt success zurück. Nützlich
 *                 für end-to-end-tests von #24 + #25 zusammen.
 *
 *   'pirep-submit' — TODO: noch nicht integriert mit der existing PIREP-
 *                 submit-server-action. Diese kind wird als skipped
 *                 markiert + draft bleibt queued bis die integration
 *                 in einem follow-up feature passiert. Wäre simple:
 *                 dispatch zur PIREP-submit-action mit dem payload.
 *
 * # Wer triggert was
 *
 *   SW sync-handler  → batched drain via dieser route
 *   online-event UI  → drainDraftsFromClient() → dieser route
 *   manuelle UI-button "jetzt syncen" → drainDraftsFromClient() → hier
 *
 * Alle 3 pfade sind idempotent — duplicate drain-attempts für die selben
 * drafts sind safe (processed-ids return-shape sagt dem client was schon
 * weg ist; nochmaliges submit eines bereits-gelöschten drafts ist no-op
 * weil der client die row dann eh nicht mehr im IDB hat).
 */

// Caps:
//   - max 100 drafts pro request (rate-limit + memory-protection)
//   - kind max 64 chars (discriminator, sollte short sein)
//   - payload max 64KB serialized (großzügig für PIREP-form-data)
const DrainRequestSchema = z.object({
  drafts: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        kind: z.string().min(1).max(64),
        // payload: arbitrary JSON. Wir validieren bei dispatch pro-kind,
        // hier nur als unknown durchwinken damit zod nicht versucht den
        // ganzen baum zu typen.
        payload: z.unknown(),
        createdAt: z.number().int().nonnegative(),
        retryCount: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const parsed = DrainRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid-shape', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const processedIds: number[] = [];
  const failedIds: number[] = [];
  const skippedIds: number[] = [];

  for (const draft of parsed.data.drafts) {
    const handler = DISPATCH_HANDLERS[draft.kind];
    if (!handler) {
      // Unknown kind → skipped. Client wird's behandeln wie failed +
      // retryCount bump → eventually dead-letter wenn permanent.
      skippedIds.push(draft.id);
      continue;
    }

    try {
      const result = await handler({
        userId: session.user.id,
        payload: draft.payload,
        retryCount: draft.retryCount ?? 0,
      });
      if (result === 'processed') {
        processedIds.push(draft.id);
      } else {
        failedIds.push(draft.id);
      }
    } catch {
      // Handler-exception → treated as transient failure (NOT skipped),
      // damit das draft im queue bleibt für späteren retry. Der client
      // bumped retryCount.
      failedIds.push(draft.id);
    }
  }

  return NextResponse.json({ processedIds, failedIds, skippedIds });
}

// ─────────────────────────────────────────────────────────────────────
// Dispatch handlers
// ─────────────────────────────────────────────────────────────────────

type DispatchContext = {
  userId: string;
  payload: unknown;
  retryCount: number;
};

type DispatchResult = 'processed' | 'failed';

/**
 * Registry: kind → handler function. Wenn ein neuer draft-typ
 * eingeführt wird (z.B. 'pirep-submit' fully integriert, oder
 * 'comment-submit' für PIREP-comments-offline-mode), wird hier ein
 * neuer eintrag dazu kommen.
 */
const DISPATCH_HANDLERS: Record<
  string,
  (ctx: DispatchContext) => Promise<DispatchResult>
> = {
  /**
   * 'demo-ping': end-to-end test des sync-flows. Triggert eine push-
   * notification an den user via #24 sendPushToUser (wenn push subscribed
   * + VAPID configured) und returnt processed. Das demonstriert:
   *
   *   client UI → enqueueDraft({kind: 'demo-ping'}) → goes offline
   *               → online again → sync triggers → /api/sync/drain
   *               → sendPushToUser → push to all user-devices
   *               → "✅ Sync test erfolgreich"
   *
   * Kein side-effect außer der push-notification. Idempotent: doppelte
   * pings → doppelte notifications, aber kein DB-state.
   */
  'demo-ping': async ({ userId }) => {
    if (!isPushConfigured()) {
      // Ohne push-konfig kann der user trotzdem das sync-feature testen,
      // wir markieren just als processed damit das draft aus dem queue
      // geht. Der client kann das im UI-toast feedback geben.
      return 'processed';
    }
    await sendPushToUser(userId, {
      title: '✅ Sync test erfolgreich',
      body: 'Dein offline-draft wurde nach reconnect drained + verarbeitet.',
      url: '/settings/notifications',
      tag: 'vam-sync-demo',
    });
    return 'processed';
  },

  // TODO Track 5 follow-up: 'pirep-submit' handler wenn die existing
  // /pireps/new submit-action für offline-mode adaptiert wird. Skeleton:
  //
  // 'pirep-submit': async ({ userId, payload }) => {
  //   const parsed = PirepSubmitPayloadSchema.safeParse(payload);
  //   if (!parsed.success) return 'failed'; // permanent: malformed
  //   await submitPirep({ ...parsed.data, userId });
  //   return 'processed';
  // },
};
