import { prisma } from '@vam/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NotificationCenterForm } from './notification-center-form';

/**
 * Vision §9.3.10 — Notification-Center (Item 8/10).
 *
 * # Was ist hier — und was nicht (v1)
 *
 * v1 hat zwei aufgaben für den admin:
 *   - SENDEN: kompose-form (broadcast oder per-user) — siehe
 *     NotificationCenterForm (client-component für useActionState).
 *   - SEHEN: feed der zuletzt-gesendeten notifications (last 10).
 *     Server-rendered weil prisma-query.
 *
 * Bewusst NICHT in v1 (eigene tickets):
 *   - Pilot-side rendering (badge im sidebar-header + drawer mit
 *     gelesen/ungelesen-toggle). Das ist eigenständig groß genug —
 *     useReadStateAction, drawer-component, badge-counter im AppShell.
 *   - Per-airline-broadcast: braucht audience-resolver + entweder
 *     N-row-write oder neues `audienceAirlineId`-feld auf dem schema.
 *   - Schedule/queue.
 *   - Edit/delete von gesendeten notifications (use-case dünn — neu-
 *     senden mit korrektur reicht).
 *
 * # Why dashboard-widget?
 *
 * Notifications sind ein day-1-tool für admins. Beim onboarding eines
 * neuen pilots will man "Willkommen, hier ist dein erstes route-pack"
 * schnell schicken können — ohne nav zu /admin/notifications. Das form
 * direkt im dashboard-widget hält die friction unter 5 sekunden.
 *
 * # Auth
 *
 * Wird nur in admin/page.tsx gerendert; die page selbst gated mit
 * requireAdminPage(). Das form schlägt zusätzlich requireAdmin() in der
 * action — defense-in-depth falls jemand das form-component irgendwo
 * anders mountet.
 */
export async function NotificationCenter() {
  // Letzte 10 gesendete notifications. Recipient-name wird ge-joined
  // damit "An: Pilot XYZ" angezeigt wird statt cryptic cuid.
  const recent = await prisma.adminNotification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      recipient: { select: { id: true, name: true } },
      author: { select: { id: true, name: true } },
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden="true">📬</span>
          <span>Notification-Center</span>
        </CardTitle>
        <CardDescription>
          Sende broadcasts an alle piloten oder direktnachrichten an einzelne
          (vision §9.3.10, Track 3 #11.2.5 Item 8/10)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Send-form (client-component für useActionState) */}
        <NotificationCenterForm />

        {/* Recent-sent feed */}
        <div>
          <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
            Zuletzt gesendet
          </h3>
          {recent.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              Noch keine notifications. Die erste oben senden.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.map((n) => (
                <li
                  key={n.id}
                  className="border-l-2 border-gray-300 dark:border-gray-700 pl-3 py-1"
                  style={{
                    borderLeftColor: kindColor(n.kind),
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {kindIcon(n.kind)} {n.title}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-500 whitespace-nowrap">
                      {formatRelative(n.createdAt)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">
                    {n.body}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
                    {n.recipient ? (
                      <>An: {n.recipient.name ?? 'Unbenannt'}</>
                    ) : (
                      <>📢 Broadcast (alle piloten)</>
                    )}
                    {n.author?.name ? ` · von ${n.author.name}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Kind → border-color (links from notification-row). Stimmt mit den
 * canonical-werten aus action-schema überein. Unbekannte kinds fallen
 * auf neutral grau.
 */
function kindColor(kind: string): string {
  switch (kind) {
    case 'warning':
      return '#f59e0b'; // amber-500
    case 'success':
      return '#22c55e'; // green-500
    case 'event':
      return '#a855f7'; // purple-500
    case 'info':
    default:
      return '#6b7280'; // gray-500
  }
}

/**
 * Kind → emoji-prefix vor titel.
 */
function kindIcon(kind: string): string {
  switch (kind) {
    case 'warning':
      return '⚠️';
    case 'success':
      return '✅';
    case 'event':
      return '📅';
    case 'info':
    default:
      return 'ℹ️';
  }
}

/**
 * Relative-zeit-format ("vor 2h" / "vor 3d"). Mirrors the helper in
 * awards-crafting-dashboard.tsx — nicht extracted weil v1 noch nicht
 * genug call-sites hat (zwei reicht nicht für extraction-cost).
 */
function formatRelative(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'gerade';
  if (diffMin < 60) return `vor ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `vor ${diffD}d`;
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
}
