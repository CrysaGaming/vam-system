import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma, substituteThumbnailDimensions } from '@vam/db';
import { DisconnectButton } from './_disconnect';

/**
 * Welle O / O1 — Twitch streaming hub.
 *
 * Route: /settings/twitch
 *
 * Schwester-page zu /settings/embeds und /settings/garmin. Sammelt
 * alle streaming-specific surfaces, die der pilot über sein
 * verknüpftes Twitch-konto hat, an einer stelle:
 *
 *   1. Connection-status (verbunden seit, username mit deeplink)
 *   2. Aktueller live-state (live-now? title/game/online-seit, oder
 *      "zuletzt live: <date>")
 *   3. STREAM_REWARD activity-log (letzte 10 transactions die aus
 *      stream-aktivität stammen — REVENUE_STREAM_REWARD type ODER
 *      category-prefix "twitch-")
 *   4. Foundation/preview-blocks für O2-O5: live-stream-embed
 *      (Welle O O2), overlay v2 (O3), channel-points-mapping (O4),
 *      auto-clip (O5)
 *
 * # Verhältnis zu /settings (overview)
 *
 * Die /settings-overview-page hat schon eine ConnectionCard für
 * Twitch (alongside Discord/VATSIM/IVAO). Diese page ist die
 * **deeper hub** — die overview reicht für "verbinde mein konto",
 * diese page für "was kriege ich daraus und was kommt noch".
 *
 * # Welche schema-felder werden gelesen
 *
 *   user.twitchUserId / twitchUsername / twitchVerifiedAt   (Welle 11)
 *   user.twitchIsLive / twitchStreamTitle / twitchStreamGameName  (Welle 14A)
 *   user.twitchStreamThumbnailUrl / twitchLastWentLiveAt    (Welle 14A)
 *   Transaction WHERE walletOwner=this-user AND
 *     (type=REVENUE_STREAM_REWARD OR category LIKE 'twitch-%')   (Welle 14F)
 *
 * # Nicht enthalten
 *
 * Token-renewal-UI, scope-editor, OAuth-rotation. Diese sind
 * implementation-details die im Welle-11-OAuth-flow laufen; der
 * pilot muss nichts davon sehen.
 */
export const dynamic = 'force-dynamic';

const PREVIEW_TARGET_SIZE = { width: 320, height: 180 };

export default async function TwitchSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twitchUserId: true,
      twitchUsername: true,
      twitchVerifiedAt: true,
      twitchIsLive: true,
      twitchStreamTitle: true,
      twitchStreamGameName: true,
      twitchStreamThumbnailUrl: true,
      twitchLastWentLiveAt: true,
    },
  });

  if (!user) redirect('/');

  const connected = !!user.twitchUserId;

  // STREAM_REWARD activity. Falls connected: hol die letzten 10
  // wallet-transactions für diesen user die entweder typ-tagged
  // REVENUE_STREAM_REWARD sind ODER eine "twitch-*" category haben.
  // category-prefix-match ist die belt-and-suspenders defense: der
  // primary signal ist der enum-typ aber legacy-rows könnten den
  // generic-typ nutzen mit category als source-discriminator.
  const recentRewards = connected
    ? await prisma.transaction.findMany({
        where: {
          wallet: {
            ownerType: 'USER',
            ownerUserId: userId,
          },
          OR: [
            { type: 'REVENUE_STREAM_REWARD' },
            { category: { startsWith: 'twitch-' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          amount: true,
          category: true,
          description: true,
          createdAt: true,
        },
      })
    : [];

  // Welle O / O5 — Auto-clips. Last 5 rows for the streamer; only
  // fetched when connected (without a twitchUserId no clips could
  // have been created). Sorted desc so the freshest landing tops.
  const recentClips = connected
    ? await prisma.twitchClip.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          twitchClipId: true,
          editUrl: true,
          trigger: true,
          pirepId: true,
          createdAt: true,
        },
      })
    : [];

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Settings · Streaming
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            📺 Twitch Streaming Hub
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alle streaming-features deines Twitch-accounts an einem
            ort. Verbinde dein konto im{' '}
            <Link
              href="/settings"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Settings-Überblick
            </Link>{' '}
            wenn du noch nicht verknüpft bist.
          </p>
        </header>

        {/* Connection-status block */}
        <section className="mb-6 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Verbindung
          </h2>
          {connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold">
                  <a
                    href={`https://twitch.tv/${user.twitchUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-700 hover:underline dark:text-purple-300"
                  >
                    twitch.tv/{user.twitchUsername}
                  </a>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Verbunden seit{' '}
                  {user.twitchVerifiedAt
                    ? user.twitchVerifiedAt.toLocaleDateString('de-DE', {
                        dateStyle: 'long',
                      })
                    : '—'}
                </p>
              </div>
              <DisconnectButton username={user.twitchUsername ?? ''} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Noch kein Twitch-account verknüpft. Verbinde dein konto,
                damit live-streams im header-counter + den
                airline-feeds erscheinen und du STREAM_REWARDs aus
                channel-aktivität bekommen kannst.
              </p>
              <Link
                href="/api/auth/twitch/start"
                className="shrink-0 rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
              >
                Verbinden
              </Link>
            </div>
          )}
        </section>

        {/* Live-state block (only when connected) */}
        {connected && (
          <section className="mb-6 rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Aktueller Status
            </h2>
            {user.twitchIsLive ? (
              <div className="flex flex-wrap items-start gap-4">
                {(() => {
                  // substituteThumbnailDimensions returns string | null;
                  // we already check twitchStreamThumbnailUrl below, but TS
                  // can't carry that narrowing through the helper-call.
                  // Compute once and gate the <img> on the resolved value.
                  const thumbSrc = user.twitchStreamThumbnailUrl
                    ? substituteThumbnailDimensions(
                        user.twitchStreamThumbnailUrl,
                        PREVIEW_TARGET_SIZE.width,
                        PREVIEW_TARGET_SIZE.height,
                      )
                    : null;
                  if (!thumbSrc) return null;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbSrc}
                      alt="Stream-Vorschau"
                      width={PREVIEW_TARGET_SIZE.width}
                      height={PREVIEW_TARGET_SIZE.height}
                      className="rounded-md border border-border"
                    />
                  );
                })()}
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-red-600/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-600 dark:bg-red-500" />
                      Live
                    </span>
                    {user.twitchLastWentLiveAt && (
                      <span className="text-xs text-muted-foreground">
                        seit{' '}
                        {user.twitchLastWentLiveAt.toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    )}
                  </div>
                  {user.twitchStreamTitle && (
                    <p className="text-base font-semibold leading-snug">
                      {user.twitchStreamTitle}
                    </p>
                  )}
                  {user.twitchStreamGameName && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      🎮 {user.twitchStreamGameName}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>Offline.</p>
                {user.twitchLastWentLiveAt && (
                  <p className="mt-1 text-xs">
                    Zuletzt live:{' '}
                    {user.twitchLastWentLiveAt.toLocaleString('de-DE', {
                      dateStyle: 'long',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* STREAM_REWARD activity */}
        {connected && (
          <section className="mb-6 rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Letzte Stream-Rewards
            </h2>
            {recentRewards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine rewards. Subs, bits, raid-callouts und
                hype-train-events landen hier sobald der Twitch-bot
                aktiviert ist (Welle 14F).
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Datum</th>
                      <th className="px-3 py-2 text-left">Kategorie</th>
                      <th className="px-3 py-2 text-left">Beschreibung</th>
                      <th className="px-3 py-2 text-right">VAM$</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentRewards.map((r) => {
                      const amount = parseFloat(r.amount.toString());
                      return (
                        <tr key={r.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {r.createdAt.toLocaleDateString('de-DE')}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.category}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {r.description}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            <span
                              className={
                                amount > 0
                                  ? 'text-green-700 dark:text-green-400'
                                  : 'text-red-700 dark:text-red-400'
                              }
                            >
                              {amount > 0 ? '+' : ''}
                              {amount.toLocaleString('de-DE', {
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Welle O / O5 — Auto-Clips. Surfaces what the server captured
            for the streamer over the last few flights. Each row deep-
            links to Twitch's edit-page (the only way to reach the
            untrimmed clip), with trigger-badge color-coded by event:
            butter (emerald = celebrate), hard (rose = "ouch"), award/
            milestone (indigo = future-reserved, not wired in MVP). */}
        {connected && (
          <section className="mb-6 rounded-lg border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Letzte Auto-Clips
              </h2>
              <span className="rounded-sm bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Welle O · O5
              </span>
            </div>
            {recentClips.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine auto-clips. Fliege eine butter-landing
                (≥ -100 fpm) oder hard-landing (≤ -800 fpm) während
                du live auf Twitch bist — der server clipt automatisch
                den moment und du findest hier den edit-link.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentClips.map((clip) => {
                  // Trigger-display: badge-color + emoji + label.
                  // Inlined per-row rather than extracted to a const-map
                  // because we'd need to import the enum-type just to
                  // index it — for 4 cases an inline switch reads cleaner.
                  const badge = (() => {
                    switch (clip.trigger) {
                      case 'BUTTER_LANDING':
                        return {
                          emoji: '🧈',
                          label: 'Butter Landing',
                          bg: 'bg-emerald-100 dark:bg-emerald-900/40',
                          text: 'text-emerald-800 dark:text-emerald-200',
                        };
                      case 'HARD_LANDING':
                        return {
                          emoji: '💥',
                          label: 'Hard Landing',
                          bg: 'bg-rose-100 dark:bg-rose-900/40',
                          text: 'text-rose-800 dark:text-rose-200',
                        };
                      case 'AWARD_GRANTED':
                        return {
                          emoji: '🏆',
                          label: 'Award',
                          bg: 'bg-indigo-100 dark:bg-indigo-900/40',
                          text: 'text-indigo-800 dark:text-indigo-200',
                        };
                      case 'MILESTONE_REACHED':
                        return {
                          emoji: '🎯',
                          label: 'Milestone',
                          bg: 'bg-indigo-100 dark:bg-indigo-900/40',
                          text: 'text-indigo-800 dark:text-indigo-200',
                        };
                    }
                  })();
                  return (
                    <li
                      key={clip.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${badge.bg} ${badge.text}`}
                        >
                          <span aria-hidden="true">{badge.emoji}</span>
                          {badge.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {clip.createdAt.toLocaleString('de-DE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </span>
                        {clip.pirepId && (
                          <Link
                            href={`/pireps/${clip.pirepId}`}
                            className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            PIREP →
                          </Link>
                        )}
                      </div>
                      <a
                        href={clip.editUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md bg-purple-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-purple-700"
                      >
                        ✂️ Auf Twitch bearbeiten
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Hinweis: Auto-Clips brauchen den{' '}
              <code className="rounded bg-muted/40 px-1">clips:edit</code>
              -scope. Falls du dich vor O5 verknüpft hast und keine
              clips erscheinen obwohl du live geflogen bist, einmal
              kurz disconnecten und neu verbinden — dann wird der scope
              mit eingespielt.
            </p>
          </section>
        )}

        {/* Coming soon: O2-O5 preview cards */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Was noch kommt
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComingSoonCard
              icon="🖼️"
              title="Live-Stream-Embed im Profil"
              welleRef="Welle O · O2"
              description="Eingebetteter Twitch-Player auf deiner pilot-profile-page, sichtbar wenn du live bist."
            />
            <ComingSoonCard
              icon="🎬"
              title="Stream-Overlay v2"
              welleRef="Welle O · O3"
              description="Erweiterte /overlay/[token]-route mit live-PIREP-progress, fuel/wind, milestones-popup."
            />
            {/* Welle O O4 shipped — replaced the ComingSoonCard with an
                active link to /settings/twitch/channel-points. The card
                styling matches the surrounding "coming soon" tiles
                visually (same border + padding), but the chevron-arrow
                signals "go here now" instead of "wait". */}
            <Link
              href="/settings/twitch/channel-points"
              className="group flex flex-col gap-1 rounded-lg border border-indigo-400/40 bg-indigo-50/50 p-3 text-left transition hover:border-indigo-500 hover:bg-indigo-50 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">🎁</span>
                  <span className="text-sm font-semibold">
                    Channel-Points → Events
                  </span>
                </div>
                <span className="text-xs text-indigo-700 transition group-hover:translate-x-0.5 dark:text-indigo-400">
                  →
                </span>
              </div>
              <p className="text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
                Welle O · O4 · Aktiv
              </p>
              <p className="text-xs text-muted-foreground">
                Map deine Twitch channel-point rewards auf in-flight
                actions (fuel-bonus, shout-out, gate-request).
              </p>
            </Link>
            {/* Welle O O5 shipped — the "Letzte Auto-Clips" section
                above is the active UI; we drop the preview card here
                so the page doesn't advertise a feature as upcoming
                that's already running. O2/O3 cards stay because
                their features are implicit (auto-applied on profile/
                overlay) without a dedicated nav entry — different
                situation from O4/O5 which have their own surfaces. */}
          </div>
        </section>

        {/* Footer-hint */}
        <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="font-semibold uppercase tracking-wider">
            Wie funktioniert das?
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Twitch-OAuth via{' '}
              <code className="rounded bg-muted/40 px-1">
                /api/auth/twitch/start
              </code>{' '}
              (Welle 11) verknüpft dein konto.
            </li>
            <li>
              EventSub im VAM-bot (separate apps/bot service)
              empfängt stream.online/offline events und schreibt sie in
              die DB (Welle 14A).
            </li>
            <li>
              Subs/bits/raids triggern REVENUE_STREAM_REWARD
              transactions in deinem wallet (Welle 14F).
            </li>
            <li>
              Disconnect revoked den access-token bei Twitch und
              cleart deine OAuth-felder lokal.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function ComingSoonCard({
  icon,
  title,
  welleRef,
  description,
}: {
  icon: string;
  title: string;
  welleRef: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-4 opacity-80">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-2xl">{icon}</span>
        <span className="rounded-sm bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {welleRef}
        </span>
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
