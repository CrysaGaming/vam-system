import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      vatsimCid: null,
      vatsimVerifiedAt: null,
      vatsimAccessToken: null,
      vatsimRefreshToken: null,
      vatsimTokenExpiresAt: null,
    },
  });

  redirect('/settings?status=disconnected&provider=vatsim');
}