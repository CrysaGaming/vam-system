import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Innovation-Item #2 (Track 3 #11.2.5 v1-Full Widget) — Pilot-Birthday-
 * Calendar. vision-doc §9.1.14.
 *
 * # Was zeigt das?
 *
 * Liste der nächsten 5 anstehenden geburtstage von piloten die ihre
 * birthdayPublic=true gesetzt haben. Jeder eintrag: name, airline, datum
 * (MM-DD), days-until ("heute", "morgen", "in 3 Tagen", etc.).
 *
 * # Privacy
 *
 * Nur user mit `birthdayPublic=true` werden gelistet. Default false bei
 * neuen + legacy-users → widget zeigt initial leeren state. User aktiviert
 * das selbst im profile-edit (kommt als follow-up — MVP setzt das via
 * direct-DB oder admin-action).
 *
 * # Cross-jahr-logik
 *
 * Birthdays kommen jährlich wieder — wir wollen "die nächsten N" zeigen,
 * nicht nur "im aktuellen jahr". Logik:
 *
 *   1. Fetch alle public birthdays
 *   2. Pro user: berechne next-occurrence = (this-year-anniversary OR
 *      next-year-anniversary wenn this-year-anniv schon vorbei ist)
 *   3. Sortiere nach next-occurrence
 *   4. Take 5
 *
 * Das passiert app-side weil postgres-date-math für "next anniversary"
 * mehrere CASE-statements braucht — bei < 1000 public-birthdays trivial.
 * Bei skala kommt eine raw-query mit (EXTRACT(MONTH FROM birthday) ||
 * EXTRACT(DAY FROM birthday)) als sort-key.
 *
 * # Today-highlight
 *
 * Wenn jemand HEUTE geburtstag hat: visuell hervorgehoben (gelber accent),
 * label "🎂 Heute". Admin-action-hook (für innovation-item #1.10 birthday-
 * awards): geplant als follow-up — manuell awarden bleibt im MVP.
 */

interface BirthdayEntry {
  userId: string;
  name: string | null;
  airlineName: string | null;
  daysUntil: number;
  monthDay: string; // "MM-DD" für display
}

function calculateDaysUntilNextBirthday(birthday: Date, today: Date): { daysUntil: number; monthDay: string } {
  const month = birthday.getUTCMonth();
  const day = birthday.getUTCDate();

  // Versuch dieses jahr — wenn schon vorbei, nächstes jahr
  let next = new Date(Date.UTC(today.getUTCFullYear(), month, day));
  if (next.getTime() < new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).getTime()) {
    next = new Date(Date.UTC(today.getUTCFullYear() + 1, month, day));
  }

  const todayMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const diffMs = next.getTime() - todayMidnight.getTime();
  const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const monthStr = String(month + 1).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');

  return { daysUntil, monthDay: `${monthStr}-${dayStr}` };
}

function formatDaysUntil(daysUntil: number): string {
  if (daysUntil === 0) return '🎂 Heute';
  if (daysUntil === 1) return 'Morgen';
  if (daysUntil < 7) return `in ${daysUntil} Tagen`;
  if (daysUntil < 14) return `in 1 Woche`;
  if (daysUntil < 30) return `in ${Math.round(daysUntil / 7)} Wochen`;
  if (daysUntil < 60) return `in 1 Monat`;
  return `in ${Math.round(daysUntil / 30)} Monaten`;
}

async function getUpcomingBirthdays(): Promise<BirthdayEntry[]> {
  const users = await prisma.user.findMany({
    where: {
      birthday: { not: null },
      birthdayPublic: true,
    },
    select: {
      id: true,
      name: true,
      birthday: true,
      airline: { select: { name: true } },
    },
  });

  const today = new Date();
  const enriched = users
    .filter((u) => u.birthday !== null)
    .map((u) => {
      const { daysUntil, monthDay } = calculateDaysUntilNextBirthday(u.birthday!, today);
      return {
        userId: u.id,
        name: u.name,
        airlineName: u.airline?.name ?? null,
        daysUntil,
        monthDay,
      };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 5);

  return enriched;
}

export async function PilotBirthdayCalendar() {
  const birthdays = await getUpcomingBirthdays();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden="true">🎂</span>
          <span>Anstehende Geburtstage</span>
        </CardTitle>
        <CardDescription>
          Nächste 5 Piloten-Geburtstage (nur opt-in via{' '}
          <code className="text-xs">birthdayPublic</code>).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {birthdays.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Keine öffentlichen Geburtstage hinterlegt. Piloten setzen ihren
            Geburtstag im Profil + aktivieren <code>birthdayPublic</code>.
          </p>
        ) : (
          <ul className="space-y-2">
            {birthdays.map((b) => (
              <li
                key={b.userId}
                className={
                  b.daysUntil === 0
                    ? 'flex items-center justify-between p-2 rounded bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900/40'
                    : 'flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-500 dark:text-gray-400 tabular-nums">
                    {b.monthDay}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {b.name ?? '(unbenannt)'}
                    </div>
                    {b.airlineName && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {b.airlineName}
                      </div>
                    )}
                  </div>
                </div>
                <span
                  className={
                    b.daysUntil === 0
                      ? 'text-xs font-medium text-yellow-800 dark:text-yellow-300'
                      : 'text-xs text-gray-500 dark:text-gray-400'
                  }
                >
                  {formatDaysUntil(b.daysUntil)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
