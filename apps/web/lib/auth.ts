import { auth } from '@/auth';
import { prisma } from '@vam/db';

// Resolves session → user.airlineId for Server Actions. See
// .claude/skills/vam-multi-tenancy. Throws on no session, missing user,
// or no airline membership.
export async function requireUserWithAirline(): Promise<{
  id: string;
  airlineId: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });

  if (!user) {
    throw new Error('User not found');
  }
  if (!user.airlineId) {
    throw new Error('User not in any airline');
  }

  return { id: session.user.id, airlineId: user.airlineId };
}
