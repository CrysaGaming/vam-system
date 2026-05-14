import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';

import {
  getQualityHistory,
  getQualityAverages,
  scoreLabel,
} from '@/lib/quality/score';
import QualityTrendChart from './_trend-chart';

/**
 * Welle I / I2 — Flight-Quality-Score personal-page.
 *
 * Route: /me/quality
 *
 * Zeigt dem pilot seinen all-time flight-quality-overview:
 *   - 4 KPI-cards (overall-avg, last-5-avg, best, worst)
 *   - Trend-chart (last 30 PIREP-scores als line-chart)
 *   - History-tabelle (last 50 PIREPs mit per-component-breakdown)
 *
 * Server-component, revalidate=300. Score wird on-the-fly aus
 * existing PIREP-feldern berechnet (siehe lib/quality/score.ts) —
 * keine persistence, keine migration nötig.
 */

export const revalidate = 300;

export default async function QualityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [averages, history, user] = await Promise.all([
    getQualityAverages(userId),
    getQualityHistory(userId, 50),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    }),
  ]);

  // Trend-chart data: last 30 scores, oldest-first (chart reads l-to-r).
  // History ist desc-sorted (neueste zuerst), wir reversen für die anzeige.
  const trendData = history
    .slice(0, 30)
    .reverse()
    .map((h, i) => ({
      index: i + 1,
      score: h.score.overall,
      date: h.submittedAt.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
    }));

  // Empty state — pilot has no non-Draft PIREPs.
  if (averages.totalPireps === 0) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <PageHeader name={user?.name ?? 'Pilot'} />
        <EmptyState />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <PageHeader name={user?.name ?? 'Pilot'} />

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ScoreCard
          label="Overall Average"
          value={averages.avgOverall}
          sublabel={`${averages.totalPireps} Flüge`}
        />
        <ScoreCard
          label="Letzte 5"
          value={averages.avgLast5}
          sublabel={trendIcon(averages.trend)}
        />
        <ScoreCard
          label="Bester Flug"
          value={averages.bestScore}
          sublabel="Personal best"
        />
        <ScoreCard
          label="Schlechtester"
          value={averages.worstScore}
          sublabel="Room to improve"
        />
      </section>

      {/* Trend chart */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-1 text-lg font-semibold">Score-Verlauf</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Letzte {trendData.length} Flüge. Grüne linie = 75 ("Gut")
          schwelle.
        </p>
        <QualityTrendChart data={trendData} />
      </section>

      {/* History table */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-semibold">Flug-Historie</h2>
          <p className="text-sm text-muted-foreground">
            Letzte {history.length} PIREPs (außer Drafts). Klick auf einen
            flug für details.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Datum</th>
                <th className="px-4 py-3 font-medium">Flug</th>
                <th className="px-4 py-3 font-medium">Strecke</th>
                <th className="px-4 py-3 text-right font-medium">Landing</th>
                <th className="px-4 py-3 text-right font-medium">Flags</th>
                <th className="px-4 py-3 text-right font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((h) => {
                const label = scoreLabel(h.score.overall);
                return (
                  <tr
                    key={h.pirepId}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground">
                      {h.submittedAt.toLocaleDateString('de-DE')}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/pireps/${h.pirepId}`}
                        className="text-indigo-500 hover:underline"
                      >
                        {h.flightNumber ?? 'PIREP'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {h.departureIcao} → {h.arrivalIcao}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {h.score.landing}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {h.score.flags}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {h.score.completion}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${colorClasses(label.color)}`}
                      >
                        {h.score.overall}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components (inline)
// ─────────────────────────────────────────────────────────────────────

function PageHeader({ name }: { name: string }) {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-bold tracking-tight">
        Flight-Quality-Score
      </h1>
      <p className="text-sm text-muted-foreground">
        Hi {name} — wie sauber fliegst du? Score-breakdown nach landing,
        anti-cheat-flags und completion.
      </p>
      <div className="pt-2">
        <Link
          href="/me/stats"
          className="text-xs text-indigo-500 hover:underline"
        >
          ← Zurück zu Personal Stats
        </Link>
      </div>
    </header>
  );
}

function ScoreCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: number;
  sublabel: string;
}) {
  const { color } = scoreLabel(value);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${textColorClass(color)}`}>
        {value}
        <span className="text-base text-muted-foreground"> / 100</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
      <div className="mb-3 text-4xl">✈️</div>
      <h2 className="text-lg font-semibold">Noch keine Flüge</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Sobald du deinen ersten PIREP submitted hast, erscheint hier dein
        quality-score-overview.
      </p>
      <div className="mt-6">
        <Link
          href="/bookings/new"
          className="inline-flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
        >
          Neuen Flug planen
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styling helpers
// ─────────────────────────────────────────────────────────────────────

function trendIcon(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return '↗ verbessert';
  if (trend === 'down') return '↘ verschlechtert';
  return '→ stabil';
}

function colorClasses(color: 'green' | 'lime' | 'yellow' | 'orange' | 'red'): string {
  switch (color) {
    case 'green':
      return 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400';
    case 'lime':
      return 'border-lime-500/30 bg-lime-500/10 text-lime-600 dark:text-lime-400';
    case 'yellow':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';
    case 'orange':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'red':
      return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400';
  }
}

function textColorClass(color: 'green' | 'lime' | 'yellow' | 'orange' | 'red'): string {
  switch (color) {
    case 'green':
      return 'text-green-600 dark:text-green-400';
    case 'lime':
      return 'text-lime-600 dark:text-lime-400';
    case 'yellow':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'orange':
      return 'text-orange-600 dark:text-orange-400';
    case 'red':
      return 'text-red-600 dark:text-red-400';
  }
}
