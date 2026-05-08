import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma, type Prisma } from '@vam/db';
import Link from 'next/link';

/**
 * PIREP-list flag-filter (option #1).
 *
 * The auto-PIREP path (Welle 9 / M6 + options #7/#11/#19) splices
 * remarks-prefixes onto every flagged flight: "[ACARS-flag: …]" for
 * client-attestable runtime state (simRate, pause-time) and
 * "[Replay-flag: …]" for server-derived heuristic findings (teleport,
 * supersonic, altitude-jump, continuity-gap). Without surface for
 * those flags the pilot/admin can't easily find the suspicious flights
 * — they're buried in the chronological feed.
 *
 * This filter is the cheapest possible surface: a three-way segmented
 * control above the table (`?flag=all|with|without`) that filters by
 * the same prefix-strings the auto-PIREP path writes. Substring-match
 * via Prisma's `contains` — no schema change, builds directly on the
 * existing remarks-prefix convention.
 *
 * Future-proof: when option #20 (Anti-Cheat Structured Field, a
 * `Pirep.flags Json?` column) lands, this filter becomes a thin
 * fallback. Until then it's the canonical way to surface flagged
 * PIREPs without an extra migration.
 *
 * Why three options not boolean: "with" and "without" are different
 * mental models. "With" = admin-review use case ("show me what to
 * audit"). "Without" = pilot use case ("did my last flight come
 * through clean?"). "All" = default chronological feed. A boolean
 * only-flagged-toggle would force one of the two roles to flip it
 * back every visit.
 */

type FlagFilter = 'all' | 'with' | 'without';

function parseFlagFilter(raw: string | undefined): FlagFilter {
    if (raw === 'with' || raw === 'without') return raw;
    return 'all';
}

/**
 * Build the Prisma where-clause for the active flag-filter. Substring
 * match against the two prefix-strings used by generate-pirep.ts.
 *
 * - 'all'     → no extra constraint (legacy behaviour)
 * - 'with'    → OR-match either prefix (any flag at all)
 * - 'without' → AND-NOT-match both prefixes
 *
 * Mode='insensitive' is unnecessary because the prefixes are emitted
 * with fixed casing by the server. Performance: substring-match is a
 * sequential scan, but the userId-filter narrows to one pilot's
 * PIREPs first so the scan-set is small.
 */
function buildFlagWhere(filter: FlagFilter): Prisma.PirepWhereInput {
    const ACARS_FLAG_PREFIX = '[ACARS-flag';
    const REPLAY_FLAG_PREFIX = '[Replay-flag';

    if (filter === 'with') {
        return {
            OR: [
                { remarks: { contains: ACARS_FLAG_PREFIX } },
                { remarks: { contains: REPLAY_FLAG_PREFIX } },
            ],
        };
    }
    if (filter === 'without') {
        return {
            AND: [
                {
                    NOT: { remarks: { contains: ACARS_FLAG_PREFIX } },
                },
                {
                    NOT: { remarks: { contains: REPLAY_FLAG_PREFIX } },
                },
            ],
        };
    }
    return {};
}

export default async function PirepsList({
    searchParams,
}: {
    searchParams: Promise<{ flag?: string }>;
}) {
    const session = await auth();

    if (!session?.user) {
        redirect('/');
    }

    const { flag: flagParam } = await searchParams;
    const flagFilter = parseFlagFilter(flagParam);

    // Two queries in parallel: the filtered list (what we render) and
    // the unfiltered total (so the filter-bar can show counts like
    // "Mit Flag (3)" — pilots see immediately whether a flagged flight
    // exists at all without having to flip the filter).
    //
    // The flagged-count is derived from a third query because counting
    // the with-flag set isn't the same as the unfiltered total. Three
    // queries × small per-pilot dataset = trivial. If this ever needs
    // optimization, a single query with raw-SQL CASE-aggregation gets
    // the same numbers in one round-trip.
    const userIdFilter = { userId: session.user.id };
    const [pireps, totalCount, flaggedCount] = await Promise.all([
        prisma.pirep.findMany({
            where: { ...userIdFilter, ...buildFlagWhere(flagFilter) },
            include: {
                route: true,
                departure: true,
                arrival: true,
                aircraft: true,
            },
            orderBy: { submittedAt: 'desc' },
        }),
        prisma.pirep.count({ where: userIdFilter }),
        prisma.pirep.count({
            where: { ...userIdFilter, ...buildFlagWhere('with') },
        }),
    ]);
    const cleanCount = totalCount - flaggedCount;

    // Render-helper for the filter-bar buttons. Active button gets a
    // distinct background; inactive buttons stay neutral. The hrefs
    // strip the param when going back to 'all' (cleaner URLs).
    const filterButtons: { value: FlagFilter; label: string; count: number }[] = [
        { value: 'all', label: 'Alle', count: totalCount },
        { value: 'with', label: 'Mit Flag', count: flaggedCount },
        { value: 'without', label: 'Ohne Flag', count: cleanCount },
    ];

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
            <div className="max-w-[100rem] mx-auto">
                <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
                    <div>
                        <h1 className="text-3xl font-bold">Meine PIREPs</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                            {pireps.length} {pireps.length === 1 ? 'Flug' : 'Flüge'}
                            {flagFilter !== 'all' && ` · gefiltert von ${totalCount}`}
                        </p>
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

                {/* Flag-filter bar — only visible when there's at least one
                    PIREP. Hiding it on empty-state avoids a confusing
                    "Mit Flag (0)" tab next to the "Ersten Flug einreichen"
                    CTA. The bar itself is suppressed when totalCount=0;
                    once any PIREPs exist, it always renders so the user
                    learns the filter is available even if no flagged
                    PIREPs exist yet (count badge says 0). */}
                {totalCount > 0 && (
                    <div
                        role="tablist"
                        aria-label="PIREP-Flag-Filter"
                        className="flex gap-2 mb-6"
                    >
                        {filterButtons.map((btn) => {
                            const isActive = flagFilter === btn.value;
                            // 'all' → strip the param entirely so the URL
                            // stays clean for the default view.
                            const href =
                                btn.value === 'all'
                                    ? '/pireps'
                                    : `/pireps?flag=${btn.value}`;
                            return (
                                <Link
                                    key={btn.value}
                                    href={href}
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`px-4 py-2 rounded-md text-sm font-medium transition border ${
                                        isActive
                                            ? 'bg-indigo-600 hover:bg-indigo-700 border-indigo-600 text-white'
                                            : 'bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
                                    }`}
                                >
                                    {btn.label}
                                    <span
                                        className={`ml-2 text-xs ${
                                            isActive
                                                ? 'text-indigo-200'
                                                : 'text-gray-500 dark:text-gray-400'
                                        }`}
                                    >
                                        ({btn.count})
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                )}

                {pireps.length === 0 ? (
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
                        {/* Empty-state copy adapts to the active filter so
                            it's not misleading. "Keine PIREPs" when the
                            user actually has 5 unflagged ones would feel
                            buggy; the differentiated message tells them
                            exactly why the table is empty. */}
                        {totalCount === 0 ? (
                            <>
                                <p className="text-gray-500 dark:text-gray-400 mb-4">
                                    Du hast noch keine PIREPs eingereicht.
                                </p>
                                <Link
                                    href="/pireps/new"
                                    className="inline-block px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition"
                                >
                                    Ersten Flug einreichen
                                </Link>
                            </>
                        ) : flagFilter === 'with' ? (
                            <>
                                <p className="text-gray-500 dark:text-gray-400 mb-4">
                                    Keine geflaggten PIREPs gefunden — alle
                                    deine Flüge wurden sauber übermittelt.
                                </p>
                                <Link
                                    href="/pireps"
                                    className="inline-block px-5 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                                >
                                    ← Alle anzeigen
                                </Link>
                            </>
                        ) : (
                            <>
                                <p className="text-gray-500 dark:text-gray-400 mb-4">
                                    Keine PIREPs ohne Flag gefunden.
                                </p>
                                <Link
                                    href="/pireps"
                                    className="inline-block px-5 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                                >
                                    ← Alle anzeigen
                                </Link>
                            </>
                        )}
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
