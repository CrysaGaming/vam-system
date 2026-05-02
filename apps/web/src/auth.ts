import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@vam/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
  ],
  trustHost: true,
  session: { strategy: 'jwt' },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;

      const defaultAirline = await prisma.airline.findUnique({
        where: { icao: 'DLH' },
      });

      if (!defaultAirline) {
        console.warn('[auth] Default airline DLH not found during createUser');
        return;
      }

      const lowestRank = await prisma.rank.findFirst({
        where: { airlineId: defaultAirline.id },
        orderBy: { order: 'asc' },
      });

      const pilotRole = await prisma.role.findUnique({
        where: { name: 'pilot' },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          airlineId: defaultAirline.id,
          // joinedAirlineAt explicit setzen — schema-default greift hier
          // nicht weil airlineId vorher null war und das User-row schon
          // existiert (NextAuth's adapter erstellt den row vor diesem
          // event). Bei späterem invite-accept-flow muss diese zeile
          // analog dort dazu, sonst fehlt der join-zeitpunkt.
          joinedAirlineAt: new Date(),
          rankId: lowestRank?.id,
          roleId: pilotRole?.id,
        },
      });

      console.log(`[auth] User ${user.email} auto-joined ${defaultAirline.icao} as ${lowestRank?.name}`);
    },
  },
});
