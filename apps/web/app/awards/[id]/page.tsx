import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAwardWithRecipients, prisma } from '@vam/db';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Award detail page.
 *
 * Zeigt einen einzelnen award + die liste der user die ihn erworben
 * haben (sortiert nach awardedAt desc, neueste zuerst — "wall of fame"-
 * leseperspektive). Wenn der eingeloggte user den award hat, wird er
 * in der liste mit "(Du)" markiert.
 *
 * Auth: member-only (login redirect → /).
 *
 * Avatars: das User-model hat ein `image`-feld (von OAuth-providern wie
 * discord). Fallback-placeholder wenn null. Plain <img> mit eslint-
 * disable wegen externer URLs (kein next/image-pipeline für user-avatars).
 *
 * Recipient-list: limitierung auf z.B. 200 wäre sinnvoll wenn awards
 * mal 1000+ recipients haben, aber im MVP ist die liste eh nicht so
 * lang. Wenn relevant: pagination via take/skip + page-param. Für jetzt
 * full list.
 */
export default async function AwardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const { id } = await params;
  const award = await getAwardWithRecipients(id);
  if (!award) notFound();

  const currentUserId = session.user.id;
  const earnedByCurrentUser = award.recipients.find(
    (r) => r.user.id === currentUserId,
  );

  // Admin-check für edit-link rendering.
  const currentUser = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { role: { select: { name: true } } },
  });
  const isAdmin = currentUser?.role?.name === 'admin';

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <Link
            href="/awards"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1"
          >
            ← Alle Awards
          </Link>
        </header>

        {/* Hero-card: icon + name + description */}
        <section
          className={`bg-white dark:bg-gray-900 border-2 rounded-xl p-8 mb-6 ${
            earnedByCurrentUser
              ? 'border-amber-400 dark:border-amber-600'
              : 'border-gray-200 dark:border-gray-800'
          }`}
        >
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <div
              className={`w-32 h-32 shrink-0 rounded-xl flex items-center justify-center overflow-hidden ${
                earnedByCurrentUser
                  ? 'bg-amber-100 dark:bg-amber-900/30'
                  : 'bg-gray-100 dark:bg-gray-800'
              }`}
            >
              {award.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-content
                <img
                  src={award.iconUrl}
                  alt={`Icon für ${award.name}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-6xl" aria-hidden="true">
                  🏆
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-3xl font-bold">{award.name}</h1>
                {earnedByCurrentUser && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500 text-white text-xs font-bold">
                    ✓ Du hast diesen Award
                  </span>
                )}
              </div>
              {award.description && (
                <p className="text-gray-700 dark:text-gray-300 mb-4">
                  {award.description}
                </p>
              )}
              <p className="text-xs text-gray-500">
                Definiert am{' '}
                {new Date(award.createdAt).toLocaleDateString('de-DE', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              {earnedByCurrentUser && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Erhalten am{' '}
                  {new Date(earnedByCurrentUser.awardedAt).toLocaleDateString(
                    'de-DE',
                    { year: 'numeric', month: 'long', day: 'numeric' },
                  )}
                </p>
              )}
              {isAdmin && (
                <Link
                  href={`/admin/awards`}
                  className="inline-block mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Im Admin verwalten →
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* Recipients-section */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Wall of Fame
            </h2>
            <span className="text-xs text-gray-500">
              {award.recipients.length === 0
                ? 'Noch niemand'
                : award.recipients.length === 1
                  ? '1 pilot'
                  : `${award.recipients.length} piloten`}
            </span>
          </div>

          {award.recipients.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              Diesen Award hat noch niemand erhalten — sei der erste!
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {award.recipients.map((recipient) => {
                const isMe = recipient.user.id === currentUserId;
                return (
                  <li
                    key={recipient.userAwardId}
                    className="py-3 flex items-center gap-4"
                  >
                    {recipient.user.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- avatar-CDN
                      <img
                        src={recipient.user.image}
                        alt={recipient.user.name ?? 'Avatar'}
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/pilots/${recipient.user.id}`}
                        className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400 transition inline-flex items-center gap-2"
                      >
                        {recipient.user.name ?? 'Unbenannt'}
                        {isMe && (
                          <span
                            style={{ backgroundColor: '#6366f1' }}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                          >
                            Du
                          </span>
                        )}
                      </Link>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(recipient.awardedAt).toLocaleDateString(
                        'de-DE',
                        { year: 'numeric', month: 'short', day: 'numeric' },
                      )}
                    </span>
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
