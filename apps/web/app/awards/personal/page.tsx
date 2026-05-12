import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  getUserAwards,
  listAwards,
  evaluateAllAwardsForUser,
  parseCriteria,
  type Award,
  type EvaluationResult,
} from '@vam/db';
import { AwardBadge } from '../award-badge';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Personal awards view ("Meine Awards").
 * Track 5 #7 (Section B, Criteria-DSL): erweitert um progress-section
 *   für noch nicht verdiente awards. Jedes award mit valider criteria
 *   das der user noch nicht hat zeigt einen progress-bar mit
 *   "73/100 Flüge"-style label.
 *
 * Layout:
 *   - Header mit count
 *   - Section "Erhalten" (earned, ≥1)
 *   - Section "In Arbeit" (criteria-awards mit progress, sorted by
 *     progress-percent desc — fast-erreichte oben)
 *   - Section "Catalog" link wenn beide sections leer
 *
 * Performance: evaluateAllAwardsForUser läuft ~N queries (eine pro
 * criteria-award). Bei kleinen catalogs (<30) trivial. Größere catalogs
 * würden batched-evaluation brauchen.
 */
export default async function PersonalAwardsPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  // Parallel fetch: earned awards + alle awards + progress-evals
  const [userAwards, allAwards, evaluations] = await Promise.all([
    getUserAwards(session.user.id),
    listAwards(),
    evaluateAllAwardsForUser(session.user.id),
  ]);

  // Build "in progress" list: alle awards die criteria haben UND der
  // user noch nicht besitzt UND noch nicht erfüllt sind (met=false).
  const earnedIds = new Set(userAwards.map((ua) => ua.awardId));
  const inProgress: Array<{ award: Award; evaluation: EvaluationResult }> = [];
  for (const award of allAwards) {
    if (earnedIds.has(award.id)) continue;
    const ev = evaluations.get(award.id);
    if (!ev) continue; // award hat keine valide criteria (manual-grant only)
    if (ev.met) continue; // theoretisch met aber noch nicht gegranted —
    // sollte selten passieren weil auto-grant nach approval läuft.
    // Wenn der user grade einen flight approved bekommt zwischen
    // auto-grant und page-load, kann das aber temporär passieren.
    inProgress.push({ award, evaluation: ev });
  }
  // Sort by progress-percent descending (fast-erreichte oben)
  inProgress.sort((a, b) => {
    const ap = a.evaluation.progress / a.evaluation.target;
    const bp = b.evaluation.progress / b.evaluation.target;
    return bp - ap;
  });

  const empty = userAwards.length === 0 && inProgress.length === 0;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <Link
            href="/awards"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 mb-2"
          >
            ← Alle Awards
          </Link>
          <h1 className="text-3xl font-bold">Meine Awards</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {userAwards.length === 0
              ? 'Du hast noch keine Awards erworben.'
              : userAwards.length === 1
                ? '1 Award erhalten'
                : `${userAwards.length} Awards erhalten`}
            {inProgress.length > 0 && ` · ${inProgress.length} in Arbeit`}
          </p>
        </header>

        {empty ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-6xl mb-4" aria-hidden="true">
              🏆
            </p>
            <h2 className="text-lg font-semibold mb-2">Noch keine Awards</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
              Awards werden teilweise automatisch vergeben (z.B. für Flugstunden,
              Landungen, besuchte Airports) und teilweise manuell vom Admin.
              Schau dir den Catalog an um zu sehen was alles möglich ist.
            </p>
            <Link
              href="/awards"
              className="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition"
            >
              Awards-Catalog ansehen →
            </Link>
          </section>
        ) : (
          <div className="space-y-8">
            {/* Earned section */}
            {userAwards.length > 0 && (
              <section>
                <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  Erhalten ({userAwards.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {userAwards.map((ua) => (
                    <AwardBadge
                      key={ua.id}
                      award={ua.award}
                      earned={true}
                      awardedAt={ua.awardedAt}
                      size="compact"
                    />
                  ))}
                </div>
              </section>
            )}

            {/* In-progress section */}
            {inProgress.length > 0 && (
              <section>
                <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  In Arbeit ({inProgress.length})
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Diese Awards werden automatisch vergeben sobald die
                  Criteria erfüllt sind. Sortiert nach Fortschritt.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {inProgress.map(({ award, evaluation }) => (
                    <ProgressCard
                      key={award.id}
                      award={award}
                      evaluation={evaluation}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Track 5 #7 — In-progress award card mit progress-bar.
 *
 * Spiegelt das visual von AwardBadge (compact) aber dimmed + mit
 * progress-bar darunter. Klickbar → links zur award-detail-page wo
 * der user sieht wer den award alles schon hat (motivations-effekt).
 */
function ProgressCard({
  award,
  evaluation,
}: {
  award: Award;
  evaluation: EvaluationResult;
}) {
  // Progress-percent: smoothLandingFpm ist inverted (kleiner = besser),
  // alle anderen sind direct ratio. Wir checken den kind über
  // parseCriteria — wenn smoothLandingFpm, dann ist progress=current
  // best-fpm und target=schwellwert (≤). Percent-richtung:
  //   - Direct: 0% bei progress=0, 100% bei progress=target
  //   - Inverted (smoothLandingFpm): 100% bei progress≤target, sonst
  //     skaliert (z.B. progress=200 target=100 → 50% weil "doppelt so
  //     weit weg vom ziel")
  const criteria = parseCriteria(award.criteria);
  const isInverted = criteria?.kind === 'smoothLandingFpm';

  let pct: number;
  if (isInverted) {
    if (evaluation.progress === 0) {
      pct = 0; // no data yet
    } else if (evaluation.progress <= evaluation.target) {
      pct = 100;
    } else {
      pct = Math.max(0, Math.min(100, (evaluation.target / evaluation.progress) * 100));
    }
  } else {
    pct = Math.max(
      0,
      Math.min(100, (evaluation.progress / evaluation.target) * 100),
    );
  }

  return (
    <Link
      href={`/awards/${award.id}`}
      className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-lg p-3 transition"
    >
      <div className="flex items-start gap-3">
        {award.iconUrl ? (
          <img
            src={award.iconUrl}
            alt=""
            className="w-12 h-12 rounded shrink-0 opacity-50 grayscale"
          />
        ) : (
          <div className="w-12 h-12 rounded shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl opacity-50">
            🏆
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {award.name}
          </p>
          {award.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
              {award.description}
            </p>
          )}
          <div className="mt-2">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] text-gray-500 tabular-nums">
                {evaluation.description}
              </span>
              <span className="text-[10px] text-gray-500 tabular-nums">
                {Math.round(pct)}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-indigo-500' : 'bg-gray-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
