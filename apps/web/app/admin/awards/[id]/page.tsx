import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma, getAwardWithRecipients } from '@vam/db';
import { GrantRevokeAwardButton } from '../admin-forms';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Admin award detail / pilot-grant page.
 *
 * Per-award page wo der admin entscheidet wer den award bekommt. Listet
 * ALLE airline-pilots (member-only — wir vergeben awards nicht an
 * non-airline-mitglieder) und zeigt pro pilot ein grant/revoke-button.
 *
 * Filter: nur user mit airlineId !== null. Search-by-name als
 * client-side-filter wäre nice-to-have, aber für MVP mit ~30-50 pilots
 * reicht visual scanning. Wenn die liste mal lang wird, kann ein
 * suchfeld nachgerüstet werden.
 *
 * Sortierung: airline-pilots alphabetisch nach name (oder displayName-
 * fallback). Gibt eine stable order und man findet bekannte piloten
 * schnell.
 */
export default async function AdminAwardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const adminUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!adminUser?.role || adminUser.role.name !== 'admin') {
    redirect('/dashboard');
  }

  const { id } = await params;
  const award = await getAwardWithRecipients(id);
  if (!award) notFound();

  // Set der userIds die den award schon haben (für O(1)-lookup im
  // pilot-render-loop).
  const earnedUserIds = new Set(award.recipients.map((r) => r.user.id));

  // Alle airline-pilots laden. Wir filtern auf airlineId !== null —
  // user die nicht zu einer airline gehören (z.B. discord-only-members
  // ohne pilot-status) sehen wir nicht. Per requirement: awards sind
  // ein pilot-feature.
  const pilots = await prisma.user.findMany({
    where: { airlineId: { not: null } },
    select: {
      id: true,
      name: true,
      image: true,
      airlineId: true,
    },
    orderBy: [{ name: 'asc' }],
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <Link
            href="/admin/awards"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1"
          >
            ← Awards-Verwaltung
          </Link>
        </header>

        {/* Award-info hero */}
        <section className="bg-white dark:bg-gray-900 border-2 border-amber-300 dark:border-amber-700/50 rounded-xl p-6 mb-6">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-20 h-20 shrink-0 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center overflow-hidden">
              {award.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-content
                <img
                  src={award.iconUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-4xl" aria-hidden="true">
                  🏆
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold mb-1">{award.name}</h1>
              {award.description && (
                <p className="text-gray-700 dark:text-gray-300 mb-2 text-sm">
                  {award.description}
                </p>
              )}
              <p className="text-xs text-gray-500">
                {award.recipients.length === 0
                  ? 'Noch nicht vergeben'
                  : award.recipients.length === 1
                    ? '1 pilot hat diesen Award'
                    : `${award.recipients.length} piloten haben diesen Award`}{' '}
                · {pilots.length} airline-pilots insgesamt
              </p>
            </div>
            <Link
              href={`/awards/${award.id}`}
              className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded font-medium transition"
            >
              Public-View →
            </Link>
          </div>
        </section>

        {/* Pilot-liste mit grant/revoke buttons */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Piloten · Award-Status
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              "Vergeben" sendet eine Discord-Notification in #awards (nur
              bei first-time grants).
            </p>
          </header>

          {pilots.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                Keine airline-pilots gefunden.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {pilots.map((pilot) => {
                const earned = earnedUserIds.has(pilot.id);
                return (
                  <li
                    key={pilot.id}
                    className={`p-4 flex items-center gap-4 ${
                      earned ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''
                    }`}
                  >
                    {pilot.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- discord avatar
                      <img
                        src={pilot.image}
                        alt={pilot.name ?? 'Avatar'}
                        className="w-10 h-10 rounded-full shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/pilots/${pilot.id}`}
                        className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400 transition inline-flex items-center gap-2"
                      >
                        {pilot.name ?? 'Unbenannt'}
                        {earned && (
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                            ✓
                          </span>
                        )}
                      </Link>
                    </div>
                    <GrantRevokeAwardButton
                      awardId={award.id}
                      userId={pilot.id}
                      earned={earned}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
