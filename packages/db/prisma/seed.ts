import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Default Airline (Lufthansa Virtual)
  const airline = await prisma.airline.upsert({
    where: { icao: 'DLH' },
    update: {},
    create: {
      icao: 'DLH',
      iata: 'LH',
      name: 'Lufthansa Virtual',
      callsign: 'LUFTHANSA',
    },
  });

  // Default Ranks
  const ranks = [
    { name: 'Trainee', minFlightHours: 0, order: 1 },
    { name: 'First Officer', minFlightHours: 50, order: 2 },
    { name: 'Captain', minFlightHours: 200, order: 3 },
  ];

  for (const rank of ranks) {
    await prisma.rank.upsert({
      where: { airlineId_name: { airlineId: airline.id, name: rank.name } },
      update: {},
      create: {
        ...rank,
        airlineId: airline.id,
      },
    });
  }

  // Default Roles
  const roles = [
    { name: 'admin', permissions: ['*'], description: 'Full access' },
    { name: 'pilot', permissions: ['pirep:submit', 'pirep:view_own'], description: 'Regular pilot' },
    { name: 'instructor', permissions: ['pirep:review', 'user:coach'], description: 'Instructor' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }

  console.log('Seed completed:', { airline: airline.icao, ranks: ranks.length, roles: roles.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
