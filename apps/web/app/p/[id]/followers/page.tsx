/**
 * Track 5 #13 (Section C) — Followers list page.
 *
 * Route: /p/[id]/followers
 *
 * Public (kein login nötig) — listet die follower des users.
 * Verwendet die geteilte FollowList-Komponente. 404 wenn target
 * nicht existiert oder nicht public ist (gleiche policy wie /p/[id]).
 */

import { notFound } from 'next/navigation';
import {
  getPublicProfile,
  PublicProfileNotFoundError,
  listFollowers,
} from '@vam/db';
import { FollowList } from '../_follow-list';

export default async function FollowersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let profile;
  try {
    profile = await getPublicProfile(id);
  } catch (err) {
    if (err instanceof PublicProfileNotFoundError) notFound();
    throw err;
  }

  const followers = await listFollowers(profile.id, { limit: 100 });

  return (
    <FollowList
      profileId={profile.id}
      profileName={profile.name}
      mode="followers"
      entries={followers}
    />
  );
}
