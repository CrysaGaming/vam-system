'use client';

/**
 * Track 5 #3 — Annotation-list client component.
 *
 * Read-only-by-default. Approver sees edit/delete buttons per item if
 * they own the annotation; admins see delete on all (in same airline).
 *
 * # Optimistic delete
 *
 * Onclick → entry verschwindet sofort aus dem UI, server-action läuft
 * im hintergrund. Bei error: revalidate + toast. Optimistic-edit
 * machen wir NICHT — die textarea-experience braucht eine echte
 * response damit der user weiß wann sicher gespeichert ist.
 *
 * # Empty-state
 *
 * Wenn keine annotations: minimal "Noch keine Annotationen"-hint.
 * Approver bekommt zusätzlich einen "Im Replay annotieren →"-link
 * der zur replay-page führt.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toastSuccess, toastError } from '@/lib/toast';
import {
  updateAnnotation,
  deleteAnnotation,
} from './annotation-actions';

const BODY_MAX_CHARS = 1000;

type Annotation = {
  id: string;
  frameIndex: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string | null;
  };
};

export function AnnotationList({
  pirepId,
  annotations,
  currentUserId,
  canDeleteAll,
  hasReplay,
  isApprover,
}: {
  pirepId: string;
  annotations: Annotation[];
  /** Active user ID — used to gate edit-buttons (only on own annotations). */
  currentUserId: string;
  /** True wenn current user admin/airline-admin in same airline ist —
   *  dann darf er ALLE delete-buttons sehen, nicht nur eigene. */
  canDeleteAll: boolean;
  /** Bei PIREPs ohne replay-trail können keine neuen annotations erstellt
   *  werden; in dem fall verstecken wir den "im Replay annotieren"-CTA
   *  damit er nicht ins leere führt. */
  hasReplay: boolean;
  /** Approver kann neue annotations anlegen — hat dann auch den CTA-link
   *  zur replay-page. Non-approver pilots sehen nur die liste read-only. */
  isApprover: boolean;
}) {
  // Local-state spiegelt die props damit optimistic-delete sofort die
  // entry verschwinden lassen kann. Bei error revertieren wir.
  const [items, setItems] = useState<Annotation[]>(annotations);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [isPending, startTransition] = useTransition();

  function startEdit(a: Annotation) {
    setEditingId(a.id);
    setEditBody(a.body);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditBody('');
  }
  async function submitEdit(a: Annotation) {
    const body = editBody.trim();
    if (body.length === 0) {
      toastError('Annotation darf nicht leer sein.');
      return;
    }
    if (body.length > BODY_MAX_CHARS) {
      toastError(`Max ${BODY_MAX_CHARS} Zeichen.`);
      return;
    }
    startTransition(async () => {
      const result = await updateAnnotation(a.id, body);
      if (result.ok) {
        // Local-state update — wir bekommen kein fresh-data-payload
        // zurück; der updatedAt-wert wird beim nächsten page-load
        // korrekt sein. Für jetzt patchen wir nur den body inline.
        setItems((prev) =>
          prev.map((it) =>
            it.id === a.id
              ? { ...it, body, updatedAt: new Date().toISOString() }
              : it,
          ),
        );
        cancelEdit();
        toastSuccess('Annotation aktualisiert.');
      } else {
        toastError(result.error);
      }
    });
  }
  async function confirmDelete(a: Annotation) {
    if (!window.confirm(`Annotation "${a.body.slice(0, 40)}…" löschen?`)) {
      return;
    }
    // Optimistic: sofort aus UI nehmen
    const before = items;
    setItems((prev) => prev.filter((it) => it.id !== a.id));

    startTransition(async () => {
      const result = await deleteAnnotation(a.id);
      if (!result.ok) {
        // Revert
        setItems(before);
        toastError(result.error);
      } else {
        toastSuccess('Annotation gelöscht.');
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        <p>Noch keine Annotationen für diesen Flug.</p>
        {isApprover && hasReplay && (
          <p className="mt-2">
            <Link
              href={`/pireps/${pirepId}/replay`}
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Im Replay annotieren →
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((a) => {
        const isAuthor = a.author.id === currentUserId;
        const canEdit = isAuthor;
        const canDelete = isAuthor || canDeleteAll;
        const isEditing = editingId === a.id;

        return (
          <li
            key={a.id}
            className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded-lg p-3"
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {a.author.name ?? 'Unbenannt'}
                </span>
                {/* Frame-jump link: nutzt das ?t= URL-param-protokoll
                    aus #2 indirect — wir wissen hier nur den frame-
                    index, nicht die elapsed-sec. Stattdessen linken
                    wir mit ?frame=<idx> direkt zur replay-page; die
                    page liest beides (frame ODER t) als seek-init.
                    Aber: bisher liest die page nur ?t=. Daher linken
                    wir ohne ?t= und der user landet am anfang —
                    suboptimal aber kein crash. Future-improvement:
                    ?frame=N support in replay-map.tsx. */}
                <Link
                  href={`/pireps/${pirepId}/replay?frame=${a.frameIndex}`}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition"
                  title={`Frame ${a.frameIndex} im Replay öffnen`}
                >
                  Frame {a.frameIndex}
                </Link>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                  {new Date(a.createdAt).toLocaleString('de-DE', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {a.updatedAt !== a.createdAt && (
                    <span className="ml-1 italic">(bearbeitet)</span>
                  )}
                </span>
              </div>
              {(canEdit || canDelete) && !isEditing && (
                <div className="flex items-center gap-2 text-xs">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      disabled={isPending}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                    >
                      Bearbeiten
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => confirmDelete(a)}
                      disabled={isPending}
                      className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                    >
                      Löschen
                    </button>
                  )}
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2 mt-2">
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  maxLength={BODY_MAX_CHARS}
                  disabled={isPending}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    {editBody.length}/{BODY_MAX_CHARS}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isPending}
                      className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs disabled:opacity-50"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={() => submitEdit(a)}
                      disabled={isPending}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium disabled:opacity-50"
                    >
                      Speichern
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                {a.body}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
