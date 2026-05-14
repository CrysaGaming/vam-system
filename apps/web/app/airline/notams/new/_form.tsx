'use client';

/**
 * Welle L / L5 — New NOTAM form (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createNotamAction } from '../actions';

const TYPE_OPTIONS = [
  { value: 'Closure', label: 'Closure' },
  { value: 'Restriction', label: 'Restriction' },
  { value: 'Procedure', label: 'Procedure' },
  { value: 'Info', label: 'Info' },
];

const SEVERITY_OPTIONS = [
  { value: 'Info', label: 'Info' },
  { value: 'Warning', label: 'Warning' },
  { value: 'Critical', label: 'Critical' },
];

export default function NewNotamForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState('Info');
  const [severity, setSeverity] = useState('Info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [icaosText, setIcaosText] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!validFrom) {
      setError('validFrom ist pflicht.');
      return;
    }
    const icaos = icaosText
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    startTransition(async () => {
      const res = await createNotamAction({
        type,
        severity,
        title,
        body,
        affectedIcaos: icaos,
        validFromIso: new Date(validFrom).toISOString(),
        validUntilIso: validUntil ? new Date(validUntil).toISOString() : null,
      });
      if (res.ok && res.notamId) {
        router.push(`/airline/notams/${res.notamId}`);
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Typ
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Severity
          </label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Titel
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="z.B. EDDF RWY 07L closed for renovation"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Affected ICAOs (komma/space-getrennt, leer = general)
        </label>
        <input
          type="text"
          value={icaosText}
          onChange={(e) => setIcaosText(e.target.value.toUpperCase())}
          placeholder="EDDF, EDDM"
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-base focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Gültig ab
          </label>
          <input
            type="datetime-local"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Gültig bis (optional, leer = open-ended)
          </label>
          <input
            type="datetime-local"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Body
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          rows={8}
          placeholder="Vollständige beschreibung. Plain-text, line-breaks werden preserved."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">
          {body.length} / 10000
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending || title.length < 5 || body.length < 10 || !validFrom}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Erstelle…' : 'Als Draft anlegen'}
      </button>
      <p className="text-xs text-muted-foreground">
        Wird als Draft erstellt. Erst nach &ldquo;Publish&rdquo; sehen pilots
        den NOTAM.
      </p>
    </div>
  );
}
