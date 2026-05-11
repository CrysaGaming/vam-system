import Link from 'next/link';
import { prisma, type EventKind } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';
import {
  createTemplateAction,
  deleteTemplateAction,
  spawnEventFromTemplateAction,
} from './actions';

/**
 * Track 4 #98 (Section S) — Event-Templates page.
 *
 * /admin/events/templates — admin-tool zum verwalten wiederverwendbarer
 * event-vorlagen. Pattern:
 *   1. Admin definiert template (z.B. "Friday Night Group-Flight")
 *   2. Beim "Spawn event from template"-klick wird ein neuer DRAFT-event
 *      erzeugt mit allen template-fields kopiert (außer startsAt/endsAt)
 *   3. Admin tweaks dates + publish im normalen event-edit-flow
 *
 * Templates sind airline-scoped, admin-only. V1 hat kein edit-flow —
 * admin deletes + recreates wenn template-änderung gewünscht.
 */

const KIND_LABELS: Record<EventKind, string> = {
  TOUR: 'Tour',
  SINGLE_FLIGHT: 'Single-Flight',
  THEMED: 'Themen-Event',
  GROUP_FLIGHT: 'Group-Flight',
  SEASONAL: 'Saison-Event',
};

const KIND_ICONS: Record<EventKind, string> = {
  TOUR: '🗺️',
  SINGLE_FLIGHT: '✈️',
  THEMED: '🎨',
  GROUP_FLIGHT: '👥',
  SEASONAL: '🎄',
};

export default async function EventTemplatesPage() {
  const admin = await requireAdminPage();
  if (!admin.airlineId) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">Event-Templates</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Du musst einer airline angehören um templates zu verwalten.
          </p>
        </div>
      </main>
    );
  }

  const templates = await prisma.eventTemplate.findMany({
    where: { airlineId: admin.airlineId },
    orderBy: [{ useCount: 'desc' }, { createdAt: 'desc' }],
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold">📋 Event-Templates</h1>
            <Link
              href="/admin/events"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Events-Verwaltung
            </Link>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Wiederverwendbare event-vorlagen. Erstelle einmal das muster,
            spawne neue events mit einem klick.
          </p>
        </header>

        {/* Create-form */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-1">Neues Template anlegen</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Definiere die default-fields. Beim spawn wird startsAt
            (default +7 tage) und endsAt (default null) gesetzt — alles
            andere kommt vom template.
          </p>
          <form
            action={createTemplateAction}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <label className="text-sm">
              <span className="block mb-1 font-medium">
                Template-Name{' '}
                <span className="text-xs text-gray-500">(admin-label)</span>
              </span>
              <input
                name="name"
                required
                maxLength={100}
                placeholder="z.B. Friday Night Group-Flight"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
            </label>

            <label className="text-sm">
              <span className="block mb-1 font-medium">Event-Kind</span>
              <select
                name="kind"
                required
                defaultValue="THEMED"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              >
                {Object.entries(KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {KIND_ICONS[k as EventKind]} {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="md:col-span-2 text-sm">
              <span className="block mb-1 font-medium">
                Event-Titel{' '}
                <span className="text-xs text-gray-500">
                  (wird beim spawn als event-titel + slug-basis genutzt)
                </span>
              </span>
              <input
                name="title"
                required
                maxLength={200}
                placeholder="z.B. Freitag-Abend Group-Flight EDDF → LFPG"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
            </label>

            <label className="md:col-span-2 text-sm">
              <span className="block mb-1 font-medium">Beschreibung</span>
              <textarea
                name="description"
                required
                rows={4}
                maxLength={5000}
                placeholder="Default event-beschreibung..."
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
            </label>

            <label className="text-sm">
              <span className="block mb-1 font-medium">
                Bonus-Reward (VAM$){' '}
                <span className="text-xs text-gray-500">(optional)</span>
              </span>
              <input
                name="bonusReward"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue="0"
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
            </label>

            <label className="text-sm">
              <span className="block mb-1 font-medium">
                Max-Teilnehmer{' '}
                <span className="text-xs text-gray-500">
                  (leer = unlimited)
                </span>
              </span>
              <input
                name="maxParticipants"
                type="number"
                min="1"
                placeholder=""
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
              />
            </label>

            <label className="md:col-span-2 text-sm">
              <span className="block mb-1 font-medium">
                Legs{' '}
                <span className="text-xs text-gray-500">
                  (eine pro zeile: ICAO|label|note — letztere optional)
                </span>
              </span>
              <textarea
                name="legsRaw"
                rows={4}
                placeholder={`EDDF|Frankfurt|Hub\nLFPG|Paris CDG\nEHAM|Amsterdam Schiphol`}
                className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono"
              />
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition text-sm"
              >
                📋 Template anlegen
              </button>
            </div>
          </form>
        </section>

        {/* Templates list */}
        <section>
          <h2 className="text-lg font-semibold mb-3">
            Bestehende Templates ({templates.length})
          </h2>
          {templates.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-2">
                Noch keine templates angelegt.
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Definiere oben dein erstes muster.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((tpl) => {
                const legs =
                  Array.isArray(tpl.legs) && tpl.legs.length > 0
                    ? (tpl.legs as Array<{ icao?: string }>)
                    : null;
                return (
                  <div
                    key={tpl.id}
                    className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 sm:p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span
                            className="text-base"
                            aria-hidden="true"
                          >
                            {KIND_ICONS[tpl.kind]}
                          </span>
                          <h3 className="text-base font-bold">{tpl.name}</h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                            {KIND_LABELS[tpl.kind]}
                          </span>
                          {tpl.useCount > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                              {tpl.useCount}× genutzt
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
                          {tpl.title}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <form action={spawnEventFromTemplateAction}>
                          <input type="hidden" name="id" value={tpl.id} />
                          <button
                            type="submit"
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition"
                          >
                            ⚡ Spawn Event
                          </button>
                        </form>
                        <form action={deleteTemplateAction}>
                          <input type="hidden" name="id" value={tpl.id} />
                          <button
                            type="submit"
                            className="px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 rounded transition"
                            title="Template löschen"
                          >
                            🗑️
                          </button>
                        </form>
                      </div>
                    </div>

                    {/* Meta-row */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-500 mb-3">
                      {Number(tpl.bonusReward) > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          💰 {Number(tpl.bonusReward).toLocaleString('de-DE')} VAM$ bonus
                        </span>
                      )}
                      {tpl.maxParticipants !== null && (
                        <span>👥 max {tpl.maxParticipants} teilnehmer</span>
                      )}
                      {legs && legs.length > 0 && (
                        <span>
                          🗺️{' '}
                          {legs
                            .map((l) => l.icao ?? '?')
                            .filter(Boolean)
                            .join(' → ')}
                        </span>
                      )}
                      <span>
                        erstellt von {tpl.createdBy.name ?? '—'} ·{' '}
                        {tpl.createdAt.toLocaleDateString('de-DE')}
                      </span>
                    </div>

                    {/* Description preview */}
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 whitespace-pre-wrap">
                      {tpl.description}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Info footer */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Spawn-flow:</strong>{' '}
            Beim klick auf "⚡ Spawn Event" wird ein neuer DRAFT-event
            erzeugt mit allen fields aus dem template. startsAt wird auf
            "in 7 tagen" gesetzt (admin korrigiert per-instance). Danach
            zum normalen edit-flow weitergeleitet.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">Snapshot-semantik:</strong>{' '}
            Spawnete events sind unabhängig vom template — template-edit
            ändert KEINE bestehenden events. Useful weil events historisch
            akkurat bleiben.
          </p>
        </aside>
      </div>
    </main>
  );
}
