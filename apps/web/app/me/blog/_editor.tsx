'use client';

/**
 * Welle K / K2 — Pilot-Blog editor (shared für create + edit).
 *
 * Client-component mit useTransition für non-blocking server-action-calls.
 * Title + body + excerpt-textareas; aktions-buttons unten (Speichern,
 * Publish/Unpublish, Löschen).
 *
 * Bei create-mode (initialData=null): nur "Speichern als Draft"-button,
 * nach erfolg redirect zu /me/blog/[id]/edit damit der user nahtlos
 * weiter-editieren kann.
 *
 * Bei edit-mode (initialData gesetzt): alle 4 actions verfügbar.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createBlogPostAction,
  updateBlogPostAction,
  publishBlogPostAction,
  unpublishBlogPostAction,
  deleteBlogPostAction,
} from './actions';

type Props = {
  /** null = create-mode, sonst edit-mode mit existing post */
  initialData: {
    id: string;
    title: string;
    body: string;
    excerpt: string | null;
    status: 'Draft' | 'Published';
    slug: string;
  } | null;
};

export default function BlogPostEditor({ initialData }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(initialData?.title ?? '');
  const [body, setBody] = useState(initialData?.body ?? '');
  const [excerpt, setExcerpt] = useState(initialData?.excerpt ?? '');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  const isEdit = initialData !== null;
  const isPublished = initialData?.status === 'Published';

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      if (isEdit) {
        const res = await updateBlogPostAction(initialData.id, {
          title,
          body,
          excerpt: excerpt || undefined,
        });
        if (res.ok) {
          setMessage({ kind: 'success', text: res.message ?? 'Gespeichert.' });
        } else {
          setMessage({ kind: 'error', text: res.error });
        }
      } else {
        const res = await createBlogPostAction({ title, body, excerpt: excerpt || undefined });
        if (res.ok && res.slug) {
          // Find the new id via the slug; the action returned the slug,
          // we lookup-und-route to the edit-page. Simplest: just go to /me/blog
          // and let the user pick the new entry. V2 could include the id
          // in the action-result so we route direct.
          router.push('/me/blog');
        } else if (!res.ok) {
          setMessage({ kind: 'error', text: res.error });
        }
      }
    });
  }

  function handlePublishToggle() {
    if (!isEdit) return;
    setMessage(null);
    startTransition(async () => {
      const res = isPublished
        ? await unpublishBlogPostAction(initialData.id)
        : await publishBlogPostAction(initialData.id);
      if (res.ok) {
        setMessage({ kind: 'success', text: res.message ?? 'Status geändert.' });
        // Refresh um neuen status zu reflektieren
        router.refresh();
      } else {
        setMessage({ kind: 'error', text: res.error });
      }
    });
  }

  function handleDelete() {
    if (!isEdit) return;
    if (!confirm('Wirklich löschen? Das kann nicht rückgängig gemacht werden.')) return;
    setMessage(null);
    startTransition(async () => {
      const res = await deleteBlogPostAction(initialData.id);
      if (res.ok) {
        router.push('/me/blog');
      } else {
        setMessage({ kind: 'error', text: res.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`rounded-md border p-3 text-sm ${
            message.kind === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
              : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Titel
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="z.B. EDDF → EDDM mit der A320 — meine erste IFR-Strecke"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">{title.length} / 200</div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Excerpt (optional — wird sonst auto-generiert)
        </label>
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Kurze zusammenfassung für die feed-anzeige."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">{excerpt.length} / 500</div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Body
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={50000}
          rows={20}
          placeholder="Schreibe deinen blog-post. Plaintext, line-breaks bleiben erhalten."
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">
          {body.length.toLocaleString('de-DE')} / 50.000
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || title.length < 3 || body.length < 10}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Speichere…' : isEdit ? 'Speichern' : 'Draft erstellen'}
        </button>

        {isEdit && (
          <>
            <button
              type="button"
              onClick={handlePublishToggle}
              disabled={isPending}
              className={`rounded-md border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                isPublished
                  ? 'border-orange-500/30 bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 dark:text-orange-300'
                  : 'border-green-500/30 bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:text-green-300'
              }`}
            >
              {isPublished ? 'Unpublish (zurück zu Draft)' : 'Publish (public machen)'}
            </button>

            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="ml-auto rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
            >
              Löschen
            </button>
          </>
        )}
      </div>
    </div>
  );
}
