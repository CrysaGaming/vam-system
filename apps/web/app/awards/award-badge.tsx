import Link from 'next/link';
import type { Award } from '@vam/db';
import type { FamilyAnnotation } from './tier-detection';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Reusable award-badge component.
 *
 * Renders ein einzelnes award-tile mit icon (oder placeholder), name,
 * description und optional einem "earned"-indicator. Wird in mehreren
 * stellen verwendet — public catalog, user-profile-section, personal-
 * awards-page, admin-grant-picker — daher als shared component um
 * konsistenz zu sichern und den style-aufwand zu zentralisieren.
 *
 * Variants:
 *   - `linkable` (default true): rendert als Link zu /awards/[id]. Bei
 *     false rendert als plain div (z.B. in admin-pickers wo der click
 *     eine andere action triggert).
 *   - `earned` (default false): zeigt den "✓"-marker + leuchtenderen
 *     border. Wenn null/undefined wird neutral gerendert.
 *   - `awardedAt`: timestamp wenn earned, wird als untertitel rendered
 *     ("seit DD.MM.YYYY").
 *   - `size`: "default" oder "compact". Compact wird auf user-profile
 *     genutzt wo platz knapp ist.
 *   - `family` (option #16): tier-progression-info. Wenn gesetzt rendert
 *     der badge eine kleine "Tier 2/4 · 1 erhalten" zeile + segmented
 *     progress-bar. Erkennt der caller via `annotateFamilies()` aus
 *     `tier-detection.ts`. Single-tier awards lassen den prop weg.
 *
 * Icon-handling: iconUrl ist optional. Wenn null/undefined zeigen wir
 * einen 🏆-emoji als placeholder. Bewusst KEIN external image-load mit
 * next/image — die awards-icons sind unter user-control (admin uploads),
 * können externe URLs sein, und wir wollen kein image-optimization-
 * pipeline auf user-content. Plain <img> mit eslint-disable, analog
 * zum existing pattern (siehe twitch-thumbnail im pilot-profile).
 */
export function AwardBadge({
  award,
  earned = false,
  awardedAt = null,
  linkable = true,
  size = 'default',
  family = null,
}: {
  award: Pick<Award, 'id' | 'name' | 'description' | 'iconUrl'>;
  earned?: boolean;
  awardedAt?: Date | null;
  linkable?: boolean;
  size?: 'default' | 'compact';
  family?: FamilyAnnotation | null;
}) {
  const iconSize = size === 'compact' ? 'w-12 h-12' : 'w-16 h-16';
  const padding = size === 'compact' ? 'p-3' : 'p-4';

  const content = (
    <>
      <div className="flex items-start gap-3">
        <div
          className={`${iconSize} shrink-0 rounded-lg flex items-center justify-center overflow-hidden ${
            earned
              ? 'bg-amber-100 dark:bg-amber-900/30 ring-2 ring-amber-400 dark:ring-amber-500'
              : 'bg-gray-100 dark:bg-gray-800'
          }`}
        >
          {award.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-content URL, keine next/image-pipeline
            <img
              src={award.iconUrl}
              alt={`Icon für ${award.name}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className={size === 'compact' ? 'text-2xl' : 'text-3xl'} aria-hidden="true">
              🏆
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className={`font-semibold ${
                size === 'compact' ? 'text-sm' : 'text-base'
              } ${earned ? 'text-amber-900 dark:text-amber-100' : ''}`}
            >
              {award.name}
            </h3>
            {earned && (
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-xs font-bold"
                aria-label="Earned"
                title="Du hast diesen Award erhalten"
              >
                ✓
              </span>
            )}
          </div>
          {award.description && (
            <p
              className={`text-gray-600 dark:text-gray-400 mt-1 ${
                size === 'compact' ? 'text-xs line-clamp-2' : 'text-sm'
              }`}
            >
              {award.description}
            </p>
          )}
          {earned && awardedAt && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              Erhalten am{' '}
              {new Date(awardedAt).toLocaleDateString('de-DE', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          )}
          {/*
            Family-progression display (option #16). Nur sichtbar wenn
            der award teil einer 2+-tier-family ist (caller annotiert via
            annotateFamilies). Layout: kleine label-zeile mit
            "Vielflieger · Tier 2/4 · 1 erhalten", drunter ein segmented
            progress-bar — ein gefülltes segment pro tier den der user
            schon hat. Höhere tiers werden visuell heller (zukunftsweisend).
            Bewusst NICHT bei size=compact rendern; dort fehlt der platz.
          */}
          {family && size !== 'compact' && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-500">
                <span className="font-semibold text-gray-600 dark:text-gray-400">
                  {family.family}
                </span>
                {' · '}
                Tier {family.index}/{family.total}
                {family.earnedInFamily > 0 && (
                  <>
                    {' · '}
                    <span className="text-amber-600 dark:text-amber-400">
                      {family.earnedInFamily} erhalten
                    </span>
                  </>
                )}
              </p>
              <div className="flex gap-0.5 mt-1" aria-hidden="true">
                {Array.from({ length: family.total }).map((_, i) => {
                  // Segmente links → rechts, low → high tier. Filled
                  // wenn der user den jeweiligen tier-rank schon hat:
                  // wir wissen earnedInFamily aber nicht welche specific
                  // ranks earned sind. Konservativ: die ersten N
                  // segmente filled (low → high), wo N=earnedInFamily.
                  // Stimmt für die typischen "alle low-tiers erst, dann
                  // höhere"-progression-flow; wer einen high-tier ohne
                  // low-tiers erhalten hat (admin-quirk), sieht eine
                  // leicht falsche position-darstellung — aber die
                  // count-zahl in der label-zeile bleibt korrekt.
                  const isFilled = i < family.earnedInFamily;
                  const isCurrent = i === family.index - 1;
                  return (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-sm transition ${
                        isFilled
                          ? 'bg-amber-500 dark:bg-amber-400'
                          : isCurrent
                            ? 'bg-indigo-300 dark:bg-indigo-600 ring-1 ring-indigo-500/40'
                            : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  const baseClasses = `${padding} bg-white dark:bg-gray-900 border rounded-lg transition ${
    earned
      ? 'border-amber-300 dark:border-amber-700/50'
      : 'border-gray-200 dark:border-gray-800'
  }`;

  if (linkable) {
    return (
      <Link
        href={`/awards/${award.id}`}
        className={`${baseClasses} block hover:border-indigo-500 dark:hover:border-indigo-500 hover:shadow-sm`}
      >
        {content}
      </Link>
    );
  }

  return <div className={baseClasses}>{content}</div>;
}
