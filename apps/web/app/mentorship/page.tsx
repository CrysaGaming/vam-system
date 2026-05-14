/**
 * Welle K / K4 — Browse available mentors.
 *
 * Route: /mentorship
 *
 * Server-component. Listet alle mentor-available pilots der eigenen
 * airline mit topic-filter. Click → /mentorship/<userId> für detail-
 * view + request-form.
 *
 * Cross-airline-discovery V1 NICHT supported (Mentorship.airlineId
 * NOT NULL constraint). Wer ohne airline ist, sieht eine empty-state.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ topic?: string }>;

export default async function MentorshipBrowsePage(props: { searchParams: SearchParams }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true },
  });
  if (!me) redirect('/');

  const sp = await props.searchParams;
  const topicFilter = sp.topic?.trim().toLowerCase() ?? null;

  if (!me.airlineId) {
    return (
      <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
        <div className="mx-auto max-w-3xl">
          <PageHeader />
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <div className="mb-3 text-5xl">✈️</div>
            <h2 className="text-lg font-semibold">Du brauchst eine Airline</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Mentor-matching ist airline-scoped. Tritt einer airline bei um
              hier mentors zu sehen.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const mentors = await prisma.user.findMany({
    where: {
      airlineId: me.airlineId,
      mentorAvailable: true,
      id: { not: me.id }, // sich selbst aussschließen
    },
    select: {
      id: true,
      name: true,
      mentorTopics: true,
      mentorBio: true,
      rank: { select: { name: true } },
      totalFlightHours: true,
    },
  });

  const filtered = topicFilter
    ? mentors.filter((m) =>
        m.mentorTopics.some((t) => t.toLowerCase().includes(topicFilter)),
      )
    : mentors;

  // Collect all unique topics for filter-chip suggestions
  const allTopics = new Set<string>();
  for (const m of mentors) {
    for (const t of m.mentorTopics) allTopics.add(t);
  }

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <PageHeader />

        <div className="mb-4 text-sm text-muted-foreground">
          {filtered.length} verfügbare mentor{filtered.length === 1 ? '' : 's'}{' '}
          in deiner airline.{' '}
          <Link
            href="/me/mentorship"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Selbst mentor werden →
          </Link>
        </div>

        {allTopics.size > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {topicFilter && (
              <Link
                href="/mentorship"
                className="rounded-md border border-border bg-card px-3 py-1 text-xs hover:border-indigo-400"
              >
                ✕ Filter clear
              </Link>
            )}
            {Array.from(allTopics)
              .sort()
              .slice(0, 20)
              .map((t) => (
                <Link
                  key={t}
                  href={`/mentorship?topic=${encodeURIComponent(t)}`}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    topicFilter === t.toLowerCase()
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                      : 'border-border bg-card hover:border-indigo-400'
                  }`}
                >
                  {t}
                </Link>
              ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">
              {mentors.length === 0
                ? 'Aktuell kein mentor in deiner airline verfügbar.'
                : 'Kein mentor passt zum topic-filter.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/mentorship/${m.id}`}
                      className="text-base font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {m.name ?? 'Pilot'}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {m.rank?.name && <span>{m.rank.name}</span>}
                      <span>· {Math.round(m.totalFlightHours)}h</span>
                    </div>
                    {m.mentorBio && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {m.mentorBio}
                      </p>
                    )}
                    {m.mentorTopics.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.mentorTopics.map((t) => (
                          <span
                            key={t}
                            className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/mentorship/${m.id}`}
                    className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Anfragen
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function PageHeader() {
  return (
    <header className="mb-6 border-b border-border pb-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Community
      </p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">🎓 Mentor finden</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Erfahrene pilots deiner airline die als mentor verfügbar sind.
      </p>
    </header>
  );
}
