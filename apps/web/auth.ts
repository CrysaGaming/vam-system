import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@vam/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Welle 12 phase B (Prisma 7 migration): @auth/prisma-adapter@2.11.2
  // ist die latest version (stand 2026-05-04) und wurde NUR gegen
  // Prisma 6 compiled — die signature erwartet den v6-PrismaClient-typ
  // (`PrismaClient | ReturnType<PrismaClient["$extends"]>`). Der v7-
  // PrismaClient hat eine neue typmap-shape (DynamicClientExtensionThis
  // mit zusätzlichen generics für driver-adapter), die strukturell
  // *ähnlich* aber nicht TypeScript-assignable ist.
  //
  // Runtime ist 100% kompatibel — der adapter ruft nur `prisma.user.*`,
  // `prisma.account.*`, `prisma.session.*` queries auf, und diese APIs
  // sind in v7 unverändert. Der cast hier ist rein TypeScript-side, kein
  // runtime-effekt.
  //
  // Tracking: wenn @auth/prisma-adapter@2.12+ oder @3 mit prisma-7-
  // peerDep released wird, diesen cast entfernen und auf den natürlichen
  // typ zurückwechseln. Issue/PR-suche in nextauthjs/next-auth bei
  // jedem dependabot-bump prüfen.
  adapter: PrismaAdapter(prisma as never),
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
