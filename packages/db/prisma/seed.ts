import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // ───── Default Airline ─────
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

  // ───── Ranks ─────
  const ranks = [
    { name: 'Trainee', minFlightHours: 0, order: 1 },
    { name: 'First Officer', minFlightHours: 50, order: 2 },
    { name: 'Captain', minFlightHours: 200, order: 3 },
  ];
  for (const rank of ranks) {
    await prisma.rank.upsert({
      where: { airlineId_name: { airlineId: airline.id, name: rank.name } },
      update: {},
      create: { ...rank, airlineId: airline.id },
    });
  }

  // ───── Roles ─────
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

  // ───── Airports ─────
  const airports = [
    { icao: 'EDDF', iata: 'FRA', name: 'Frankfurt Main', city: 'Frankfurt', country: 'Germany', latitude: 50.0379, longitude: 8.5622, elevation: 364 },
    { icao: 'EDDM', iata: 'MUC', name: 'Munich', city: 'Munich', country: 'Germany', latitude: 48.3538, longitude: 11.7861, elevation: 1487 },
    { icao: 'EDDL', iata: 'DUS', name: 'Dusseldorf', city: 'Dusseldorf', country: 'Germany', latitude: 51.2895, longitude: 6.7668, elevation: 147 },
    { icao: 'EDDB', iata: 'BER', name: 'Berlin Brandenburg', city: 'Berlin', country: 'Germany', latitude: 52.3667, longitude: 13.5033, elevation: 157 },
    { icao: 'EDDH', iata: 'HAM', name: 'Hamburg', city: 'Hamburg', country: 'Germany', latitude: 53.6304, longitude: 9.9882, elevation: 53 },
    { icao: 'EDDK', iata: 'CGN', name: 'Cologne Bonn', city: 'Cologne', country: 'Germany', latitude: 50.8659, longitude: 7.1427, elevation: 302 },
    { icao: 'EDDS', iata: 'STR', name: 'Stuttgart', city: 'Stuttgart', country: 'Germany', latitude: 48.6899, longitude: 9.2220, elevation: 1276 },
    { icao: 'EGLL', iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'United Kingdom', latitude: 51.4706, longitude: -0.4619, elevation: 83 },
    { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'France', latitude: 49.0097, longitude: 2.5479, elevation: 392 },
    { icao: 'LEMD', iata: 'MAD', name: 'Madrid Barajas', city: 'Madrid', country: 'Spain', latitude: 40.4719, longitude: -3.5626, elevation: 2000 },
    { icao: 'LIRF', iata: 'FCO', name: 'Rome Fiumicino', city: 'Rome', country: 'Italy', latitude: 41.8003, longitude: 12.2389, elevation: 13 },
    { icao: 'LSZH', iata: 'ZRH', name: 'Zurich', city: 'Zurich', country: 'Switzerland', latitude: 47.4582, longitude: 8.5555, elevation: 1416 },
    { icao: 'LOWW', iata: 'VIE', name: 'Vienna', city: 'Vienna', country: 'Austria', latitude: 48.1103, longitude: 16.5697, elevation: 600 },
    { icao: 'KJFK', iata: 'JFK', name: 'New York JFK', city: 'New York', country: 'USA', latitude: 40.6398, longitude: -73.7789, elevation: 13 },
    { icao: 'KORD', iata: 'ORD', name: "Chicago O'Hare", city: 'Chicago', country: 'USA', latitude: 41.9742, longitude: -87.9073, elevation: 672 },
  ];
  for (const ap of airports) {
    await prisma.airport.upsert({
      where: { icao: ap.icao },
      update: {},
      create: ap,
    });
  }

  // ───── Aircraft ─────
  const aircraftList = [
    { registration: 'D-AIBL', type: 'Airbus A319-114', homeIcao: 'EDDF' },
    { registration: 'D-AIZA', type: 'Airbus A320-214', homeIcao: 'EDDF' },
    { registration: 'D-AIUX', type: 'Airbus A320-214', homeIcao: 'EDDM' },
    { registration: 'D-AIDM', type: 'Airbus A321-231', homeIcao: 'EDDF' },
    { registration: 'D-AIXA', type: 'Airbus A350-941', homeIcao: 'EDDM' },
    { registration: 'D-ABYA', type: 'Boeing 747-830', homeIcao: 'EDDF' },
  ];
  for (const ac of aircraftList) {
    await prisma.aircraft.upsert({
      where: { registration: ac.registration },
      update: {},
      create: { ...ac, airlineId: airline.id },
    });
  }

  // ───── Routes ─────
  // Hilfsfunktion um Airport-IDs per ICAO zu finden
  async function findAirportId(icao: string): Promise<string> {
    const ap = await prisma.airport.findUnique({ where: { icao } });
    if (!ap) throw new Error(`Airport ${icao} not found in seed`);
    return ap.id;
  }

  const routes = [
    { flightNumber: 'LH100', from: 'EDDF', to: 'EDDM', minutes: 60, nm: 171 },
    { flightNumber: 'LH200', from: 'EDDF', to: 'EDDB', minutes: 70, nm: 225 },
    { flightNumber: 'LH250', from: 'EDDF', to: 'EDDH', minutes: 65, nm: 215 },
    { flightNumber: 'LH300', from: 'EDDM', to: 'EDDH', minutes: 75, nm: 330 },
    { flightNumber: 'LH400', from: 'EDDF', to: 'EGLL', minutes: 90, nm: 350 },
    { flightNumber: 'LH420', from: 'EDDF', to: 'LFPG', minutes: 80, nm: 250 },
    { flightNumber: 'LH500', from: 'EDDF', to: 'LEMD', minutes: 165, nm: 790 },
    { flightNumber: 'LH550', from: 'EDDM', to: 'LSZH', minutes: 55, nm: 145 },
    { flightNumber: 'LH600', from: 'EDDF', to: 'LOWW', minutes: 90, nm: 340 },
    { flightNumber: 'LH700', from: 'EDDM', to: 'LIRF', minutes: 110, nm: 430 },
    { flightNumber: 'LH400', from: 'EDDF', to: 'KJFK', minutes: 520, nm: 3350 },
    { flightNumber: 'LH430', from: 'EDDF', to: 'KORD', minutes: 555, nm: 3800 },
  ];

  for (const route of routes) {
    const departureId = await findAirportId(route.from);
    const arrivalId = await findAirportId(route.to);

    await prisma.route.upsert({
      where: { airlineId_flightNumber: { airlineId: airline.id, flightNumber: route.flightNumber } },
      update: {},
      create: {
        airlineId: airline.id,
        flightNumber: route.flightNumber,
        departureId,
        arrivalId,
        estimatedMinutes: route.minutes,
        distanceNm: route.nm,
      },
    });
  }

  console.log('Seed completed:', {
    airline: airline.icao,
    ranks: ranks.length,
    roles: roles.length,
    airports: airports.length,
    aircraft: aircraftList.length,
    routes: routes.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
