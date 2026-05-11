import Link from 'next/link';

import { listMyNotifications } from './actions';
import { NotificationsList } from './notifications-list';

/**
 * Track 4 #84 (Section P) — Pilot-side notification-inbox page.
 *
 * Sitzt unter /notifications. Linked von der sidebar (📥 Posteingang)
 * UND verweist intern zur preferences-page (/settings/notifications)
 * für den fall dass der pilot die channels umkonfigurieren will.
 *
 * RSC der die action ausführt und die liste an den client-component
 * weitergibt. Auth-check passiert in der action (requireUserId redirected
 * zu / wenn nicht eingeloggt).
 *
 * # Why no Suspense?
 *
 * Wir könnten die list in einen <Suspense fallback={<Skeleton />}>
 * wrappen damit der page-shell sofort rendert während die query läuft.
 * Bei einer single-query mit indexed-where (recipientId, readAt) ist
 * das aber sub-100ms — der overhead von Suspense (extra-roundtrip für
 * RSC-streaming) ist nicht den UX-gewinn wert.
 */
export const metadata = {
  title: 'Posteingang · VAM System',
};

export default async function NotificationsPage() {
  const notifications = await listMyNotifications();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3 pb-5 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span aria-hidden="true">📥</span> Posteingang
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              System-Nachrichten, PIREP-Entscheidungen und Broadcasts.
            </p>
          </div>
          <Link
            href="/settings/notifications"
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Benachrichtigungs-Einstellungen →
          </Link>
        </header>

        <NotificationsList initial={notifications} />
      </div>
    </main>
  );
}
