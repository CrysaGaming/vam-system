import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';

export default async function NewPirep() {
    const session = await auth();

    if (!session?.user) {
        redirect('/');
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { airline: true },
    });

    if (!user || !user.airline) {
        redirect('/dashboard');
    }

    const routes = await prisma.route.findMany({
        where: { airlineId: user.airline.id, active: true },
        include: { departure: true, arrival: true },
        orderBy: { flightNumber: 'asc' },
    });

    const aircraft = await prisma.aircraft.findMany({
        where: { airlineId: user.airline.id, active: true },
        orderBy: { registration: 'asc' },
    });

    async function submitPirep(formData: FormData) {
        'use server';

        const session = await auth();
        if (!session?.user) {
            throw new Error('Unauthorized');
        }

        const routeId = formData.get('routeId') as string;
        const aircraftId = formData.get('aircraftId') as string;
        const flightTimeMinRaw = formData.get('flightTimeMin') as string;
        const fuelUsedKgRaw = formData.get('fuelUsedKg') as string;
        const landingRateFpmRaw = formData.get('landingRateFpm') as string;
        const remarks = (formData.get('remarks') as string) || null;

        const flightTimeMin = parseInt(flightTimeMinRaw, 10);
        const fuelUsedKg = fuelUsedKgRaw ? parseInt(fuelUsedKgRaw, 10) : null;
        const landingRateFpm = landingRateFpmRaw ? parseInt(landingRateFpmRaw, 10) : null;

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            include: { airline: true },
        });
        if (!user || !user.airline) throw new Error('User or airline not found');

        const route = await prisma.route.findUnique({
            where: { id: routeId },
            include: { departure: true, arrival: true },
        });
        if (!route) throw new Error('Route not found');

        await prisma.$transaction([
            prisma.pirep.create({
                data: {
                    airlineId: user.airline.id,
                    userId: user.id,
                    routeId: route.id,
                    aircraftId,
                    departureId: route.departureId,
                    arrivalId: route.arrivalId,
                    state: 'Landed',
                    network: 'Offline',
                    status: 'Submitted',
                    flightTimeMin,
                    fuelUsedKg,
                    landingRateFpm,
                    remarks,
                },
            }),
            prisma.user.update({
                where: { id: user.id },
                data: {
                    totalFlightHours: { increment: flightTimeMin / 60 },
                    totalFlights: { increment: 1 },
                },
            }),
        ]);

        revalidatePath('/dashboard');
        revalidatePath('/pireps');
        redirect('/pireps');
    }

    return (
        <main className="min-h-screen bg-gray-950 text-white p-8">
            <div className="max-w-2xl mx-auto">
                <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
                    <div>
                        <h1 className="text-3xl font-bold">Neuen PIREP einreichen</h1>
                        <p className="text-gray-400 text-sm mt-1">Flugbericht für {user.airline.name}</p>
                    </div>
                    <Link
                        href="/dashboard"
                        className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
                    >
                        ← Dashboard
                    </Link>
                </header>

                <form action={submitPirep} className="space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-5">
                        <div>
                            <label htmlFor="routeId" className="block text-sm font-medium text-gray-300 mb-2">
                                Route
                            </label>
                            <select
                                id="routeId"
                                name="routeId"
                                required
                                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                            >
                                <option value="">-- Route wählen --</option>
                                {routes.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.flightNumber} · {r.departure.icao} → {r.arrival.icao} ({r.distanceNm} nm)
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="aircraftId" className="block text-sm font-medium text-gray-300 mb-2">
                                Flugzeug
                            </label>
                            <select
                                id="aircraftId"
                                name="aircraftId"
                                required
                                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                            >
                                <option value="">-- Flugzeug wählen --</option>
                                {aircraft.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.registration} · {a.type}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label htmlFor="flightTimeMin" className="block text-sm font-medium text-gray-300 mb-2">
                                    Flugzeit (Min)
                                </label>
                                <input
                                    type="number"
                                    id="flightTimeMin"
                                    name="flightTimeMin"
                                    required
                                    min="1"
                                    max="1440"
                                    placeholder="z.B. 75"
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div>
                                <label htmlFor="fuelUsedKg" className="block text-sm font-medium text-gray-300 mb-2">
                                    Treibstoff (kg)
                                </label>
                                <input
                                    type="number"
                                    id="fuelUsedKg"
                                    name="fuelUsedKg"
                                    min="0"
                                    placeholder="optional"
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div>
                                <label htmlFor="landingRateFpm" className="block text-sm font-medium text-gray-300 mb-2">
                                    Landing Rate (fpm)
                                </label>
                                <input
                                    type="number"
                                    id="landingRateFpm"
                                    name="landingRateFpm"
                                    max="0"
                                    placeholder="z.B. -120"
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="remarks" className="block text-sm font-medium text-gray-300 mb-2">
                                Bemerkungen
                            </label>
                            <textarea
                                id="remarks"
                                name="remarks"
                                rows={3}
                                placeholder="Optional — z.B. Wetter, Besonderheiten"
                                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500 resize-none"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition"
                    >
                        PIREP einreichen
                    </button>
                </form>
            </div>
        </main>
    );
}