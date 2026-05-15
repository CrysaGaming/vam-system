import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma, type ChannelPointActionType, type ChannelPointRedemptionStatus } from '@vam/db';
import { AddRewardForm, RewardRowActions } from './_form';

/**
 * Welle O / O4 — Channel-points mapping admin.
 *
 * Route: /settings/twitch/channel-points
 *
 * Streamer-facing page to map Twitch channel-point rewards onto
 * VAM actions. Sub-page of /settings/twitch. Requires connected
 * Twitch account (we redirect back to the hub if not connected —
 * mapping rewards without a linked twitchUserId would be useless;
 * the webhook can't resolve who they belong to).
 *
 * # Sections
 *
 * 1. Header + back-link to /settings/twitch
 * 2. Add-mapping form (always visible, client component)
 * 3. Configured mappings table — list, toggle, delete
 * 4. Recent redemptions table — last 20, with status badges,
 *    for sanity-checking that the bot is actually delivering events
 *
 * # Empty states
 *
 * No mappings yet → form is the dominant element; mappings-list
 * section shows "No mappings configured yet" instead of an empty
 * table. Same for redemptions: "No redemptions recorded yet —
 * configure a mapping and ask a viewer to redeem".
 */

export const dynamic = 'force-dynamic';

// Display-metadata per action-type. Mirrors the catalog in _form.tsx
// but is a separate constant so the page (server component) doesn't
// need to import the client-component file. Small duplication
// preferred over cross-boundary import that would break tree-shaking.
const ACTION_DISPLAY: Record<
  ChannelPointActionType,
  { emoji: string; label: string }
> = {
  FUEL_BONUS: { emoji: '💰', label: 'Fuel Bonus' },
  CALLSIGN_SHOUT: { emoji: '📢', label: 'Callsign Shout' },
  GATE_REQUEST: { emoji: '🛬', label: 'Gate Request' },
  WEATHER_NUDGE: { emoji: '🌦️', label: 'Weather Nudge' },
};

// Redemption-status → badge style. Mirrors the enum from the schema.
// Style choices:
//   EXECUTED         → emerald (success, common case)
//   UNMATCHED        → amber (warning, "you might want to map this")
//   SKIPPED_DISABLED → slate (neutral, intentional skip)
//   FAILED           → rose (error, needs attention)
const STATUS_STYLE: Record<
  ChannelPointRedemptionStatus,
  { bg: string; text: string; label: string }
> = {
  EXECUTED: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-800 dark:text-emerald-200',
    label: '✓ Executed',
  },
  UNMATCHED: {
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-800 dark:text-amber-200',
    label: '? Unmatched',
  },
  SKIPPED_DISABLED: {
    bg: 'bg-slate-200 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    label: '○ Skipped',
  },
  FAILED: {
    bg: 'bg-rose-100 dark:bg-rose-900/40',
    text: 'text-rose-800 dark:text-rose-200',
    label: '⚠ Failed',
  },
};

function formatPayloadSummary(
  actionType: ChannelPointActionType,
  payload: unknown,
): string {
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    return actionType === 'CALLSIGN_SHOUT' ? '—' : '(default)';
  }
  const p = payload as Record<string, unknown>;
  switch (actionType) {
    case 'FUEL_BONUS': {
      const amt = typeof p.amountVam === 'number' ? p.amountVam : 25;
      return `${amt} VAM$`;
    }
    case 'GATE_REQUEST': {
      const label = typeof p.label === 'string' ? p.label : null;
      return label ? `"${label}"` : '(default label)';
    }
    case 'WEATHER_NUDGE': {
      const preset = typeof p.preset === 'string' ? p.preset : '?';
      return `"${preset}"`;
    }
    case 'CALLSIGN_SHOUT':
      return '—';
  }
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `vor ${days} ${days === 1 ? 'tag' : 'tagen'}`;
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default async function ChannelPointsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  // Connection-gate. Without a verified twitchUserId, no webhook
  // would ever match this user — the page would be theoretical.
  // Redirect back to the hub where the "Connect Twitch" CTA lives.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twitchUserId: true, twitchUsername: true },
  });
  if (!user?.twitchUserId) {
    redirect('/settings/twitch');
  }

  // Configured mappings — load all (most users will have <10).
  const rewards = await prisma.channelPointReward.findMany({
    where: { userId },
    orderBy: [{ isEnabled: 'desc' }, { createdAt: 'desc' }],
  });

  // Last 20 redemptions across ALL mappings — orderBy createdAt desc.
  // Includes orphaned ones (rewardId is null after delete) — those
  // still belong to this user and are useful for audit.
  const recentRedemptions = await prisma.channelPointRedemption.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 border-b border-border pb-4">
          <Link
            href="/settings/twitch"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Twitch Streaming Hub
          </Link>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
            🎁 Channel-Points → Events
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verknüpfe deine Twitch channel-point rewards mit in-flight
            actions. Viewer redeemen, der VAM-bot leitet das event hier
            durch, und je nach mapping wird ein wallet-credit, discord-
            shout oder in-flight-note ausgelöst.
          </p>
          {user.twitchUsername && (
            <p className="mt-2 text-xs text-muted-foreground">
              Verknüpft mit{' '}
              <span className="font-mono font-semibold text-purple-700 dark:text-purple-400">
                @{user.twitchUsername}
              </span>
            </p>
          )}
        </header>

        {/* Add-form */}
        <section className="mb-6">
          <AddRewardForm />
        </section>

        {/* Configured mappings */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Konfigurierte mappings ({rewards.length})
          </h2>
          {rewards.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
              Noch keine mappings angelegt. Nutze das formular oben um
              dein erstes anzulegen.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Reward-Titel</th>
                    <th className="px-3 py-2 text-left">Config</th>
                    <th className="px-3 py-2 text-left">Reward-ID</th>
                    <th className="px-3 py-2 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rewards.map((r) => {
                    const display = ACTION_DISPLAY[r.actionType];
                    return (
                      <tr
                        key={r.id}
                        className={r.isEnabled ? '' : 'opacity-50'}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium">
                            {display.emoji} {display.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">{r.rewardTitle}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {formatPayloadSummary(r.actionType, r.payloadJson)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          <span title={r.twitchRewardId}>
                            {r.twitchRewardId.length > 12
                              ? `${r.twitchRewardId.slice(0, 8)}…`
                              : r.twitchRewardId}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <RewardRowActions
                            rewardId={r.id}
                            isEnabled={r.isEnabled}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent redemptions */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Letzte redemptions
            {recentRedemptions.length > 0 && ` (${recentRedemptions.length})`}
          </h2>
          {recentRedemptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
              Noch keine redemptions empfangen. Sobald der VAM-bot
              EventSub-events forwarded landen sie hier.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Zeit</th>
                    <th className="px-3 py-2 text-left">Viewer</th>
                    <th className="px-3 py-2 text-left">Reward</th>
                    <th className="px-3 py-2 text-left">Notiz</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentRedemptions.map((red) => {
                    const style = STATUS_STYLE[red.status];
                    return (
                      <tr key={red.id}>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}
                            title={red.errorMessage ?? undefined}
                          >
                            {style.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatRelativeTime(red.createdAt)}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          @{red.redeemerUsername}
                        </td>
                        <td className="px-3 py-2">
                          {red.rewardTitleSnapshot}
                        </td>
                        <td className="px-3 py-2 max-w-xs truncate text-xs text-muted-foreground">
                          {red.status === 'FAILED' && red.errorMessage
                            ? red.errorMessage
                            : red.redeemerUserInput || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Footer-hint */}
        <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="font-semibold uppercase tracking-wider">
            Wie funktioniert das?
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Im Twitch-creator-dashboard erstellst du eine custom
              channel-point reward. Notiere dir die reward-ID (URL-segment
              beim öffnen).
            </li>
            <li>
              Hier legst du ein mapping an: reward-ID + action-typ +
              payload-config.
            </li>
            <li>
              Wenn ein viewer die reward redeemt, leitet der VAM-bot
              das event an <code className="rounded bg-muted/40 px-1">POST /api/twitch/redemption</code>{' '}
              weiter (shared-secret auth via{' '}
              <code className="rounded bg-muted/40 px-1">TWITCH_BOT_WEBHOOK_SECRET</code>).
            </li>
            <li>
              Der server matched die reward-ID, executiert die action,
              und loggt das ergebnis in der redemptions-tabelle oben.
            </li>
            <li>
              Idempotenz via Twitch-redemption-UUID — duplicate
              deliveries werden ignoriert und die ursprüngliche outcome
              wird zurückgegeben.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
