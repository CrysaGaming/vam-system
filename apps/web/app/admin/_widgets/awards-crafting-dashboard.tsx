import Link from 'next/link';
import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Vision §9.3.5 — Awards-Crafting-System (Dashboard-Widget).
 *
 * # Was ist hier — und was nicht (v1)
 *
 * v1 ist ein STATUS-WIDGET das dem admin auf einen blick zeigt:
 *   - Wie viele award-typen sind im katalog?
 *   - Wie viele awards wurden bisher vergeben?
 *   - Welche awards werden am häufigsten vergeben? (top-3)
 *   - Was wurde in den letzten 7 tagen vergeben? (recent feed)
 *   - Quick-link zur full /admin/awards CRUD-page
 *
 * Bewusst NICHT in v1 (eigene tickets):
 *   - Auto-grant-engine: Criteria-JSON automatisch evaluieren bei
 *     PIREP-approve (z.B. "100 hours" award triggert sobald
 *     User.totalFlightHours >= 100). Das `criteria`-field auf Award
 *     existiert schon im schema, wird aber aktuell nur als doku
 *     gespeichert. Engine die das ausführt = eigenes ticket weil
 *     scoring + de-dup + race-conditions
 *   - Award-templates / "1-click crafting": gallery von vordefinierten
 *     awards (Flight-hours-milestones, airport-visit, route-specialist)
 *     die der admin nur klickt um sie zum katalog zu adden. Eigenes
 *     ticket weil das eine template-library mit defaults braucht.
 *   - Award-icon-upload: aktuell ist Award.iconUrl ein freier string
 *     (CDN-link). Eigentlicher uploader = upload-flow + storage-config.
 *
 * # Why dashboard-widget statt nur /admin/awards-link?
 *
 * Awards sind ein engagement-tool — admin will pulse-monitoring ohne
 * deep-dive. "5 neue grants heute, 2 davon pilot-of-the-month" ist
 * mehr-info als nur "/admin/awards".
 */
export async function AwardsCraftingDashboard() {
  // 4 parallele queries — alle cheap (cached durchs page-revalidate).
  const [totalAwards, totalGrants, topAwards, recentGrants] = await Promise.all([
    prisma.award.count(),
    prisma.userAward.count(),
    // Top-3 most-awarded — aggregat per award-id, dann hydrate award-data
    prisma.userAward.groupBy({
      by: ['awardId'],
      _count: { _all: true },
      orderBy: { _count: { awardId: 'desc' } },
      take: 3,
    }),
    // Last-5-grants in den letzten 7 tagen für recent-feed
    prisma.userAward.findMany({
      where: {
        awardedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { awardedAt: 'desc' },
      take: 5,
      include: {
        user: { select: { id: true, name: true } },
        award: { select: { name: true, iconUrl: true } },
      },
    }),
  ]);

  // Hydrate top-awards mit den award-records (groupBy returnt nur ids)
  const topAwardIds = topAwards.map((t) => t.awardId);
  const topAwardRecords =
    topAwardIds.length > 0
      ? await prisma.award.findMany({
          where: { id: { in: topAwardIds } },
          select: { id: true, name: true, iconUrl: true },
        })
      : [];
  const topAwardMap = new Map(topAwardRecords.map((a) => [a.id, a]));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span aria-hidden="true">🏅</span>
              <span>Awards</span>
            </CardTitle>
            <CardDescription>
              Award-typen + recent-grants — engagement-puls über alle airlines.
            </CardDescription>
          </div>
          <Link
            href="/admin/awards"
            className="shrink-0 text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-90 transition"
          >
            Verwalten →
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats-grid: 2 KPIs side-by-side */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{totalAwards}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Award-Typen
            </p>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{totalGrants}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              vergeben
            </p>
          </div>
        </div>

        {/* Top-3 most-awarded */}
        {topAwards.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
              Top-3 vergeben
            </p>
            <ol className="space-y-1">
              {topAwards.map((entry, idx) => {
                const award = topAwardMap.get(entry.awardId);
                if (!award) return null;
                return (
                  <li
                    key={entry.awardId}
                    className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                  >
                    <span className="shrink-0 w-5 text-center font-bold text-gray-400 dark:text-gray-600 tabular-nums">
                      {idx + 1}
                    </span>
                    <AwardIcon iconUrl={award.iconUrl} fallback="🏆" />
                    <span className="flex-1 truncate">{award.name}</span>
                    <span className="shrink-0 text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">
                      {entry._count._all}×
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Recent-grants feed — letzte 7 tage */}
        {recentGrants.length > 0 ? (
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
              Letzte 7 Tage
            </p>
            <ul className="space-y-1.5">
              {recentGrants.map((grant) => (
                <li key={grant.id} className="text-xs flex items-center gap-2">
                  <AwardIcon iconUrl={grant.award.iconUrl} fallback="🎖️" />
                  <Link
                    href={`/pilots/${grant.user.id}`}
                    className="font-medium hover:underline"
                  >
                    {grant.user.name}
                  </Link>
                  <span className="text-gray-500 dark:text-gray-400">erhielt</span>
                  <span className="font-medium truncate">{grant.award.name}</span>
                  <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-600 tabular-nums">
                    {formatRelative(grant.awardedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : totalAwards === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-3 text-center">
            Noch keine Awards angelegt.{' '}
            <Link href="/admin/awards" className="text-primary hover:underline">
              Ersten Award erstellen →
            </Link>
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center">
            Keine grants in den letzten 7 Tagen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Award-icon helper: nutzt iconUrl wenn vorhanden, sonst fallback-emoji.
 * iconUrl ist meistens ein gepachstes Discord-emoji oder CDN-svg —
 * 24x24px sieht in der widget-row gut aus.
 */
function AwardIcon({
  iconUrl,
  fallback,
}: {
  iconUrl: string | null;
  fallback: string;
}) {
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        className="w-5 h-5 object-contain shrink-0"
        loading="lazy"
      />
    );
  }
  return (
    <span className="shrink-0 text-base" aria-hidden="true">
      {fallback}
    </span>
  );
}

/**
 * "vor 2h", "vor 3 tagen" — kompakte deutsche relative-zeit. Braucht
 * kein i18n-lib weil nur wenige stufen.
 */
function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'gerade';
  if (diffMin < 60) return `vor ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `vor ${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `vor ${diffDay}d`;
}
