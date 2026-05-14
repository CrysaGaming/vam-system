/**
 * Welle K / K4 — Mentor profile + request page.
 *
 * Route: /mentorship/[mentorId]
 *
 * Lädt das mentor-profil + zeigt die request-form. Gated:
 *   - Mentor muss mentorAvailable=true sein
 *   - Mentor + viewer müssen in derselben airline sein
 * Sonst notFound() (kein info-leak).
 */

import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import MentorshipRequestForm from './_request-form';

export const dynamic = 'force-dynamic';

type Params = Promise<{ mentorId: string }>;

export default async function MentorProfilePage(props: { params: Params }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true },
  });
  if (!me?.airlineId) notFound();

  const { mentorId } = await props.params;

  const mentor = await prisma.user.findUnique({
    where: { id: mentorId },
    select: {
      id: true,
      name: true,
      airlineId: true,
      mentorAvailable: true,
      mentorTopics: true,
      mentorBio: true,
      totalFlightHours: true,
      totalFlights: true,
      rank: { select: { name: true } },
      airline: { select: { icao: true, name: true } },
    },
  });

  if (
    !mentor ||
    !mentor.mentorAvailable ||
    mentor.airlineId !== me.airlineId ||
    mentor.id === me.id
  ) {
    notFound();
  }

  // Check existing mentorship: wenn bereits PROPOSED/ACTIVE, kein
  // request-form zeigen sondern hinweis.
  const existing = await prisma.mentorship.findFirst({
    where: {
      mentorId: mentor.id,
      menteeId: me.id,
      status: { in: ['PROPOSED', 'ACTIVE'] },
    },
    select: { id: true, status: true },
  });

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/mentorship"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur mentor-liste
          </Link>
        </nav>

        <header className="mb-6 rounded-lg border border-border bg-card p-5">
          <h1 className="text-2xl font-bold">{mentor.name ?? 'Pilot'}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {mentor.rank?.name && <span>{mentor.rank.name}</span>}
            {mentor.airline?.icao && (
              <span className="font-mono">
                · {mentor.airline.icao} {mentor.airline.name}
              </span>
            )}
            <span>· {Math.round(mentor.totalFlightHours)}h</span>
            <span>· {mentor.totalFlights} Flüge</span>
          </div>

          {mentor.mentorBio && (
            <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">
              {mentor.mentorBio}
            </p>
          )}

          {mentor.mentorTopics.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Topics
              </p>
              <div className="flex flex-wrap gap-1">
                {mentor.mentorTopics.map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <Link
              href={`/p/${mentor.id}`}
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Vollständiges pilot-profil →
            </Link>
          </div>
        </header>

        {existing ? (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-5 text-sm text-yellow-800 dark:text-yellow-200">
            Du hast bereits eine <strong>{existing.status}</strong>-mentorship
            mit diesem mentor. Auf{' '}
            <Link
              href="/me/mentorship"
              className="font-semibold underline"
            >
              /me/mentorship
            </Link>{' '}
            kannst du sie managen.
          </div>
        ) : (
          <MentorshipRequestForm
            mentorId={mentor.id}
            suggestedTopics={mentor.mentorTopics}
          />
        )}
      </div>
    </main>
  );
}
