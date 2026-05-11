'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

/**
 * Track 4 #84 (Section P) — Pilot-side AdminNotification-inbox.
 *
 * Existing infrastructure:
 *   - `AdminNotification` model existiert seit M5 (admin-side notification-
 *     sending). Schema-doc nennt explizit "Pilot-side drawer: alle
 *     notifications für mich + alle broadcasts" als anvisierten use-case
 *     für den `[recipientId, readAt]`-index.
 *   - `apps/web/app/admin/notifications/actions.ts` deckt nur die CREATE-
 *     seite (admin schickt notification). Bisher gibt es KEINE pilot-facing
 *     UI um diese notifications zu sehen — der inbox-flow startet hier.
 *
 * Three actions:
 *   - listMyNotifications: combined-feed aus per-user-notifications
 *     (recipientId=me) UND broadcasts (recipientId=null). Beide gleich
 *     behandelt; UI kann optional broadcasts visuell unterschiedlich
 *     rendern wenn der pilot mehr context will (z.B. "an alle" badge).
 *   - markNotificationRead(id): setzt readAt für eine einzelne notification.
 *     Owner-check verhindert dass user A notifications von user B als
 *     gelesen markiert (für broadcasts ist jeder "owner").
 *   - markAllNotificationsRead: bulk-update aller unread-notifications
 *     des users + broadcasts. Single SQL UPDATE über updateMany — keine
 *     N+1-queries auch bei tausenden notifications.
 *
 * # Why not separate broadcast/personal endpoints?
 *
 * Aus pilot-perspektive ist die unterscheidung egal — beide kategorien
 * tauchen im gleichen inbox auf, beide werden gleich "als gelesen"
 * markiert. Ein einziger combined-stream ist einfacher zu rendern + zu
 * benutzen. Wenn später eine separate "broadcasts-only"-view gewünscht
 * ist, kann man einen filter-parameter hinzufügen ohne die API-shape
 * brechen zu müssen.
 *
 * # Read-state semantik bei broadcasts
 *
 * AdminNotification hat NUR EIN readAt-feld auf der notification selbst,
 * nicht ein pivot-table für (notification, user) → readAt. Das ist
 * intentional simple für den MVP: bei broadcasts (recipientId=null)
 * teilen alle user den gleichen readAt-state — sobald EIN user "mark
 * read" klickt, ist die broadcast für alle als gelesen markiert.
 *
 * Das ist suboptimal aber pragmatic — eine richtige per-user-read-state
 * würde ein `AdminNotificationRead { notificationId, userId, readAt }`
 * pivot-table erfordern. Für jetzt akzeptieren wir die einfachere
 * variante; wenn broadcasts häufig genug werden dass das nervt, kann
 * man das schema additiv erweitern (alte readAt-column bleibt für
 * per-user-rows, neue pivot-table für broadcasts).
 */

/**
 * Server-side auth-guard. Wirft redirect zu / wenn nicht eingeloggt.
 * Returnt userId direkt (kein full user-fetch nötig — wir brauchen nur
 * die id für alle drei actions).
 */
async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/');
  }
  return session.user.id;
}

export type NotificationListItem = {
  id: string;
  title: string;
  body: string;
  kind: string;
  readAt: Date | null;
  createdAt: Date;
  /**
   * Null = broadcast (alle piloten), gesetzt = persönliche notification.
   * UI kann das nutzen um "an alle"-badge zu rendern.
   */
  isBroadcast: boolean;
  authorName: string | null;
};

/**
 * Combined-feed: personal-notifications + broadcasts, sorted by createdAt
 * desc (neueste zuerst). Limit 100 als safety-cap — bei mehr notifications
 * muss der pilot scrollen oder pagination braucht eine v2.
 *
 * Why 100 und nicht infinite scroll? Pilots werden realistisch nicht
 * mehr als 10-50 notifications haben (admin-broadcasts sind selten, PIREP-
 * decisions nur bei eigenen pireps). 100 ist großzügig. Wenn das mal
 * eng wird, ist pagination ein additives feature.
 */
export async function listMyNotifications(): Promise<NotificationListItem[]> {
  const userId = await requireUserId();

  const rows = await prisma.adminNotification.findMany({
    where: {
      OR: [
        { recipientId: userId }, // persönliche notifications
        { recipientId: null }, // broadcasts
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      body: true,
      kind: true,
      readAt: true,
      createdAt: true,
      recipientId: true,
      author: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    kind: r.kind,
    readAt: r.readAt,
    createdAt: r.createdAt,
    isBroadcast: r.recipientId === null,
    authorName: r.author?.name ?? null,
  }));
}

/**
 * Einzelne notification als gelesen markieren. Sicherheits-guard: user
 * darf NUR notifications markieren die für ihn bestimmt sind
 * (recipientId=me) ODER broadcasts (recipientId=null). Verhindert dass
 * ein malicious user random IDs durchprobiert und fremde notifications
 * "als gelesen" markiert.
 *
 * Idempotent: wenn die notification schon gelesen ist (readAt set),
 * passiert nix — wir würden den existing-timestamp überschreiben,
 * das wäre eine subtile semantik-änderung (timestamp = "wann zuletzt
 * gesehen" statt "wann erstmals gelesen"). Wir vermeiden das via
 * `readAt: null` im where-clause — der update matcht dann 0 rows,
 * was OK ist.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const userId = await requireUserId();

  // updateMany statt update damit der where-filter nicht-existing-id
  // graceful behandelt (update würde throw, updateMany returnt count=0).
  // Sicherheits-guard im where: user darf nur seine eigenen oder
  // broadcasts markieren.
  await prisma.adminNotification.updateMany({
    where: {
      id,
      readAt: null, // idempotent: schon-gelesene nicht erneut anfassen
      OR: [
        { recipientId: userId },
        { recipientId: null },
      ],
    },
    data: { readAt: new Date() },
  });

  revalidatePath('/notifications');
}

/**
 * Bulk: alle unread-notifications des users (+ broadcasts) als gelesen
 * markieren. Single UPDATE-SQL via updateMany — auch bei 100+ rows
 * keine N+1-queries.
 *
 * Returnt die anzahl markierter notifications damit das UI ein
 * informatives toast zeigen kann ("3 als gelesen markiert").
 */
export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const userId = await requireUserId();

  const result = await prisma.adminNotification.updateMany({
    where: {
      readAt: null,
      OR: [
        { recipientId: userId },
        { recipientId: null },
      ],
    },
    data: { readAt: new Date() },
  });

  revalidatePath('/notifications');

  return { count: result.count };
}
