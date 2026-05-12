/**
 * Track 5 #13 (Section C) — Following list page.
 *
 * Route: /p/[id]/following
 */

import { notFound } from 'next/navigation';
import {
  getPublicProfile,
  PublicProfileNotFoundError,
  listFollowing,
} from '@vam/db';
import { FollowList } from '../_follow-list';

export default async function FollowingPage({
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

  const following = await listFollowing(profile.id, { limit: 100 });

  return (
    <FollowList
      profileId={profile.id}
      profileName={profile.name}
      mode="following"
      entries={following}
    />
  );
}
