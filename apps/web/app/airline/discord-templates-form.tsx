'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';

import { updateDiscordTemplates } from './actions';

/**
 * Track 4 #83 (Section P) — Discord-template-overrides UI.
 *
 * Pro category eine collapsible-row mit:
 *  - icon + label
 *  - title-input (1 zeile, max 200 chars)
 *  - description-textarea (multi-line, max 2000 chars)
 *  - hint-section mit liste der verfügbaren placeholder
 *
 * Defaults sind alle felder leer → bot rendert default-embed. Sobald ein
 * admin etwas eintippt + speichert, kommt der override beim nächsten
 * event-trigger in den embed.
 *
 * # Why client-component statt RSC mit form-action?
 *
 * Wir wollen optimistic-feedback + clientseitige validation (z.B.
 * placeholder-syntax-warnung wenn der admin `{unknown}` schreibt). Mit
 * use-server-action vom server-component aus würden wir das nicht
 * kriegen — daher client mit useState + useTransition + manual
 * action-call. Mirrors die patterns aus settings/notifications-card.tsx.
 *
 * # Why nicht react-hook-form?
 *
 * 6 categories × 2 fields = 12 plain-string inputs. useState reicht
 * dafür, react-hook-form wäre overhead. Wenn das later mehr complex
 * wird (z.B. validation auf placeholder-set per-category), kann es
 * migriert werden.
 */

// Mirrors AVAILABLE_VARIABLES aus lib/discord-templates.ts, aber
// inlined als client-konstante damit der client-bundle nicht das
// server-only modul importieren muss (würde build-error werfen weil
// das modul `import 'server-only'` enthält).
//
// Wenn neue placeholder dazukommen, BEIDE listen synchron halten.
// Eine bessere abstraktion (gemeinsame source-of-truth ohne server-only
// taint) wäre, die liste in einen separaten file zu legen — aber für
// 6 categories ist die duplication akzeptabel.
const CATEGORY_META: ReadonlyArray<{
  key:
    | 'pirepSubmitted'
    | 'pirepApproved'
    | 'pirepRejected'
    | 'rankUpgraded'
    | 'awardEarned'
    | 'eventPublished';
  icon: string;
  label: string;
  hint: string;
  variables: ReadonlyArray<{ name: string; description: string }>;
}> = [
  {
    key: 'pirepSubmitted',
    icon: '📋',
    label: 'PIREP eingereicht',
    hint: 'Wenn ein Pilot einen PIREP einreicht (Draft → Submitted).',
    variables: [
      { name: 'pilot', description: 'Name des einreichenden piloten' },
      { name: 'flightNumber', description: 'Flugnummer (z.B. NGN901)' },
      { name: 'departure', description: 'Departure ICAO' },
      { name: 'arrival', description: 'Arrival ICAO' },
      { name: 'route', description: '"EDDF → LOWW"' },
      { name: 'flightTimeMin', description: 'Flugzeit in minuten' },
      { name: 'flightTimeHm', description: 'Flugzeit "1h 23m"' },
      { name: 'aircraft', description: 'Aircraft type + registration' },
      { name: 'network', description: 'Offline/VATSIM/IVAO' },
    ],
  },
  {
    key: 'pirepApproved',
    icon: '✅',
    label: 'PIREP genehmigt',
    hint: 'Wenn ein Admin einen PIREP genehmigt.',
    variables: [
      { name: 'pilot', description: 'Name des piloten' },
      { name: 'flightNumber', description: 'Flugnummer' },
      { name: 'departure', description: 'Departure ICAO' },
      { name: 'arrival', description: 'Arrival ICAO' },
      { name: 'route', description: '"EDDF → LOWW"' },
      { name: 'approver', description: 'Name des admin' },
    ],
  },
  {
    key: 'pirepRejected',
    icon: '❌',
    label: 'PIREP abgelehnt',
    hint: 'Wenn ein Admin einen PIREP ablehnt (mit Begründung).',
    variables: [
      { name: 'pilot', description: 'Name des piloten' },
      { name: 'flightNumber', description: 'Flugnummer' },
      { name: 'departure', description: 'Departure ICAO' },
      { name: 'arrival', description: 'Arrival ICAO' },
      { name: 'route', description: '"EDDF → LOWW"' },
      { name: 'approver', description: 'Name des admin' },
      { name: 'reason', description: 'Ablehnungs-grund' },
    ],
  },
  {
    key: 'rankUpgraded',
    icon: '🎖️',
    label: 'Beförderung',
    hint: 'Wenn ein Pilot einen neuen Rank erreicht.',
    variables: [
      { name: 'pilot', description: 'Name des piloten' },
      { name: 'oldRank', description: 'Vorheriger rank' },
      { name: 'newRank', description: 'Neuer rank' },
      { name: 'totalHours', description: 'Gesamt-flugstunden' },
    ],
  },
  {
    key: 'awardEarned',
    icon: '🏆',
    label: 'Award verliehen',
    hint: 'Wenn ein Admin einem Pilot einen Award gibt.',
    variables: [
      { name: 'pilot', description: 'Name des piloten' },
      { name: 'awardName', description: 'Name des awards' },
      { name: 'awardDescription', description: 'Beschreibung des awards' },
    ],
  },
  {
    key: 'eventPublished',
    icon: '📅',
    label: 'Event veröffentlicht',
    hint: 'Wenn ein neues Event/eine Tour publiziert wird.',
    variables: [
      { name: 'eventName', description: 'Name des events' },
      { name: 'eventDate', description: 'Datum + uhrzeit' },
      { name: 'organizer', description: 'Name des organisators' },
    ],
  },
];

type Entry = { title?: string | null; description?: string | null };
type Templates = Partial<Record<(typeof CATEGORY_META)[number]['key'], Entry>>;

export function DiscordTemplatesForm({ initial }: { initial: Templates }) {
  // State pro feld als flat-map: `${categoryKey}.title` / `${key}.description`.
  // Einfacher als nested objects (kein deep-spread bei jedem keystroke).
  // Initialisiert aus dem prop — leere strings für unset-felder damit das
  // controlled-input nicht zwischen undefined und '' wechselt.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const meta of CATEGORY_META) {
      const entry = initial[meta.key];
      out[`${meta.key}.title`] = entry?.title ?? '';
      out[`${meta.key}.description`] = entry?.description ?? '';
    }
    return out;
  });

  // Pro category collapsed/expanded. Standard: alles collapsed außer
  // categories die schon einen wert haben (admin hat sie wahrscheinlich
  // mal bearbeitet und will weiter editieren).
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const meta of CATEGORY_META) {
      const entry = initial[meta.key];
      out[meta.key] = !!(entry?.title || entry?.description);
    }
    return out;
  });

  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    // Build payload aus values-map zurück in das nested-object-shape
    // das DiscordTemplatesSchema erwartet.
    const payload: Templates = {};
    for (const meta of CATEGORY_META) {
      const title = values[`${meta.key}.title`]?.trim() ?? '';
      const description = values[`${meta.key}.description`]?.trim() ?? '';
      // Nur addieren wenn min. ein feld nicht-leer ist. Server-action
      // normalisiert dasselbe nochmal (DRY-violation? — nein, das ist
      // intentional defense-in-depth: client-validation für UX,
      // server-validation für korrektness).
      if (title.length > 0 || description.length > 0) {
        payload[meta.key] = {
          ...(title.length > 0 ? { title } : {}),
          ...(description.length > 0 ? { description } : {}),
        };
      }
    }

    startTransition(async () => {
      try {
        await updateDiscordTemplates(payload);
        toastSuccess('Discord-Templates gespeichert');
      } catch (e) {
        toastError(e);
      }
    });
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span aria-hidden="true">💬</span>
          Discord-Templates
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Optional kannst du den Titel + die Beschreibung der Discord-Embeds
          pro Event-Kategorie überschreiben. Platzhalter wie{' '}
          <code className="rounded bg-muted px-1 font-mono text-[0.7rem]">
            {'{pilot}'}
          </code>{' '}
          werden zur Laufzeit ersetzt. Lass die Felder leer → der Bot nutzt
          die Default-Texte. Farben, Buttons und sonstige Embed-Elemente
          bleiben in allen Fällen unverändert.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {CATEGORY_META.map((meta) => {
          const isOpen = expanded[meta.key] ?? false;
          const titleKey = `${meta.key}.title`;
          const descKey = `${meta.key}.description`;
          const hasValue =
            (values[titleKey]?.trim().length ?? 0) > 0 ||
            (values[descKey]?.trim().length ?? 0) > 0;

          return (
            <div
              key={meta.key}
              className={cn(
                'rounded-md border border-border bg-card transition',
                hasValue && 'border-primary/30',
              )}
            >
              {/* Header-row mit toggle */}
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [meta.key]: !prev[meta.key] }))
                }
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl" aria-hidden="true">
                    {meta.icon}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {meta.hint}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasValue && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-primary">
                      Override
                    </span>
                  )}
                  <svg
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      isOpen ? 'rotate-180' : '',
                    )}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {/* Expanded body */}
              {isOpen && (
                <div className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-[1fr_220px]">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${meta.key}-title`} className="text-xs">
                        Titel (max 200 Zeichen)
                      </Label>
                      <Input
                        id={`${meta.key}-title`}
                        value={values[titleKey] ?? ''}
                        maxLength={200}
                        placeholder="Optional — leer = Default-Titel"
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [titleKey]: e.target.value,
                          }))
                        }
                        className="text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label
                        htmlFor={`${meta.key}-description`}
                        className="text-xs"
                      >
                        Beschreibung (max 2000 Zeichen)
                      </Label>
                      <Textarea
                        id={`${meta.key}-description`}
                        value={values[descKey] ?? ''}
                        maxLength={2000}
                        rows={3}
                        placeholder="Optional — leer = Default-Beschreibung"
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [descKey]: e.target.value,
                          }))
                        }
                        className="resize-y text-sm"
                      />
                    </div>
                  </div>

                  {/* Variable-hints */}
                  <aside className="rounded-md bg-muted/30 p-3">
                    <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Verfügbare Variablen
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {meta.variables.map((v) => (
                        <li key={v.name} className="text-xs">
                          <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[0.7rem] text-primary">
                            {`{${v.name}}`}
                          </code>{' '}
                          <span className="text-muted-foreground">
                            {v.description}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </aside>
                </div>
              )}
            </div>
          );
        })}

        <div className="mt-2 flex items-center justify-end gap-2">
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? 'Speichert…' : 'Speichern'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
