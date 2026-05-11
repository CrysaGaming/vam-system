import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma, computeRuntimeStatus, type EventKind } from '@vam/db';

/**
 * Track 4 #96 (Section S) — Event-Recap-Page.
 *
 * /events/[slug]/recap — post-event-stats für COMPLETED/ENDED events.
 * Zeigt teilnehmer-zahlen, completion-rate, geflogene PIREPs +
 * stunden (im event-zeitfenster), und top-completers-leaderboard.
 *
 * # Eligibility
 *
 * Nur für events deren runtime-status COMPLETED ODER ENDED ist —
 * der recap macht keinen sinn für UPCOMING/IN_PROGRESS events
 * (kein \"after\" zum recapen). DRAFTs sind admin-only und haben
 * separat noch keinen recap.
 *
 * # Stats-quellen
 *
 * 1. EventParticipant aggregate — count + completedCount + completion-
 *    rate. Direkt aus participations-table.
 * 2. PIREPs der teilnehmer im event-fenster — approved PIREPs von
 *    EventParticipant.userId zwischen event.startsAt und event.endsAt
 *    (oder ohne endsAt: zwischen startsAt und now). Liefert flugs-
 *    count + total-flight-time.
 * 3. Top 5 completers — sortiert nach completedAt asc (early-bird-
 *    recognition).
 *
 * # Out-of-scope für v1
 *
 * - Per-leg-completion-stats für TOUR (welcher leg von wem geflogen):
 *   würde PIREP-route-matching erfordern, eigene welle.
 * - Per-participant-flight-stats: möglich aber UI-overflow für viele
 *   teilnehmer. Top-5 reicht für den \"recap-vibe\".
 * - Photo-gallery, kommentare: separate welle (#99 Event-Comments).
 */

interface Props {
  params: Promise<{ slug: string }>;
}

const KIND_LABELS: Record<EventKind, string> = {
  TOUR: 'Tour',
  SINGLE_FLIGHT: 'Single-Flight',
  THEMED: 'Themen-Event',
  GROUP_FLIGHT: 'Group-Flight',
  SEASONAL: 'Saison-Event',
};

const KIND_ICONS: Record<EventKind, string> = {
  TOUR: '🗺️',
  SINGLE_FLIGHT: '✈️',
  THEMED: '🎨',
  GROUP_FLIGHT: '👥',
  SEASONAL: '🎄',
};

export default async function EventRecapPage({ params }: Props) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/');

  // Fetch event + multi-tenant gate. Recap ist sichtbar für member
  // der event-airline (oder bei VA-wide events: alle).
  const [event, currentUser] = await Promise.all([
    prisma.event.findUnique({
      where: { slug },
      include: {
        airline: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, image: true } },
        _count: { select: { participants: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { airlineId: true },
    }),
  ]);

  if (!event) notFound();

  // Multi-tenant scope: airline-event ist nur für member dieser airline
  // sichtbar; VA-wide events (airlineId=null) für alle.
  if (event.airlineId && event.airlineId !== currentUser?.airlineId) {
    notFound();
  }

  // Eligibility: nur COMPLETED oder ENDED — recap macht keinen sinn
  // für noch nicht durch-events.
  const runtimeStatus = computeRuntimeStatus(
    event.status,
    event.startsAt,
    event.endsAt,
  );
  if (runtimeStatus !== 'COMPLETED' && runtimeStatus !== 'ENDED') {
    redirect(`/events/${slug}`);
  }

  // Parallel: participants + PIREPs im event-fenster
  // PIREPs: approved, von event-participants, submittedAt im fenster.
  // Wenn endsAt null (open-ended themed): nutze now als ende.
  const eventEnd = event.endsAt ?? new Date();

  const [participants, piireps] = await Promise.all([
    prisma.eventParticipant.findMany({
      where: { eventId: event.id },
      orderBy: { joinedAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    }),
    // Kein query wenn keine participants — vermeidet teuren IN ()
    prisma.eventParticipant
      .findMany({
        where: { eventId: event.id },
        select: { userId: true },
      })
      .then(async (rows) => {
        if (rows.length === 0) return [];
        return prisma.pirep.findMany({
          where: {
            userId: { in: rows.map((r) => r.userId) },
            status: 'Approved',
            submittedAt: {
              gte: event.startsAt,
              lte: eventEnd,
            },
          },
          select: {
            id: true,
            userId: true,
            flightTimeMin: true,
            submittedAt: true,
          },
        });
      }),
  ]);

  const participantCount = participants.length;
  const completedCount = participants.filter((p) => p.completed).length;
  const completionRate =
    participantCount > 0
      ? Math.round((completedCount / participantCount) * 100)
      : 0;

  const flightCount = piireps.length;
  const totalFlightHours =
    piireps.reduce((sum, p) => sum + (p.flightTimeMin ?? 0), 0) / 60;

  // Per-user flight-stats für leaderboard
  const flightsByUser = new Map<
    string,
    { count: number; hours: number }
  >();
  for (const p of piireps) {
    const existing = flightsByUser.get(p.userId) ?? { count: 0, hours: 0 };
    existing.count += 1;
    existing.hours += (p.flightTimeMin ?? 0) / 60;
    flightsByUser.set(p.userId, existing);
  }

  // Top completers: sortiert nach completedAt asc (early-bird)
  const completers = participants
    .filter((p) => p.completed && p.completedAt)
    .sort((a, b) => {
      const ta = a.completedAt!.getTime();
      const tb = b.completedAt!.getTime();
      return ta - tb;
    })
    .slice(0, 10);

  // Total bonus payout (bonusReward × completedCount)
  // Decimal in prisma kommt als string/Decimal-class; .toNumber() reicht
  const bonusReward = Number(event.bonusReward);
  const totalBonusPayout = bonusReward * completedCount;

  // Parse legs JSON für TOUR-events
  const legs: Array<{ icao?: string; label?: string; note?: string }> =
    Array.isArray(event.legs) ? (event.legs as unknown[]).filter(
      (l): l is { icao?: string; label?: string; note?: string } =>
        typeof l === 'object' && l !== null,
    ) : [];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Back-link */}
        <Link
          href={`/events/${slug}`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4 inline-block"
        >
          ← Zurück zum Event
        </Link>

        {/* Header */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-baseline gap-2 mb-2">
            <span
              className="text-xs uppercase tracking-wide font-semibold text-indigo-700 dark:text-indigo-400"
              aria-label="Recap-Marker"
            >
              📊 Event-Recap
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {runtimeStatus === 'COMPLETED' ? 'Abgeschlossen' : 'Beendet'}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {event.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            <span>
              <span aria-hidden="true">{KIND_ICONS[event.kind]}</span>{' '}
              {KIND_LABELS[event.kind]}
            </span>
            <span>
              {event.startsAt.toLocaleDateString('de-DE')}
              {event.endsAt &&
                ` – ${event.endsAt.toLocaleDateString('de-DE')}`}
            </span>
            {event.airline && <span>· {event.airline.name}</span>}
          </div>
        </header>

        {/* Summary cards: 4 columns of stats */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <SummaryCard
            label="Teilnehmer"
            value={participantCount.toString()}
            sublabel={
              participantCount === 1 ? '1 Anmeldung' : `${participantCount} Anmeldungen`
            }
          />
          <SummaryCard
            label="Abgeschlossen"
            value={`${completionRate}%`}
            sublabel={`${completedCount} von ${participantCount}`}
            accent={completionRate >= 50}
          />
          <SummaryCard
            label="Flüge im Fenster"
            value={flightCount.toString()}
            sublabel="approved PIREPs"
          />
          <SummaryCard
            label="Gesamt-Stunden"
            value={totalFlightHours.toFixed(1)}
            sublabel="alle teilnehmer"
          />
        </section>

        {/* Bonus payout (if applicable) */}
        {bonusReward > 0 && (
          <section className="mb-8 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 rounded-lg p-5">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-2xl" aria-hidden="true">
                💰
              </span>
              <div>
                <h2 className="text-lg font-bold text-amber-900 dark:text-amber-200">
                  Bonus-Ausschüttung
                </h2>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {bonusReward.toLocaleString('de-DE')} VAM$ × {completedCount}{' '}
                  completers ={' '}
                  <strong>
                    {totalBonusPayout.toLocaleString('de-DE')} VAM$
                  </strong>{' '}
                  insgesamt ausgezahlt.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Two-column grid: completers links, tour-legs rechts */}
        <div
          className={`grid grid-cols-1 ${event.kind === 'TOUR' && legs.length > 0 ? 'lg:grid-cols-3' : ''} gap-6 mb-8`}
        >
          {/* Top completers */}
          <section
            className={`${event.kind === 'TOUR' && legs.length > 0 ? 'lg:col-span-2' : ''} bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5`}
          >
            <h2 className="text-lg font-semibold mb-1">
              🥇 Top-Completers
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
              Sortiert nach completion-zeitpunkt (early-bird first). Top 10.
            </p>
            {completers.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                Noch keine completion-flags gesetzt. Admin kann teilnehmer
                via{' '}
                <Link
                  href={`/admin/events/${event.id}`}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  /admin/events
                </Link>{' '}
                completieren.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {completers.map((p, idx) => {
                  const userStats = flightsByUser.get(p.user.id);
                  return (
                    <li
                      key={p.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded ${
                        idx === 0
                          ? 'bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-300 dark:border-yellow-500/40'
                          : idx === 1
                            ? 'bg-gray-50 dark:bg-gray-900/50 border border-gray-300 dark:border-gray-700'
                            : idx === 2
                              ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40'
                              : 'bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <span
                        className="text-base shrink-0 w-6 text-center"
                        aria-hidden="true"
                      >
                        {idx === 0
                          ? '🥇'
                          : idx === 1
                            ? '🥈'
                            : idx === 2
                              ? '🥉'
                              : `${idx + 1}.`}
                      </span>
                      {p.user.image ? (
                        <picture className="shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.user.image}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-800"
                          />
                        </picture>
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-400 shrink-0"
                          aria-hidden="true"
                        >
                          {(p.user.name ?? '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate">
                          {p.user.name ?? 'Anonym'}
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-500">
                          {p.completedAt!.toLocaleDateString('de-DE')}
                          {userStats && userStats.count > 0 && (
                            <span className="ml-2">
                              · {userStats.count} flight
                              {userStats.count === 1 ? '' : 's'} ·{' '}
                              {userStats.hours.toFixed(1)} h
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Tour-legs display (nur für TOUR mit legs) */}
          {event.kind === 'TOUR' && legs.length > 0 && (
            <aside className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
              <h2 className="text-lg font-semibold mb-1">🗺️ Tour-Route</h2>
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">
                Geplante legs des events
              </p>
              <ol className="space-y-1.5">
                {legs.map((leg, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-violet-50 dark:bg-violet-500/10 border border-violet-300 dark:border-violet-500/40 text-sm"
                  >
                    <span className="font-mono text-xs text-violet-700 dark:text-violet-300 font-bold w-6 shrink-0">
                      {idx + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      {leg.icao && (
                        <span className="font-mono font-bold text-violet-900 dark:text-violet-200">
                          {leg.icao}
                        </span>
                      )}
                      {leg.label && (
                        <span className="text-xs text-violet-700 dark:text-violet-300 ml-2">
                          {leg.label}
                        </span>
                      )}
                      {leg.note && (
                        <p className="text-[10px] text-violet-600 dark:text-violet-400 italic mt-0.5">
                          {leg.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          )}
        </div>

        {/* Info footer */}
        <aside className="bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Statistik-fenster:
            </strong>{' '}
            Approved PIREPs der teilnehmer mit submittedAt zwischen{' '}
            {event.startsAt.toLocaleDateString('de-DE')} und{' '}
            {eventEnd.toLocaleDateString('de-DE')}.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Completion-flag:
            </strong>{' '}
            Wird vom admin manuell pro teilnehmer gesetzt (über
            /admin/events/[id]). V2 könnte das per PIREP-matching
            automatisieren.
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  sublabel: string;
  accent?: boolean;
}

function SummaryCard({ label, value, sublabel, accent }: SummaryCardProps) {
  return (
    <div
      className={`border rounded-lg p-4 ${
        accent
          ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
      }`}
    >
      <p
        className={`text-xs uppercase tracking-wide font-medium ${
          accent
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {label}
      </p>
      <p
        className={`text-2xl font-bold font-mono mt-1 ${
          accent ? 'text-emerald-900 dark:text-emerald-200' : ''
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">
        {sublabel}
      </p>
    </div>
  );
}
