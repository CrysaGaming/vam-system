'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createRole,
  updateRole,
  deleteRole,
  type RoleListItem,
} from './actions';

interface Props {
  roles: RoleListItem[];
}

type EditorState =
  | { kind: 'closed' }
  | { kind: 'new' }
  | { kind: 'edit'; roleId: string };

/**
 * Client-side card managing the full role lifecycle: list view, inline
 * editor for create + edit, delete confirm. State pattern follows the
 * Fleet-overlay-card established Day-4 — single editor open at a time
 * (closed | new | edit:roleId) so the UI never has two competing forms.
 */
export function RoleManagement({ roles }: Props) {
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Find role being edited (if any). undefined when editor.kind !== 'edit'.
  const editingRole =
    editor.kind === 'edit'
      ? roles.find((r) => r.id === editor.roleId)
      : undefined;

  function handleSubmit(formData: FormData) {
    setError(null);
    const description = (formData.get('description') as string).trim() || null;
    // Permissions are entered as comma- or newline-separated strings. Trim
    // each entry, drop empties. We don't validate against any allowlist
    // here — the schema is intentionally open-ended to let admins define
    // custom permission strings without a code change.
    const permsRaw = (formData.get('permissions') as string) ?? '';
    const permissions = permsRaw
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (editor.kind === 'new') {
      const name = (formData.get('name') as string).trim();
      startTransition(async () => {
        try {
          await createRole({ name, description, permissions });
          setEditor({ kind: 'closed' });
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
        }
      });
    } else if (editor.kind === 'edit') {
      const roleId = editor.roleId;
      startTransition(async () => {
        try {
          await updateRole(roleId, { description, permissions });
          setEditor({ kind: 'closed' });
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
        }
      });
    }
  }

  function handleDelete(role: RoleListItem) {
    setError(null);
    if (
      !confirm(
        `Rolle "${role.name}" wirklich löschen? ` +
          `Dieser Schritt kann nicht rückgängig gemacht werden.`,
      )
    )
      return;

    startTransition(async () => {
      try {
        await deleteRole(role.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Rollen</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Rollen-Definitionen mit Permissions. System-Rollen ({' '}
            <code className="text-xs">admin, instructor, pilot, trainee</code>{' '}
            ) sind nicht löschbar — sie sind im Code namentlich referenziert.
          </p>
        </div>
        {editor.kind === 'closed' && (
          <button
            type="button"
            onClick={() => setEditor({ kind: 'new' })}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold transition"
          >
            + Neue Rolle
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded border bg-red-500/10 border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Role list */}
      <div className="space-y-2 mb-6">
        {roles.length === 0 && (
          <p className="text-sm text-gray-500 italic text-center py-8">
            Keine Rollen definiert. Klick "+ Neue Rolle" um zu starten.
          </p>
        )}
        {roles.map((role) => (
          <div
            key={role.id}
            className="flex items-center justify-between gap-4 px-4 py-3 bg-gray-100 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 rounded"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <code className="font-mono text-sm font-semibold">
                  {role.name}
                </code>
                {role.isSystem && (
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-300">
                    System
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {role.userCount} {role.userCount === 1 ? 'User' : 'User'} ·{' '}
                  {role.permissions.length}{' '}
                  {role.permissions.length === 1
                    ? 'Permission'
                    : 'Permissions'}
                </span>
              </div>
              {role.description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 truncate">
                  {role.description}
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditor({ kind: 'edit', roleId: role.id })}
                disabled={editor.kind !== 'closed' || pending}
                className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Bearbeiten
              </button>
              <button
                type="button"
                onClick={() => handleDelete(role)}
                disabled={
                  role.isSystem ||
                  role.userCount > 0 ||
                  editor.kind !== 'closed' ||
                  pending
                }
                title={
                  role.isSystem
                    ? 'System-Rolle, kann nicht gelöscht werden'
                    : role.userCount > 0
                      ? `${role.userCount} User noch zugewiesen`
                      : 'Rolle löschen'
                }
                className="px-3 py-1.5 text-xs bg-red-900/40 hover:bg-red-900/60 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Löschen
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Editor (create or edit) */}
      {(editor.kind === 'new' || editor.kind === 'edit') && (
        <form
          action={handleSubmit}
          className="border-t border-gray-200 dark:border-gray-800 pt-6 space-y-4"
        >
          <h3 className="text-sm uppercase tracking-wider text-gray-500">
            {editor.kind === 'new'
              ? 'Neue Rolle'
              : `Rolle bearbeiten: ${editingRole?.name}`}
          </h3>

          {editor.kind === 'new' && (
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Name
              </label>
              <input
                type="text"
                name="name"
                required
                pattern="[a-z][a-z0-9_-]*"
                minLength={2}
                maxLength={40}
                placeholder="z. B. dispatcher, ground_ops"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono focus:border-indigo-500 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Nur Kleinbuchstaben, Ziffern, "-" und "_". Beginnt mit Buchstabe.
                Wird im Code referenziert — sorgfältig wählen.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Beschreibung
            </label>
            <input
              type="text"
              name="description"
              maxLength={500}
              defaultValue={editingRole?.description ?? ''}
              placeholder="Optional — kurze Erklärung was diese Rolle darf"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Permissions
            </label>
            <textarea
              name="permissions"
              rows={3}
              defaultValue={editingRole?.permissions.join('\n') ?? ''}
              placeholder={'z. B.\napprove.pireps\nmanage.fleet\nedit.routes'}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Eine Permission pro Zeile (oder Komma-getrennt). Aktuell rein
              informativ — das Code-Gating nutzt noch <code>role.name</code>{' '}
              statt <code>permissions</code>.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={pending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold transition disabled:opacity-50"
            >
              {pending ? 'Speichern…' : 'Speichern'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditor({ kind: 'closed' });
                setError(null);
              }}
              disabled={pending}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-sm transition"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
