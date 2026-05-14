/**
 * Welle K / K4 — Pilot's mentorship management page.
 *
 * Route: /me/mentorship
 *
 * 3 sections:
 *   1. Mentor-profile editor (toggle availability + topics + bio)
 *   2. Incoming requests (where I'm the mentor, status=PROPOSED)
 *      + Active mentorships I'm mentoring
 *   3. Outgoing requests (where I'm the mentee, status=PROPOSED)
 *      + Active mentorships where I'm being mentored
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import MentorProfileEditor from './_profile-editor';
import MentorshipActions from './_actions-buttons';

export const dynamic = 'force-dynamic';

export default async function MyMentorshipPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [me, asMentor, asMentee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        mentorAvailable: true,
        mentorTopics: true,
        mentorBio: true,
        airlineId: true,
      },
    }),
    prisma.mentorship.findMany({
      where: {
        mentorId: userId,
        status: { in: ['PROPOSED', 'ACTIVE'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        topics: true,
        notes: true,
        createdAt: true,
        startedAt: true,
        mentee: {
          select: {
            id: true,
            name: true,
            rank: { select: { name: true } },
            totalFlightHours: true,
          },
        },
      },
    }),
    prisma.mentorship.findMany({
      where: {
        menteeId: userId,
        status: { in: ['PROPOSED', 'ACTIVE'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        topics: true,
        notes: true,
        createdAt: true,
        startedAt: true,
        mentor: {
          select: {
            id: true,
            name: true,
            rank: { select: { name: true } },
            totalFlightHours: true,
          },
        },
      },
    }),
  ]);

  if (!me) redirect('/');

  const incomingPending = asMentor.filter((m) => m.status === 'PROPOSED');
  const myMentees = asMentor.filter((m) => m.status === 'ACTIVE');
  const outgoingPending = asMentee.filter((m) => m.status === 'PROPOSED');
  const myMentors = asMentee.filter((m) => m.status === 'ACTIVE');

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Community
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">🎓 Meine Mentorships</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mentor-profil bearbeiten + eingehende/ausgehende anfragen managen.{' '}
            <Link
              href="/mentorship"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Mentor finden →
            </Link>
          </p>
        </header>

        <MentorProfileEditor
          initial={{
            mentorAvailable: me.mentorAvailable,
            mentorTopics: me.mentorTopics,
            mentorBio: me.mentorBio ?? '',
          }}
        />

        {/* Als mentor */}
        {(incomingPending.length > 0 || myMentees.length > 0) && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Als Mentor
            </h2>

            {incomingPending.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  Eingehende Anfragen ({incomingPending.length})
                </p>
                {incomingPending.map((m) => (
                  <MentorshipCard
                    key={m.id}
                    mentorshipId={m.id}
                    counterpartyId={m.mentee.id}
                    counterpartyName={m.mentee.name ?? 'Pilot'}
                    counterpartyMeta={`${m.mentee.rank?.name ?? ''} · ${Math.round(m.mentee.totalFlightHours)}h`}
                    label="möchte deine mentee werden"
                    topics={m.topics}
                    notes={m.notes}
                    statusLabel="PROPOSED"
                    statusColor="yellow"
                    timestamp={m.createdAt}
                    actionMode="mentor-pending"
                  />
                ))}
              </div>
            )}

            {myMentees.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  Aktive Mentees ({myMentees.length})
                </p>
                {myMentees.map((m) => (
                  <MentorshipCard
                    key={m.id}
                    mentorshipId={m.id}
                    counterpartyId={m.mentee.id}
                    counterpartyName={m.mentee.name ?? 'Pilot'}
                    counterpartyMeta={`${m.mentee.rank?.name ?? ''} · ${Math.round(m.mentee.totalFlightHours)}h`}
                    label="ist deine mentee"
                    topics={m.topics}
                    notes={m.notes}
                    statusLabel="ACTIVE"
                    statusColor="green"
                    timestamp={m.startedAt ?? m.createdAt}
                    actionMode="mentor-active"
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Als mentee */}
        {(outgoingPending.length > 0 || myMentors.length > 0) && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Als Mentee
            </h2>

            {outgoingPending.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  Ausstehende Anfragen ({outgoingPending.length})
                </p>
                {outgoingPending.map((m) => (
                  <MentorshipCard
                    key={m.id}
                    mentorshipId={m.id}
                    counterpartyId={m.mentor.id}
                    counterpartyName={m.mentor.name ?? 'Pilot'}
                    counterpartyMeta={`${m.mentor.rank?.name ?? ''} · ${Math.round(m.mentor.totalFlightHours)}h`}
                    label="prüft deine anfrage"
                    topics={m.topics}
                    notes={m.notes}
                    statusLabel="PROPOSED"
                    statusColor="yellow"
                    timestamp={m.createdAt}
                  />
                ))}
              </div>
            )}

            {myMentors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  Aktive Mentors ({myMentors.length})
                </p>
                {myMentors.map((m) => (
                  <MentorshipCard
                    key={m.id}
                    mentorshipId={m.id}
                    counterpartyId={m.mentor.id}
                    counterpartyName={m.mentor.name ?? 'Pilot'}
                    counterpartyMeta={`${m.mentor.rank?.name ?? ''} · ${Math.round(m.mentor.totalFlightHours)}h`}
                    label="ist dein mentor"
                    topics={m.topics}
                    notes={m.notes}
                    statusLabel="ACTIVE"
                    statusColor="green"
                    timestamp={m.startedAt ?? m.createdAt}
                    actionMode="mentee-active"
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {asMentor.length === 0 && asMentee.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Du hast aktuell keine aktiven mentorships.{' '}
            <Link
              href="/mentorship"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Finde einen mentor →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function MentorshipCard({
  mentorshipId,
  counterpartyId,
  counterpartyName,
  counterpartyMeta,
  label,
  topics,
  notes,
  statusLabel,
  statusColor,
  timestamp,
  actionMode,
}: {
  mentorshipId: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyMeta: string;
  label: string;
  topics: string[];
  notes: string | null;
  statusLabel: string;
  statusColor: 'yellow' | 'green';
  timestamp: Date;
  actionMode?: 'mentor-pending' | 'mentor-active' | 'mentee-active';
}) {
  const statusClasses =
    statusColor === 'green'
      ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
      : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300';
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statusClasses}`}
            >
              {statusLabel}
            </span>
            <Link
              href={`/p/${counterpartyId}`}
              className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {counterpartyName}
            </Link>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{counterpartyMeta}</p>
          {topics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {topics.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {notes && (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/20 p-2 text-sm">
              {notes}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {timestamp.toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </p>
        </div>
        {actionMode && (
          <div className="shrink-0">
            <MentorshipActions mentorshipId={mentorshipId} mode={actionMode} />
          </div>
        )}
      </div>
    </div>
  );
}
