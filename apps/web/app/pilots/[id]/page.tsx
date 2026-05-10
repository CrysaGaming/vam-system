import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma, substituteThumbnailDimensions, getUserAwards, getUserEvents } from '@vam/db';
import Link from 'next/link';
import { AwardBadge } from '../../awards/award-badge';

export default async function PilotProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const { id } = await params;

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true, role: { select: { name: true } } },
  });

  if (!currentUser?.airlineId) {
    redirect('/dashboard');
  }

  const pilot = await prisma.user.findUnique({
    where: { id },
    include: {
      rank: true,
      role: true,
      airline: true,
    },
  });

  if (!pilot) {
    notFound();
  }

  // Authorization: piloten der eigenen Airline sind für jeden member
  // sichtbar. System-admins dürfen ZUSÄTZLICH user anderer airlines
  // (oder ohne airline) sehen — sonst wäre der link aus /admin/pilots
  // (cross-airline übersicht) für admins kaputt. Andere rollen kriegen
  // weiter den redirect zur airline-scoped pilots-liste.
  const isAdmin = currentUser.role?.name === 'admin';
  const sameAirline = pilot.airlineId === currentUser.airlineId;

  if (!isAdmin && !sameAirline) {
    redirect('/pilots');
  }

  const isMe = pilot.id === currentUser.id;

  // Welle 4: Position-tracking-context für den profile-header. Zwei
  // unabhängige optional airport-lookups — wir wollen für die UI nicht
  // nur ICAO sondern auch name + city. baseIcao und currentLocationIcao
  // sind beide nullable strings auf User; wenn null, kein lookup nötig.
  // findUnique returnt null wenn airport gelöscht/nicht im catalog —
  // dann zeigen wir nur den ICAO-string als fallback.
  const [baseAirport, currentLocationAirport] = await Promise.all([
    pilot.baseIcao
      ? prisma.airport.findUnique({
          where: { icao: pilot.baseIcao },
          select: { icao: true, name: true, city: true, country: true },
        })
      : Promise.resolve(null),
    pilot.currentLocationIcao
      ? prisma.airport.findUnique({
          where: { icao: pilot.currentLocationIcao },
          select: { icao: true, name: true, city: true, country: true },
        })
      : Promise.resolve(null),
  ]);

  const positionMatchesBase =
    pilot.currentLocationIcao !== null &&
    pilot.baseIcao !== null &&
    pilot.currentLocationIcao === pilot.baseIcao;

  // Letzte 5 PIREPs
  const recentPireps = await prisma.pirep.findMany({
    where: { userId: pilot.id, status: 'Approved' },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
    },
    orderBy: { submittedAt: 'desc' },
    take: 5,
  });

  // Top-3 meistgeflogene Routen
  const routeCounts = await prisma.pirep.groupBy({
    by: ['routeId'],
    where: {
      userId: pilot.id,
      status: 'Approved',
      routeId: { not: null },
    },
    _count: { routeId: true },
    orderBy: { _count: { routeId: 'desc' } },
    take: 3,
  });

  const topRoutes = await Promise.all(
    routeCounts.map(async (rc) => {
      if (!rc.routeId) return null;
      const route = await prisma.route.findUnique({
        where: { id: rc.routeId },
        include: { departure: true, arrival: true },
      });
      if (!route) return null;
      return { route, count: rc._count.routeId };
    })
  );

  const topRoutesValid = topRoutes.filter((r): r is NonNullable<typeof r> => r !== null);

  // Track 1 #1: Awards des pilots laden. Sortiert nach awardedAt desc
  // (neueste zuerst). Bei zero awards rendern wir die section gar nicht
  // — keine "noch keine awards"-leerstelle auf fremden profilen, das
  // wäre unnötig negativ. Auf eigenem profil zeigen wir die empty-section
  // mit CTA zu /awards.
  const userAwards = await getUserAwards(pilot.id);

  // Track 1 #7: Events des pilots laden (alle teilnahmen, sortiert nach
  // event.startsAt desc). Selbe display-strategie wie awards: auf eigenem
  // profil immer sichtbar (mit empty-CTA zu /events), auf fremden
  // profilen nur wenn der user mindestens ein event hat.
  const userEvents = await getUserEvents(pilot.id);

  // === Track 4 #55 (Section K): Stats-Hero — landing-rate aggregates ===
  //
  // Wir holen avg + best landing-rate aus den approved PIREPs. landingRateFpm
  // ist NEGATIV (touchdown = sink-rate), also "best landing" = MAX (= am
  // nächsten an 0 = sanftester touchdown). Typische werte:
  //   -50 fpm   → butter-landing
  //   -100..-200 → smooth
  //   -200..-500 → normal
  //   -500..-800 → firm
  //   < -800    → hard landing (oft mit ACARS-flag)
  //
  // Nur PIREPs mit gesetztem landingRateFpm zählen — ältere/manual PIREPs
  // ohne ACARS-data haben das feld null und sollen den durchschnitt nicht
  // verfälschen. Prisma aggregate ignoriert nulls automatisch.
  const landingStats = await prisma.pirep.aggregate({
    where: {
      userId: pilot.id,
      status: 'Approved',
      landingRateFpm: { not: null },
    },
    _avg: { landingRateFpm: true },
    _max: { landingRateFpm: true }, // max = closest to 0 = best (siehe oben)
    _count: { landingRateFpm: true },
  });

  const avgLandingFpm = landingStats._avg.landingRateFpm;
  const bestLandingFpm = landingStats._max.landingRateFpm;
  const landingSampleCount = landingStats._count.landingRateFpm;

  // Beitrittsdauer
  const joinedDays = Math.floor(
    (Date.now() - new Date(pilot.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Track 4 #43 (Section H): Stream-revenue-aggregation für die Twitch-card.
  // Nur laden wenn pilot Twitch verbunden hat — sonst überflüssige queries.
  // Wallet-tx mit type IN ('REVENUE_TICKET_TWITCH', 'REVENUE_STREAM_REWARD')
  // sind die einzigen "stream-bezogenen" einnahmen. Lifetime + 30d separat
  // damit instructor-side ein "kürzlich aktiv vs total karriere"-bild
  // entsteht. Wallet hat ownerType=USER + ownerUserId=pilot.id + walletType=
  // primary; pilot kann theoretisch noch keine wallet haben (legacy users
  // vor wallet-rollout) — dann sind beide werte 0.
  let twitchRevenueLifetime = 0;
  let twitchRevenueRecent30 = 0;
  if (pilot.twitchUserId) {
    const wallet = await prisma.wallet.findFirst({
      where: {
        ownerType: 'USER',
        ownerUserId: pilot.id,
        walletType: 'primary',
      },
      select: { id: true },
    });
    if (wallet) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [allTime, recent] = await Promise.all([
        prisma.transaction.aggregate({
          where: {
            walletId: wallet.id,
            type: { in: ['REVENUE_TICKET_TWITCH', 'REVENUE_STREAM_REWARD'] },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            walletId: wallet.id,
            type: { in: ['REVENUE_TICKET_TWITCH', 'REVENUE_STREAM_REWARD'] },
            createdAt: { gte: thirtyDaysAgo },
          },
          _sum: { amount: true },
        }),
      ]);
      // Decimal → number for display. Beträge sind klein (max ~5-stellig)
      // also kein precision-loss-risiko.
      twitchRevenueLifetime = allTime._sum.amount?.toNumber() ?? 0;
      twitchRevenueRecent30 = recent._sum.amount?.toNumber() ?? 0;
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <Link
            href="/pilots"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Alle Piloten
          </Link>
          {isMe && (
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              Mein Dashboard →
            </Link>
          )}
        </header>

        {/* Profile-Header */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 mb-8">
          <div className="flex items-center gap-6">
            {pilot.image ? (
              <img
                src={pilot.image}
                alt={pilot.name ?? 'Avatar'}
                className="w-24 h-24 rounded-full border-2 border-gray-300 dark:border-gray-700"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gray-200 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-700" />
            )}
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3 flex-wrap">
                {pilot.name ?? 'Unbenannt'}
                {isMe && (
                  <span
                    style={{ backgroundColor: '#6366f1' }}
                    className="px-2 py-0.5 rounded text-xs font-semibold text-white"
                  >
                    Du
                  </span>
                )}
                {/* Welle 14C: Inline live-badge im h1. Klein aber auffällig
                    (animate-pulse + red), immer sichtbar wenn pilot grade
                    streamt. Verlinkt auf twitch.tv/{username} im neuen tab.
                    Größere card-section weiter unten zeigt details (title,
                    game, thumbnail, "watch on twitch"-button). Kondition
                    twitchIsLive UND twitchUsername — falls username nie
                    gesynct wurde (seltener edge-case), ist der link nicht
                    konstruierbar und wir skippen. */}
                {pilot.twitchIsLive && pilot.twitchUsername && (
                  <a
                    href={`https://twitch.tv/${pilot.twitchUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition"
                    aria-label={`${pilot.name ?? 'Pilot'} streamt grade live auf Twitch`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-white animate-pulse"
                      aria-hidden="true"
                    />
                    LIVE
                  </a>
                )}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                {pilot.rank?.name ?? 'Kein Rang'} · {pilot.role?.name ?? 'pilot'}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {pilot.airline?.name} · Mitglied seit{' '}
                {new Date(pilot.createdAt).toLocaleDateString('de-DE', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}{' '}
                ({joinedDays} {joinedDays === 1 ? 'Tag' : 'Tage'})
              </p>
            </div>
          </div>
        </section>

        {/* Welle 14C: Live-Stream-Card. Sichtbar nur wenn pilot.twitchIsLive
            UND pilot.twitchUsername gesetzt sind. Zeigt thumbnail (320x180-
            template-substituiert), title, game, "online seit"-zeitstempel
            und prominenten "Watch on Twitch"-button.

            Position: zwischen profile-header und position-section, weil
            der live-status JETZT-aktuell ist und top-of-page-priorität
            verdient. Andere users (nicht-isMe-view) sollen sofort sehen
            "ah, der streamt grade — schauen wir mal rein".

            Thumbnail-fallback: wenn twitch keine thumbnail-URL gesendet
            hat (rare aber möglich beim ersten go-live), rendern wir nur
            das text-block ohne image. substituteThumbnailDimensions
            returnt null bei fehlender URL und wir konditionalisieren
            auf das ergebnis.

            "Online seit"-anzeige: nutzt twitchLastWentLiveAt (gesetzt vom
            14B-handler). Format: "vor X min" oder "seit HH:MM" je nach
            länge — Date.now() vs lastWentLiveAt.getTime() differenz. */}
        {pilot.twitchIsLive && pilot.twitchUsername && (
          <section className="bg-gradient-to-br from-red-50 to-purple-50 dark:from-red-950/20 dark:to-purple-950/20 border border-red-500/30 rounded-lg p-6 mb-8">
            <div className="flex items-start gap-6 flex-wrap md:flex-nowrap">
              {(() => {
                const thumb = substituteThumbnailDimensions(
                  pilot.twitchStreamThumbnailUrl,
                  320,
                  180,
                );
                return thumb ? (
                  <a
                    href={`https://twitch.tv/${pilot.twitchUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 block w-full md:w-80 rounded overflow-hidden border border-red-500/30 hover:border-red-500 transition relative"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- twitch CDN URL, bewusst kein next/image */}
                    <picture>
                      <img
                        src={thumb}
                        alt={`Live-thumbnail von ${pilot.name ?? pilot.twitchUsername}`}
                        className="w-full aspect-video object-cover"
                      />
                    </picture>
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-600 text-white text-xs font-semibold">
                      <span
                        className="inline-block w-2 h-2 rounded-full bg-white animate-pulse"
                        aria-hidden="true"
                      />
                      LIVE
                    </span>
                  </a>
                ) : null;
              })()}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs uppercase tracking-wider text-red-600 dark:text-red-400 font-semibold">
                    🔴 Streamt grade live
                  </span>
                  {pilot.twitchLastWentLiveAt && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      ·{' '}
                      {(() => {
                        const liveSinceMs =
                          Date.now() -
                          new Date(pilot.twitchLastWentLiveAt).getTime();
                        const liveSinceMin = Math.floor(liveSinceMs / 60_000);
                        if (liveSinceMin < 60) {
                          return `seit ${liveSinceMin} min`;
                        }
                        const hours = Math.floor(liveSinceMin / 60);
                        const mins = liveSinceMin % 60;
                        return `seit ${hours}h ${mins}min`;
                      })()}
                    </span>
                  )}
                </div>

                {pilot.twitchStreamTitle && (
                  <h2 className="text-lg font-semibold mb-2 line-clamp-2">
                    {pilot.twitchStreamTitle}
                  </h2>
                )}

                {pilot.twitchStreamGameName && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Spielt:{' '}
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {pilot.twitchStreamGameName}
                    </span>
                  </p>
                )}

                <a
                  href={`https://twitch.tv/${pilot.twitchUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                  </svg>
                  Watch on Twitch
                </a>

                {/* Track 4 #43 (Section H): Stream-revenue inline in der live-
                    card — wenn der pilot grade live ist, ist es sehr passend
                    zu sehen wieviel er bisher durch streaming verdient hat.
                    Lifetime + 30d-trend in einem zwei-zeiler. Nur rendern
                    wenn überhaupt revenue da ist (sonst irrelevante 0-zeile). */}
                {twitchRevenueLifetime > 0 && (
                  <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                    💰 Stream-Revenue:{' '}
                    <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">
                      VAM${twitchRevenueLifetime.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
                    </span>
                    {twitchRevenueRecent30 > 0 && (
                      <span className="text-gray-500 dark:text-gray-500">
                        {' '}
                        · 30d:{' '}
                        <span className="font-mono">
                          VAM${twitchRevenueRecent30.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
                        </span>
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Track 4 #43 (Section H): Offline Twitch-card. Sichtbar wenn pilot
            Twitch verbunden hat (twitchUserId gesetzt) aber NICHT grade live.
            Kompakter als die live-card — kein thumbnail/title/game weil's
            keine current-stream-info gibt, sondern nur "wer er ist auf
            Twitch" + "wann zuletzt live" + revenue-stats wenn vorhanden.
            Position: gleich nach der live-card-condition (mutually exclusive
            wegen !twitchIsLive). */}
        {pilot.twitchUserId && pilot.twitchUsername && !pilot.twitchIsLive && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 mb-8">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="shrink-0 w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center">
                  <span className="text-lg" aria-hidden="true">📺</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                    <span className="text-purple-700 dark:text-purple-400">
                      Twitch
                    </span>
                    <span className="font-mono text-gray-700 dark:text-gray-300">
                      @{pilot.twitchUsername}
                    </span>
                    {pilot.twitchVerifiedAt && (
                      <span
                        className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold"
                        title="Twitch-Account verifiziert"
                      >
                        ✓ verifiziert
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                    {pilot.twitchLastWentLiveAt ? (
                      <>
                        Zuletzt live:{' '}
                        {(() => {
                          const days = Math.floor(
                            (Date.now() -
                              new Date(pilot.twitchLastWentLiveAt).getTime()) /
                              (1000 * 60 * 60 * 24),
                          );
                          if (days === 0) return 'heute';
                          if (days === 1) return 'gestern';
                          if (days < 7) return `vor ${days} Tagen`;
                          if (days < 30) {
                            const weeks = Math.floor(days / 7);
                            return `vor ${weeks} Woche${weeks === 1 ? '' : 'n'}`;
                          }
                          if (days < 365) {
                            const months = Math.floor(days / 30);
                            return `vor ${months} Monat${months === 1 ? '' : 'en'}`;
                          }
                          return new Date(
                            pilot.twitchLastWentLiveAt,
                          ).toLocaleDateString('de-DE');
                        })()}
                      </>
                    ) : (
                      'Noch nicht live gewesen'
                    )}
                    {twitchRevenueLifetime > 0 && (
                      <>
                        {' · '}💰 VAM$
                        {twitchRevenueLifetime.toLocaleString('de-DE', {
                          maximumFractionDigits: 0,
                        })}
                        {twitchRevenueRecent30 > 0 && (
                          <span className="text-gray-400">
                            {' '}(30d: {twitchRevenueRecent30.toLocaleString('de-DE', { maximumFractionDigits: 0 })})
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <a
                href={`https://twitch.tv/${pilot.twitchUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-medium transition"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                </svg>
                Profil ansehen
              </a>
            </div>
          </section>
        )}

        {/* Position-section (Welle 4). Zeigt base + current-location für
            den pilot. Nur sichtbar wenn pilot eine airline hat. Wenn beide
            felder null (neuer pilot vor erstem flug), rendert "Position
            unbekannt"-card statt nichts — bewusst, damit der section-spot
            in der profile-hierarchie konsistent erscheint und der user
            sieht "ah, hier kommt mein status mal hin". Für sich selbst
            (isMe) zeigen wir zusätzlich einen jumpseat-CTA wenn
            current ≠ base und beide gesetzt sind. */}
        {pilot.airline && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <div className="flex flex-wrap justify-between items-start gap-4">
              <div>
                <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">
                  Position
                </h2>
                {pilot.currentLocationIcao ? (
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-3xl" aria-hidden="true">📍</span>
                    <div>
                      <p className="text-2xl font-bold font-mono leading-tight">
                        {pilot.currentLocationIcao}
                        {positionMatchesBase && (
                          <span className="text-sm font-normal font-sans text-indigo-600 dark:text-indigo-400 ml-2">
                            (Base)
                          </span>
                        )}
                      </p>
                      {currentLocationAirport && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {currentLocationAirport.name}
                          {currentLocationAirport.city &&
                            ` · ${currentLocationAirport.city}, ${currentLocationAirport.country}`}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-500 italic">
                    Position unbekannt — noch kein Flug eingereicht
                  </p>
                )}

                {/* Base-zeile NUR rendern wenn:
                    - base gesetzt UND
                    - (current ≠ base ODER current null)
                    Wenn current = base, ist die info schon im "(Base)"-suffix
                    drüber enthalten — dann wäre eine zweite zeile redundant. */}
                {pilot.baseIcao && !positionMatchesBase && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
                    Base:{' '}
                    <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
                      {pilot.baseIcao}
                    </span>
                    {baseAirport && (
                      <span className="ml-2">
                        ({baseAirport.name}
                        {baseAirport.city && `, ${baseAirport.city}`})
                      </span>
                    )}
                  </p>
                )}
                {!pilot.baseIcao && (
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-3 italic">
                    Kein Hub als Base zugewiesen
                  </p>
                )}
              </div>

              {/* Jumpseat-CTA — nur für eigenes profil + wenn current ≠ base.
                  Visuell rechts neben dem position-display, fällt auf neuer
                  zeile bei narrow viewports (flex-wrap am parent). Punktiert
                  zur künftigen /jumpseat-page (kommt in commit 3c). */}
              {isMe &&
                pilot.currentLocationIcao &&
                pilot.baseIcao &&
                !positionMatchesBase && (
                  <Link
                    href="/jumpseat"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition shrink-0"
                  >
                    Jumpseat zurück zur Base
                  </Link>
                )}
            </div>
          </section>
        )}

        {/* === Track 4 #55 (Section K): Stats-Hero ===

            Vorher: 3-spaltiges grid mit Flugstunden / Flüge / Aktueller-Rang.
            Rang-info ist schon im profile-header oben (unter dem namen),
            also redundant hier.

            Jetzt: 4-spaltiger hero mit den core-pilot-KPIs:
              1. Flight Hours (lifetime)
              2. Flights (count)
              3. Avg Landing-Rate (smoothness-indikator)
              4. Best Landing-Rate (butter-flex)

            Landing-cells nur volle inhalte zeigen wenn sample-count > 0 —
            sonst "—" placeholder mit hint. Farbcoding der avg-rate folgt
            aviation-konvention:
              -100..0   → emerald (smooth/butter)
              -200..-100 → indigo (good)
              -500..-200 → amber (acceptable)
              < -500    → rose (firm/hard)

            Hero-styling: subtle gradient-background + leicht erhöhter
            contrast vs plain card. Md+ grid 4-cols, mobile 2x2. */}
        <section
          aria-label="Pilot-Statistiken"
          className="relative bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-indigo-950/30 dark:via-gray-900 dark:to-emerald-950/30 border border-indigo-200 dark:border-indigo-800/50 rounded-lg p-6 mb-8 overflow-hidden"
        >
          {/* Subtler indigo glow im hintergrund — rein dekorativ, hilft
              dem hero sich vom rest der page abzuheben. pointer-events:none
              damit es nicht mit klicks interferiert. */}
          <div
            aria-hidden="true"
            className="absolute -top-12 -right-12 w-48 h-48 bg-indigo-400/10 dark:bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"
          />

          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Flugstunden — lifetime cum */}
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-widest text-indigo-700 dark:text-indigo-400 font-semibold mb-2">
                Flugstunden
              </p>
              <p className="text-3xl md:text-4xl font-bold tabular-nums">
                {pilot.totalFlightHours.toFixed(1)}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                h lifetime
              </p>
            </div>

            {/* Flüge — count of approved PIREPs */}
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-widest text-indigo-700 dark:text-indigo-400 font-semibold mb-2">
                Flüge
              </p>
              <p className="text-3xl md:text-4xl font-bold tabular-nums">
                {pilot.totalFlights}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                PIREPs eingereicht
              </p>
            </div>

            {/* Avg Landing-Rate — smoothness-trend */}
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-widest text-indigo-700 dark:text-indigo-400 font-semibold mb-2">
                Ø Landing
              </p>
              {avgLandingFpm !== null ? (
                <>
                  <p
                    className={`text-3xl md:text-4xl font-bold tabular-nums ${(() => {
                      // Färbung nach landing-quality. avgLandingFpm ist
                      // negativ → wir vergleichen mit den schwellwerten.
                      const a = avgLandingFpm;
                      if (a >= -100) return 'text-emerald-600 dark:text-emerald-400';
                      if (a >= -200) return 'text-indigo-600 dark:text-indigo-400';
                      if (a >= -500) return 'text-amber-600 dark:text-amber-400';
                      return 'text-rose-600 dark:text-rose-400';
                    })()}`}
                  >
                    {Math.round(avgLandingFpm)}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                    fpm · n={landingSampleCount}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl md:text-3xl font-bold text-gray-300 dark:text-gray-700 tabular-nums">
                    —
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                    noch keine ACARS-daten
                  </p>
                </>
              )}
            </div>

            {/* Best Landing-Rate — bragging-rights metric */}
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-widest text-indigo-700 dark:text-indigo-400 font-semibold mb-2">
                Best Landing
              </p>
              {bestLandingFpm !== null ? (
                <>
                  <p className="text-3xl md:text-4xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {Math.round(bestLandingFpm)}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                    fpm · sanftester touchdown
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl md:text-3xl font-bold text-gray-300 dark:text-gray-700 tabular-nums">
                    —
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                    noch keine ACARS-daten
                  </p>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Top-Routen */}
        {topRoutesValid.length > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Meist geflogen
            </h2>
            <div className="space-y-2">
              {topRoutesValid.map((entry, idx) => (
                <div
                  key={entry.route.id}
                  className="flex justify-between items-center px-4 py-3 bg-gray-100 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-gray-500 font-mono text-xs">
                      #{idx + 1}
                    </span>
                    <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
                      {entry.route.flightNumber}
                    </span>
                    <span className="text-sm">
                      <span className="font-mono">{entry.route.departure.icao}</span>
                      <span className="text-gray-500 mx-2">→</span>
                      <span className="font-mono">{entry.route.arrival.icao}</span>
                    </span>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {entry.count}× geflogen
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Track 1 #1: Awards-section. Auf eigenem profil immer sichtbar
            (mit empty-state-CTA wenn keine), auf fremden profilen nur
            wenn der user awards hat (kein peinlicher "leer"-eindruck
            beim browsen anderer pilots). 4-col grid auf desktop für
            kompakten footprint. */}
        {(userAwards.length > 0 || isMe) && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm uppercase tracking-wider text-gray-500">
                Awards
              </h2>
              <Link
                href={isMe ? '/awards/personal' : '/awards'}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {isMe
                  ? `Alle meine ${userAwards.length} ansehen →`
                  : 'Award-Catalog →'}
              </Link>
            </div>
            {userAwards.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                Du hast noch keine Awards erworben.{' '}
                <Link
                  href="/awards"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline not-italic"
                >
                  Schau dir den Catalog an
                </Link>{' '}
                um zu sehen was möglich ist.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {userAwards.slice(0, 8).map((ua) => (
                  <AwardBadge
                    key={ua.id}
                    award={ua.award}
                    earned={true}
                    awardedAt={ua.awardedAt}
                    size="compact"
                  />
                ))}
                {userAwards.length > 8 && (
                  <Link
                    href={isMe ? '/awards/personal' : `/awards`}
                    className="p-3 bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg flex items-center justify-center text-sm text-gray-600 dark:text-gray-400 hover:border-indigo-500 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                  >
                    +{userAwards.length - 8} weitere →
                  </Link>
                )}
              </div>
            )}
          </section>
        )}

        {/* Track 1 #7: Events-section. Symmetrisch zu Awards: auf eigenem
            profil immer sichtbar (mit empty-CTA), auf fremden nur wenn
            mindestens ein event teilgenommen wurde. Card-style mit
            kind-badge, datum, completion-flag. Max 6 events angezeigt,
            mehr → Link zu /events. */}
        {(userEvents.length > 0 || isMe) && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm uppercase tracking-wider text-gray-500">
                Events
              </h2>
              <Link
                href="/events"
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {isMe
                  ? `Alle ${userEvents.length} ansehen →`
                  : 'Event-Catalog →'}
              </Link>
            </div>
            {userEvents.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                Du hast noch an keinem Event teilgenommen.{' '}
                <Link
                  href="/events"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline not-italic"
                >
                  Schau dir die aktuellen Events an
                </Link>{' '}
                und melde dich an.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {userEvents.slice(0, 6).map((entry) => (
                  <Link
                    key={entry.id}
                    href={`/events/${entry.event.slug}`}
                    className="block p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-lg transition"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-sm leading-tight flex-1">
                        {entry.event.title}
                      </h3>
                      {entry.completed && (
                        <span
                          className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                          title="Abgeschlossen"
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(entry.event.startsAt).toLocaleDateString('de-DE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </Link>
                ))}
                {userEvents.length > 6 && (
                  <Link
                    href="/events"
                    className="p-3 bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg flex items-center justify-center text-sm text-gray-600 dark:text-gray-400 hover:border-indigo-500 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                  >
                    +{userEvents.length - 6} weitere →
                  </Link>
                )}
              </div>
            )}
          </section>
        )}

        {/* Letzte Flüge */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Letzte Flüge
            </h2>
            {recentPireps.length > 0 && (
              <span className="text-xs text-gray-500">
                Nur genehmigte PIREPs
              </span>
            )}
          </div>
          {recentPireps.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Noch keine genehmigten Flüge.
            </p>
          ) : (
            <div className="space-y-2">
              {recentPireps.map((pirep) => {
                const hours = Math.floor((pirep.flightTimeMin ?? 0) / 60);
                const mins = (pirep.flightTimeMin ?? 0) % 60;
                const flightTime = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

                // Eigene PIREPs sind klickbar zur Detail-Page; fremde nicht
                const isClickable = isMe;
                const Wrapper = isClickable ? Link : 'div';
                const wrapperProps = isClickable
                  ? { href: `/pireps/${pirep.id}` as const }
                  : {};

                return (
                  <Wrapper
                    key={pirep.id}
                    {...(wrapperProps as any)}
                    className={`flex justify-between items-center px-4 py-3 bg-gray-100 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-800 transition ${
                      isClickable ? 'hover:bg-gray-200 dark:hover:bg-gray-800 hover:border-indigo-600/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
                        {pirep.route?.flightNumber ?? '—'}
                      </span>
                      <span className="text-sm">
                        <span className="font-mono">{pirep.departure.icao}</span>
                        <span className="text-gray-500 mx-2">→</span>
                        <span className="font-mono">{pirep.arrival.icao}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">{flightTime}</span>
                      {pirep.aircraft && (
                        <span className="text-gray-500 font-mono text-xs">
                          {pirep.aircraft.registration}
                        </span>
                      )}
                    </div>
                  </Wrapper>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}