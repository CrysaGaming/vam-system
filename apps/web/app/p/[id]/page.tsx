/**
 * Track 5 #11 (Section C) — Public Profile Page.
 *
 * Route: /p/[id]
 *
 * Öffentlich zugängliche read-only profile-page eines pilots. Kein
 * login nötig. Wenn der user existiert ABER `isProfilePublic=false`
 * gesetzt hat → 404 (kein hint dass der account existiert, privacy).
 *
 * # Sections
 *
 *   1. Header: avatar + name + airline-affiliation + member-since
 *   2. Bio (wenn gesetzt)
 *   3. Career-totals (4-col KPI grid: flights, hours, member-since, rank)
 *   4. Top aircraft (3 cards)
 *   5. Recent flights (5-row table)
 *   6. Footer: "Powered by Vamsys" + privacy-hint + edit-own-profile link
 *
 * # SEO
 *
 * Eine public-profile-page kann von suchmaschinen indexiert werden.
 * Setze sinnvolle metadata (title, og:image) via generateMetadata.
 *
 * # Privacy
 *
 * Alle daten kommen via getPublicProfile() vom @vam/db helper, der
 * den scrubbed-public-view enforcet. Hier in der page-component
 * machen wir KEINE direkten prisma-queries — damit wir nicht
 * versehentlich sensible felder leaken.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getPublicProfile,
  PublicProfileNotFoundError,
  getFollowCounts,
  getFollowState,
} from '@vam/db';
import { auth } from '@/auth';
import { FollowButton } from './follow-button';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const profile = await getPublicProfile(id);
    const name = profile.name ?? 'Pilot';
    const airline = profile.airline
      ? `${profile.airline.icao} ${profile.airline.name}`
      : 'Vamsys';
    return {
      title: `${name} · ${airline}`,
      description: `${name}: ${profile.totalFlights} Flüge, ${profile.totalHours} Stunden${
        profile.rankName ? `. Rang: ${profile.rankName}` : ''
      }.`,
      openGraph: profile.image
        ? { images: [profile.image] }
        : undefined,
    };
  } catch {
    return { title: 'Profile nicht gefunden' };
  }
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let profile;
  try {
    profile = await getPublicProfile(id);
  } catch (err) {
    if (err instanceof PublicProfileNotFoundError) {
      notFound();
    }
    throw err;
  }

  // Wir checken ob viewer der owner ist um "edit profile"-link
  // anzuzeigen. Auth ist optional auf dieser page — nicht-logged-in
  // viewers sehen die profile ganz normal, nur ohne den edit-link.
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const isOwner = viewerId === profile.id;

  // Track 5 #13: Follow-counts + viewer's follow-state parallel.
  // Counts immer laden (public auf jedem profile sichtbar). Follow-state
  // ist viewer-spezifisch — bei logged-out viewer returnt der helper
  // einfach false für alles.
  const [followCounts, followState] = await Promise.all([
    getFollowCounts(profile.id),
    getFollowState(viewerId, profile.id),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        {/* ── Header card ── */}
        <header className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 sm:p-8">
          <div className="flex items-start gap-6 flex-wrap">
            {/* Avatar */}
            {profile.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
              <picture>
                <img
                  src={profile.image}
                  alt=""
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-gray-200 dark:border-gray-800 shrink-0"
                />
              </picture>
            ) : (
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-gray-200 dark:bg-gray-800 border-4 border-gray-300 dark:border-gray-700 shrink-0" />
            )}

            {/* Identity */}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold">
                {profile.name ?? 'Unbenannter Pilot'}
              </h1>
              {profile.rankName && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {profile.rankName}
                </p>
              )}
              {profile.airline && (
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-3 flex items-center gap-2 flex-wrap">
                  {profile.airline.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <picture>
                      <img
                        src={profile.airline.logoUrl}
                        alt=""
                        className="w-6 h-6 object-contain"
                      />
                    </picture>
                  )}
                  <span className="font-mono font-semibold">
                    {profile.airline.icao}
                  </span>
                  <span>{profile.airline.name}</span>
                </p>
              )}
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
                Pilot seit{' '}
                <time dateTime={profile.memberSince.toISOString()}>
                  {profile.memberSince.toLocaleDateString('de-DE', {
                    year: 'numeric',
                    month: 'long',
                  })}
                </time>
              </p>
            </div>

            {/* Owner: edit-link; non-owner: follow-button. Self-view
                (isOwner) und non-self share den selben slot — beide
                klein und rechts oben im header. */}
            {isOwner ? (
              <Link
                href="/settings#profile"
                className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-gray-700 dark:text-gray-300 transition"
              >
                ✏️ Bearbeiten
              </Link>
            ) : (
              <FollowButton
                targetId={profile.id}
                viewerId={viewerId}
                initialIsFollowing={followState.isFollowing}
                isFollowedByTarget={followState.isFollowedBy}
              />
            )}
          </div>

          {/* Follow-counts row — public, immer angezeigt. Klick auf
              counts navigiert zu den list-pages /p/[id]/followers + 
              /following. */}
          <div className="mt-5 pt-5 border-t border-gray-100 dark:border-gray-800 flex items-center gap-6">
            <Link
              href={`/p/${profile.id}/followers`}
              className="text-sm hover:underline"
            >
              <span className="font-bold tabular-nums">
                {followCounts.followers.toLocaleString('de-DE')}
              </span>{' '}
              <span className="text-gray-500">
                {followCounts.followers === 1 ? 'Follower' : 'Follower'}
              </span>
            </Link>
            <Link
              href={`/p/${profile.id}/following`}
              className="text-sm hover:underline"
            >
              <span className="font-bold tabular-nums">
                {followCounts.following.toLocaleString('de-DE')}
              </span>{' '}
              <span className="text-gray-500">folgt</span>
            </Link>
          </div>

          {/* Bio */}
          {profile.bio && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                {profile.bio}
              </p>
            </div>
          )}
        </header>

        {/* ── KPI grid ── */}
        <section className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Flüge" value={profile.totalFlights.toLocaleString('de-DE')} />
          <KpiCard label="Stunden" value={profile.totalHours.toLocaleString('de-DE')} unit="h" />
          <KpiCard
            label="Aircraft Types"
            value={profile.topAircraft.length.toString()}
          />
          <KpiCard
            label="Letzter Flug"
            value={
              profile.recentFlights[0]
                ? profile.recentFlights[0].submittedAt.toLocaleDateString('de-DE')
                : '—'
            }
            small
          />
        </section>

        {/* ── Top aircraft ── */}
        {profile.topAircraft.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-3">
              Fliegt am liebsten
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {profile.topAircraft.map((a) => (
                <div
                  key={a.type}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-center"
                >
                  <p className="text-lg font-mono font-bold">{a.type}</p>
                  <p className="text-xs text-gray-500 mt-1 tabular-nums">
                    {a.flights} {a.flights === 1 ? 'Flug' : 'Flüge'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Recent flights ── */}
        {profile.recentFlights.length > 0 && (
          <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Letzte Flüge
            </h2>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {profile.recentFlights.map((f) => (
                <li
                  key={f.id}
                  className="py-3 flex items-baseline justify-between gap-3 flex-wrap"
                >
                  <div className="flex items-baseline gap-3 min-w-0">
                    <span className="font-mono font-semibold text-sm">
                      {f.flightNumber ?? 'PIREP'}
                    </span>
                    <span className="font-mono text-sm text-gray-700 dark:text-gray-300">
                      {f.departureIcao} → {f.arrivalIcao}
                    </span>
                    {f.aircraftType && (
                      <span className="text-[11px] text-gray-500 font-mono">
                        {f.aircraftType}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {f.flightTimeMin !== null && (
                      <span className="mr-3">
                        {Math.floor(f.flightTimeMin / 60)}h {f.flightTimeMin % 60}m
                      </span>
                    )}
                    <time dateTime={f.submittedAt.toISOString()}>
                      {f.submittedAt.toLocaleDateString('de-DE')}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Footer ── */}
        <footer className="text-center text-xs text-gray-400 dark:text-gray-500 py-6 border-t border-gray-200 dark:border-gray-800">
          <p>
            Public-Profile gehostet von{' '}
            <Link
              href="/"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Vamsys
            </Link>
            {' · '}
            {isOwner ? (
              <Link
                href="/settings#profile"
                className="hover:underline"
              >
                Deine Privatsphäre-Einstellungen
              </Link>
            ) : (
              <span>Pilot hat sein profile öffentlich gemacht</span>
            )}
          </p>
        </footer>
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
  unit,
  small,
}: {
  label: string;
  value: string;
  unit?: string;
  small?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </p>
      <p
        className={`font-bold mt-2 leading-tight tabular-nums ${
          small ? 'text-base' : 'text-2xl'
        }`}
      >
        {value}
        {unit && (
          <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>
        )}
      </p>
    </div>
  );
}
