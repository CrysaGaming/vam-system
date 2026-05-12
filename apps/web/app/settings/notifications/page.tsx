import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

import { Card } from '@/components/ui/card';

import { parsePrefs } from '@/lib/notification-prefs';
import { NotificationsCard } from './notifications-card';
import { PushSubscriptionCard } from './push-subscription-card';

/**
 * Track 4 #81 (Section P) — Notification-Preferences-Page.
 *
 * Eigene route `/settings/notifications` (statt tab in /settings) weil
 * notifications eine klar abgegrenzte concern sind und der sidebar-link
 * deeplinken soll. Wenn später mehr "channels" oder advanced-settings
 * (digest-frequency, quiet-hours) dazukommen, kann diese page wachsen
 * ohne den tab-bar in /settings zu überladen.
 *
 * # Render-pipeline
 *
 *   RSC (this file)
 *     → auth + prisma read (notificationPrefs Json)
 *     → parsePrefs → typed NotificationPrefs
 *     → NotificationsCard (client) bekommt serialized prefs als prop
 *     → client rendert tabellarisches grid mit optimistic-toggle-updates
 *     → server-action updateNotificationPref bei jedem flip
 *
 * # Why parsePrefs hier statt im client?
 *
 * Wir wollen die typed NotificationPrefs-shape ans client geben, nicht
 * raw Json — Prisma's `Json` field ist `unknown` zur runtime, und das
 * client soll keinen `if typeof === object && ...`-validator brauchen.
 * Server parst einmal, client kriegt typed structure.
 */
export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notificationPrefs: true },
  });

  if (!user) {
    redirect('/');
  }

  const prefs = parsePrefs(user.notificationPrefs);

  // Track 5 #24: VAPID public-key wird ins client-bundle exposed via
  // NEXT_PUBLIC_VAPID_PUBLIC_KEY (next.js convention für public env-vars).
  // Wenn unset → die PushSubscriptionCard rendert ihren 'unconfigured'-state.
  // Wir lesen das hier server-side statt im client damit die page eine
  // klare gate-decision macht ohne flicker beim mount.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="text-sm text-muted-foreground">
          <Link
            href="/settings"
            className="hover:text-foreground hover:underline"
          >
            Einstellungen
          </Link>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <span>Benachrichtigungen</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          🔔 Benachrichtigungen
        </h1>
        <p className="text-sm text-muted-foreground">
          Wähle pro Kategorie und Kanal aus, wie du informiert werden möchtest.
          Defaults: In-App ist standardmäßig <strong>aktiviert</strong>, Email
          ist <strong>deaktiviert</strong> (Opt-In).
        </p>
      </header>

      <Card className="gap-0 overflow-hidden p-0">
        <NotificationsCard initialPrefs={prefs} />
      </Card>

      {/* Track 5 #24 (Section E): Push-Subscription Card. Sitzt UNTER der
          existing channel-grid-card weil's ein SEPARATES feature ist —
          device-level subscribe statt per-category-channel-toggle. V2
          könnte push als channel in den channel-grid integrieren wenn
          die per-category-feinheit nötig wird; V1 hier ist global an/aus
          pro device.

          Eigene Card-wrapper damit der visuelle bruch klar ist (zwei
          unabhängige settings-sektionen statt einer mega-card).  */}
      <Card className="gap-0 overflow-hidden p-0">
        <PushSubscriptionCard vapidPublicKey={vapidPublicKey} />
      </Card>

      <aside className="rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">Hinweis zu E-Mails:</strong>{' '}
          E-Mails werden für die Kategorie &quot;PIREP-Entscheidung&quot;
          bereits zugestellt (Track 4 #82). Weitere Kategorien folgen mit den
          nächsten Sektionen. Falls dein Admin keinen E-Mail-Provider
          konfiguriert hat, wird der Versand still übersprungen — deine
          Auswahl bleibt aber erhalten.
        </p>
      </aside>
    </main>
  );
}
