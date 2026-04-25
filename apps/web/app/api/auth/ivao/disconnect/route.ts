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
      ivaoVid: null,
      ivaoVerifiedAt: null,
      ivaoAccessToken: null,
      ivaoRefreshToken: null,
      ivaoTokenExpiresAt: null,
    },
  });

  redirect('/settings?status=disconnected&provider=ivao');
}