import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma, Prisma } from '@vam/db';
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
 * via Prisma's `contains` plus a structured-field check.
 *
 * Two-surface implementation (option #20): the where-clause is an
 * OR of (a) `flags IS NOT NULL` — the structured Pirep.flags column
 * populated for any post-#20 auto-PIREP that fired a flag, and
 * (b) substring-match on the [ACARS-flag / [Replay-flag prefixes —
 * the legacy surface for pre-#20 PIREPs that have flags only in
 * remarks. Once a backfill-script populates structured flags for
 * historical rows, the substring fallback becomes redundant and
 * can be removed.
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
 * Track 4 #74 (Section N) — Date-Range-Filter
 *
 * Preset-bands für die häufigsten zeit-fenster. Klick → setzt
 * effektive from/to dates basierend auf "now". Wir speichern den
 * preset-key im URL statt absolute dates damit ein bookmark "letzte
 * 30 Tage" mit der zeit mitfließt — wenn der user die page morgen
 * öffnet, sieht er die letzten 30 tage ab morgen, nicht ein
 * statisches 30-tage-fenster ab heute.
 *
 * Custom-from + custom-to als orthogonale axe. Wenn beide gesetzt
 * sind, ÜBERSCHREIBEN sie den preset. Wenn nur from gesetzt ist,
 * läuft das range bis heute. Wenn nur to gesetzt ist, läuft es
 * von epoch bis to.
 *
 * # Schema-knot
 *
 * submittedAt ist die canonical-zeit auf PIREPs — der moment in dem
 * der pilot/ACARS die submission ausgelöst hat. Wir filtern danach
 * weil's für den nutzer die natürliche frage ist ("was hab ich diese
 * woche gefiled?"). Alternative wäre approvedAt (für approved-PIREPs)
 * aber das verschiebt drafts/submitted aus dem fenster — out of
 * scope für v1.
 */
type DateRangePreset = '7d' | '30d' | '90d' | 'ytd';

function parseDateRangePreset(raw: string | undefined): DateRangePreset | null {
    if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'ytd') return raw;
    return null;
}

/**
 * Parse a YYYY-MM-DD date string from a URL param. Returns null on any
 * parse fail. Stricter than `new Date(raw)` weil Date() viele formate
 * akzeptiert (auch ungültige); wir wollen NUR den canonical ISO-date
 * der vom <input type="date"> emittiert wird.
 */
function parseIsoDate(raw: string | undefined): Date | null {
    if (typeof raw !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const d = new Date(raw + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

/**
 * Resolve preset → {from, to} bounds basierend auf "now". UTC-daten damit
 * timezone-shifts zwischen server + client nicht zu off-by-one-day-bugs
 * führen (z.B. "ytd" auf einem server in UTC-7 würde sonst am 1. Januar
 * vor 7 UTC-uhr noch das vorjahr zeigen).
 */
function presetBounds(preset: DateRangePreset, now: Date = new Date()): { from: Date; to: Date } {
    const to = now;
    const from = new Date(now);
    if (preset === '7d') from.setUTCDate(from.getUTCDate() - 7);
    else if (preset === '30d') from.setUTCDate(from.getUTCDate() - 30);
    else if (preset === '90d') from.setUTCDate(from.getUTCDate() - 90);
    else if (preset === 'ytd') {
        from.setUTCMonth(0, 1);
        from.setUTCHours(0, 0, 0, 0);
    }
    return { from, to };
}

/** Format Date → YYYY-MM-DD für <input type="date"> defaultValue. UTC-basis. */
function toIsoDateString(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Build the Prisma where-clause für submittedAt-bereich.
 *
 * Wenn custom-from/to gesetzt sind, überschreiben sie den preset komplett.
 * Wenn nur preset, nutzen wir presetBounds(preset). custom-only → die
 * eine seite die definiert ist. all-null → no constraint.
 *
 * to-bound wird auf end-of-day (23:59:59.999Z) gesetzt damit "to=2026-05-11"
 * auch die submissions vom 11. mai abdeckt (sonst würde lt der 11.
 * exklusiv ausschließen).
 */
function buildDateWhere(
    preset: DateRangePreset | null,
    customFrom: Date | null,
    customTo: Date | null,
): Prisma.PirepWhereInput {
    let from: Date | null = customFrom;
    let to: Date | null = customTo;

    if (preset && !from && !to) {
        const bounds = presetBounds(preset);
        from = bounds.from;
        to = bounds.to;
    }

    if (!from && !to) return {};

    const toEndOfDay = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1) : null;

    return {
        submittedAt: {
            ...(from && { gte: from }),
            ...(toEndOfDay && { lte: toEndOfDay }),
        },
    };
}

/**
 * URL-builder für /pireps. Preserved orthogonale filter-axes (flag, range,
 * from, to) — wenn der user nur eine axe ändert, bleiben die anderen
 * erhalten. Pattern aligned mit buildBookingsUrl in bookings/page.tsx +
 * buildRoutesUrl in routes/page.tsx (#73).
 *
 * override='flag': null → strip; 'all' → strip (kanonische default-URL);
 *   anderer wert → setzen.
 * override='range': null → strip; preset-key → setzen.
 * override='from'/'to': null → strip; YYYY-MM-DD → setzen.
 *
 * Wenn ein wert NICHT im override-object ist, bleibt der aktuelle wert
 * erhalten. Use-case: chip-row im date-bar setzt nur 'range', alles
 * andere bleibt — der user kann seinen flag-filter + sein date-fenster
 * unabhängig kombinieren.
 */
function buildPirepsUrl(
    current: {
        flag: FlagFilter;
        range: DateRangePreset | null;
        from: string | null;
        to: string | null;
    },
    override: Partial<{
        flag: FlagFilter | null;
        range: DateRangePreset | null;
        from: string | null;
        to: string | null;
    }>,
): string {
    const merged: typeof current = {
        flag: override.flag === undefined ? current.flag : (override.flag ?? 'all'),
        range: override.range === undefined ? current.range : override.range,
        from: override.from === undefined ? current.from : override.from,
        to: override.to === undefined ? current.to : override.to,
    };
    const usp = new URLSearchParams();
    if (merged.flag !== 'all') usp.set('flag', merged.flag);
    if (merged.range) usp.set('range', merged.range);
    if (merged.from) usp.set('from', merged.from);
    if (merged.to) usp.set('to', merged.to);
    const qs = usp.toString();
    return qs ? `/pireps?${qs}` : '/pireps';
}

/**
 * Build the Prisma where-clause for the active flag-filter.
 *
 * Two-surface design (option #20):
 *   - Primary: `flags IS NOT NULL` on the structured Pirep.flags column.
 *     Populated for every post-#20 auto-PIREP that fired a flag.
 *     Prisma's Json-field nullability uses Prisma.DbNull as the sentinel
 *     (NOT JavaScript null) to distinguish SQL NULL from JSON null-value.
 *   - Fallback: substring-match on the [ACARS-flag / [Replay-flag
 *     prefixes in remarks. Catches pre-#20 PIREPs that have flags only
 *     in the human-readable string but no structured column data, plus
 *     the edge case where a pilot manually edited remarks to add a
 *     pseudo-prefix (rare but harmless).
 *
 * - 'all'     → no extra constraint
 * - 'with'    → OR-match (structured set OR either prefix substring)
 * - 'without' → AND-NOT-match (structured null AND no prefix substring)
 *
 * Mode='insensitive' is unnecessary because the prefixes are emitted
 * with fixed casing by the server. Performance: substring-match is a
 * sequential scan, but the userId-filter narrows to one pilot's
 * PIREPs first so the scan-set is small. The flags IS NOT NULL check
 * is a B-tree-skippable null-test, near-free.
 */
function buildFlagWhere(filter: FlagFilter): Prisma.PirepWhereInput {
    const ACARS_FLAG_PREFIX = '[ACARS-flag';
    const REPLAY_FLAG_PREFIX = '[Replay-flag';

    if (filter === 'with') {
        return {
            OR: [
                // Structured field (option #20). Prisma.DbNull = SQL NULL,
                // distinct from Prisma.JsonNull (which would mean a JSON
                // null literal). We want "column has any value" so
                // `not: DbNull` is correct.
                { flags: { not: Prisma.DbNull } },
                { remarks: { contains: ACARS_FLAG_PREFIX } },
                { remarks: { contains: REPLAY_FLAG_PREFIX } },
            ],
        };
    }
    if (filter === 'without') {
        return {
            AND: [
                { flags: { equals: Prisma.DbNull } },
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
    searchParams: Promise<{ flag?: string; range?: string; from?: string; to?: string }>;
}) {
    const session = await auth();

    if (!session?.user) {
        redirect('/');
    }

    const { flag: flagParam, range: rangeParam, from: fromParam, to: toParam } =
        await searchParams;
    const flagFilter = parseFlagFilter(flagParam);
    // #74: Date-range params. Custom-from/to überschreiben preset wenn
    // gesetzt; sonst gilt der preset. Beide null → kein date-filter.
    const datePreset = parseDateRangePreset(rangeParam);
    const customFrom = parseIsoDate(fromParam);
    const customTo = parseIsoDate(toParam);
    const dateFilterActive =
        datePreset !== null || customFrom !== null || customTo !== null;

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
    //
    // #74: date-filter wird IN ALLEN drei queries angewandt damit die
    // flag-counts den date-range respektieren. \"Mit Flag (3)\" während
    // \"Letzte 7 Tage\" aktiv ist meint die 3 in den letzten 7 tagen,
    // nicht historisch insgesamt — sonst würde der user denken \"warum
    // sehe ich nichts wenn 3 mit flag existieren\".
    const userIdFilter = { userId: session.user.id };
    const dateWhere = buildDateWhere(datePreset, customFrom, customTo);
    const [pireps, totalCount, flaggedCount] = await Promise.all([
        prisma.pirep.findMany({
            where: {
                ...userIdFilter,
                ...buildFlagWhere(flagFilter),
                ...dateWhere,
            },
            include: {
                route: true,
                departure: true,
                arrival: true,
                aircraft: true,
            },
            orderBy: { submittedAt: 'desc' },
        }),
        prisma.pirep.count({ where: { ...userIdFilter, ...dateWhere } }),
        prisma.pirep.count({
            where: { ...userIdFilter, ...buildFlagWhere('with'), ...dateWhere },
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

    // #74: Filter-context-snapshot für buildPirepsUrl. Wird in den filter-
    // bar links + date-bar verwendet damit alle URL-änderungen die anderen
    // axes preserved halten.
    const filterCtx = {
        flag: flagFilter,
        range: datePreset,
        from: customFrom ? toIsoDateString(customFrom) : null,
        to: customTo ? toIsoDateString(customTo) : null,
    };

    // Anyfilter-flag für header-counter + empty-state-copy. True wenn
    // mindestens eine filter-axe aktiv ist (flag oder date).
    const anyFilterActive = flagFilter !== 'all' || dateFilterActive;

    // Date-preset-bands für die chip-row. Reihenfolge = display-reihenfolge.
    const dateRangeButtons: { value: DateRangePreset; label: string }[] = [
        { value: '7d', label: '7 Tage' },
        { value: '30d', label: '30 Tage' },
        { value: '90d', label: '90 Tage' },
        { value: 'ytd', label: 'Dieses Jahr' },
    ];

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
            <div className="max-w-[100rem] mx-auto">
                <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
                    <div>
                        <h1 className="text-3xl font-bold">Meine PIREPs</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                            {pireps.length} {pireps.length === 1 ? 'Flug' : 'Flüge'}
                            {anyFilterActive && ` · gefiltert von ${totalCount}`}
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
                    PIREPs exist yet (count badge says 0).

                    #74: hrefs gehen jetzt durch buildPirepsUrl damit der
                    date-range erhalten bleibt wenn der user zwischen flag-
                    tabs wechselt. */}
                {totalCount > 0 && (
                    <div
                        role="tablist"
                        aria-label="PIREP-Flag-Filter"
                        className="flex gap-2 mb-4"
                    >
                        {filterButtons.map((btn) => {
                            const isActive = flagFilter === btn.value;
                            // 'all' → flag-param strippen; andere axes
                            // (range/from/to) bleiben via filterCtx erhalten.
                            const href = buildPirepsUrl(filterCtx, {
                                flag: btn.value === 'all' ? null : btn.value,
                            });
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

                {/* Track 4 #74 (Section N): Date-Range-Filter-Bar.
                    Zweiteilig: oben preset-chips für die häufigsten zeit-
                    fenster (7/30/90 tage, dieses jahr), darunter ein form
                    mit zwei date-inputs für custom-range. Beide spielen
                    zusammen — siehe buildDateWhere doc-string.

                    Sichtbarkeit-policy: nur wenn totalCount > 0 (analog
                    flag-bar). Pre-empty-PIREP würde die controls als
                    cargo-cult wirken.

                    Status-row + reset-link erscheinen nur wenn date-filter
                    aktiv ist — ohne aktiven filter wäre die row sinnlos
                    leer. */}
                {totalCount > 0 && (
                    <div className="mb-6 space-y-2">
                        {/* Preset-chip-row. Aktiver chip ist indigo, alle
                            anderen neutral. Klick auf aktiven chip toggled
                            ihn ab (preset → null) damit der user nicht den
                            reset-link suchen muss um den preset zu lösen.

                            Wichtig: chip-click clearen ALWAYS auch custom-
                            from/to — sonst würde der preset im URL stehen
                            während die custom-fields ihn überschreiben
                            (siehe buildDateWhere). Cleaner UX: chip = quick-
                            pick, custom = fine-control, sie sind nicht
                            additiv. */}
                        <div className="flex gap-2 items-center flex-wrap">
                            <span className="text-xs uppercase tracking-wider text-gray-500 mr-1">
                                Zeitraum:
                            </span>
                            {dateRangeButtons.map((btn) => {
                                const isActive = datePreset === btn.value;
                                const href = buildPirepsUrl(filterCtx, {
                                    range: isActive ? null : btn.value,
                                    from: null,
                                    to: null,
                                });
                                return (
                                    <Link
                                        key={btn.value}
                                        href={href}
                                        aria-pressed={isActive}
                                        className={`px-3 py-1 rounded-full text-xs font-medium border transition whitespace-nowrap ${
                                            isActive
                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                                        }`}
                                    >
                                        {btn.label}
                                    </Link>
                                );
                            })}
                        </div>

                        {/* Custom-range form. method=GET → server-render mit
                            den neuen params. Hidden inputs für flag carry
                            den flag-filter durch; range-param wird bewusst
                            NICHT mitgesendet weil custom-range den preset
                            ohnehin überschreibt (siehe buildDateWhere).
                            Wenn beide inputs leer abgeschickt werden, werden
                            range/from/to gestrippt → effektiver reset des
                            date-filters. */}
                        <form method="GET" className="flex gap-2 items-center flex-wrap">
                            <span className="text-xs uppercase tracking-wider text-gray-500">
                                Von–Bis:
                            </span>
                            <input
                                type="date"
                                name="from"
                                defaultValue={
                                    customFrom ? toIsoDateString(customFrom) : ''
                                }
                                className="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                            />
                            <span className="text-gray-500">–</span>
                            <input
                                type="date"
                                name="to"
                                defaultValue={
                                    customTo ? toIsoDateString(customTo) : ''
                                }
                                className="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                            />
                            {flagFilter !== 'all' && (
                                <input type="hidden" name="flag" value={flagFilter} />
                            )}
                            <button
                                type="submit"
                                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                            >
                                Anwenden
                            </button>
                            {dateFilterActive && (
                                <Link
                                    href={buildPirepsUrl(filterCtx, {
                                        range: null,
                                        from: null,
                                        to: null,
                                    })}
                                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline ml-1"
                                >
                                    × Datum zurücksetzen
                                </Link>
                            )}
                        </form>
                    </div>
                )}

                {pireps.length === 0 ? (
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
                        {/* Empty-state copy adapts to the active filter so
                            it's not misleading. "Keine PIREPs" when the
                            user actually has 5 unflagged ones would feel
                            buggy; the differentiated message tells them
                            exactly why the table is empty.

                            #74: Bei dateFilterActive (egal ob auch ein
                            flag-filter aktiv ist) zeigen wir die date-
                            empty-message — die ist meistens informativer
                            als "keine geflaggten" wenn der user grade die
                            letzten 7 tage filtert und nichts da ist. */}
                        {totalCount === 0 && !anyFilterActive ? (
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
                        ) : dateFilterActive ? (
                            <>
                                <p className="text-gray-500 dark:text-gray-400 mb-4">
                                    Keine PIREPs im gewählten Zeitraum
                                    {flagFilter !== 'all' &&
                                        ` mit ${flagFilter === 'with' ? 'Flag' : 'sauberer Übermittlung'}`}
                                    .
                                </p>
                                <Link
                                    href="/pireps"
                                    className="inline-block px-5 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                                >
                                    ← Alle Filter zurücksetzen
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
                                                            p.status === 'Draft' ? 'text-cyan-700 dark:text-cyan-400' :
                                                                'text-yellow-700 dark:text-yellow-400'
                                                }>
                                                    {p.status === 'Draft' ? 'Entwurf' : p.status}
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
