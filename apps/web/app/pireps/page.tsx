import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

export default async function PirepsList() {
    const session = await auth();

    if (!session?.user) {
        redirect('/');
    }

    const pireps = await prisma.pirep.findMany({
        where: { userId: session.user.id },
        include: {
            route: true,
            departure: true,
            arrival: true,
            aircraft: true,
        },
        orderBy: { submittedAt: 'desc' },
    });

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
            <div className="max-w-6xl mx-auto">
                <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
                    <div>
                        <h1 className="text-3xl font-bold">Meine PIREPs</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{pireps.length} eingereichte Flüge</p>
                    </div>
                    <div className="flex gap-3">
                        <Link
                            href="/dashboard"
                            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                        >
                            ← Dashboard
                        </Link>
                        <Link
                            href="/pireps/new"
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
                        >
                            + Neuer PIREP
                        </Link>
                    </div>
                </header>

                {pireps.length === 0 ? (
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
                        <p className="text-gray-500 dark:text-gray-400 mb-4">Du hast noch keine PIREPs eingereicht.</p>
                        <Link
                            href="/pireps/new"
                            className="inline-block px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition"
                        >
                            Ersten Flug einreichen
                        </Link>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100 dark:bg-gray-800/50">
                                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                    <th className="px-4 py-3">Flug</th>
                                    <th className="px-4 py-3">Strecke</th>
                                    <th className="px-4 py-3">Aircraft</th>
                                    <th className="px-4 py-3 text-right">Dauer</th>
                                    <th className="px-4 py-3 text-right">Status</th>
                                    <th className="px-4 py-3 text-right">Eingereicht</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                                {pireps.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition group cursor-pointer">
                                        <td className="px-4 py-3 font-mono font-semibold">
                                            <Link href={`/pireps/${p.id}`} className="block group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                                                {p.route?.flightNumber ?? '—'}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                            <Link href={`/pireps/${p.id}`} className="block">
                                                {p.departure.icao} → {p.arrival.icao}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                            <Link href={`/pireps/${p.id}`} className="block">
                                                {p.aircraft?.registration ?? '—'}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Link href={`/pireps/${p.id}`} className="block">
                                                {p.flightTimeMin ? `${Math.floor(p.flightTimeMin / 60)}h ${p.flightTimeMin % 60}min` : '—'}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Link href={`/pireps/${p.id}`} className="block">
                                                <span className={
                                                    p.status === 'Approved' ? 'text-green-700 dark:text-green-400' :
                                                        p.status === 'Rejected' ? 'text-red-700 dark:text-red-400' :
                                                            'text-yellow-700 dark:text-yellow-400'
                                                }>
                                                    {p.status}
                                                </span>
                                            </Link>
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                                            <Link href={`/pireps/${p.id}`} className="block">
                                                {new Date(p.submittedAt).toLocaleDateString('de-DE', {
                                                    year: 'numeric',
                                                    month: '2-digit',
                                                    day: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </main>
    );
}
