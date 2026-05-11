'use client';

import { toast as sonnerToast, type ExternalToast } from 'sonner';

/**
 * Track 4 #80 (Section P) — Standardized toast-API.
 *
 * Wrapper um sonner's `toast.success` / `toast.error` / `toast.info` /
 * `toast.warning` mit:
 *
 *   1. **Unified error-extraction**: `toastError(err)` akzeptiert alles
 *      (Error-instance, string, FormResult.error-shape, unknown) und
 *      extrahiert eine human-readable message konsistent. Vorher hatten
 *      verschiedene call-sites verschiedene patterns:
 *        - `toast.error(e instanceof Error ? e.message : 'Unbekannter Fehler')`
 *        - `toast.error(formatError(result.error))`
 *        - `toast.error('Hardcoded message')`
 *      Jetzt einheitlich: `toastError(err)` — der wrapper macht das richtige.
 *
 *   2. **Standard-durations**: alle success-toasts default 4s, errors 6s
 *      (errors brauchen mehr lesezeit), info 4s, warning 5s. Vorher
 *      übernahm jeder call-site sonner's default (~4s für alles).
 *
 *   3. **`toastPromise(promise, msgs)`**: async-operations bekommen einen
 *      loading-spinner-toast der bei resolve/reject zu success/error
 *      transitioniert. Pattern bisher: separate `toast.loading()` +
 *      manuelles `toast.success/error` + `dismiss()` — fehler-anfällig
 *      und verbose.
 *
 *   4. **`extractErrorMessage(err)`**: exposed helper für edge-cases wo
 *      nicht der toast selbst aber die error-message gebraucht wird
 *      (z.B. inline error-display unter form-field).
 *
 * # Was bleibt sonner-direkt
 *
 * Custom-toasts mit JSX-content (`toast.custom(<Component />)`) oder
 * persistent-toasts mit action-buttons rendern wir bei bedarf weiterhin
 * direkt mit `sonner`'s API — der wrapper deckt nur die 90%-cases
 * (string-message in/string-message out).
 *
 * # Toaster-mount
 *
 * Sonner's `<Toaster>` wird in `components/Providers.tsx` einmal global
 * gemounted (top-right, richColors, closeButton). Diese wrapper-funktionen
 * targeten dorthin — kein zweiter Toaster nötig.
 */

// ─────────────────────────────────────────────────────────────────────────
// Standard-durations (in milliseconds)
// ─────────────────────────────────────────────────────────────────────────

/** Erfolgreiche aktion: kurz aber lang genug zum lesen. */
const DURATION_SUCCESS = 4000;
/** Fehler: längere lesezeit damit user die ursache verstehen kann. */
const DURATION_ERROR = 6000;
/** Neutrale info: standard-länge. */
const DURATION_INFO = 4000;
/** Warning: mid-zwischen-info-und-error. */
const DURATION_WARNING = 5000;

// ─────────────────────────────────────────────────────────────────────────
// Error-extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extracts a human-readable message from anything. Used internally by
 * `toastError` and exposed for direct use when only the string is needed
 * (e.g. inline error-display under a form-field).
 *
 * Recognized shapes (in priority order):
 *   1. `string` — returned as-is.
 *   2. `Error` instance — returns `.message`.
 *   3. `{ message: string }` — duck-type for error-like objects.
 *   4. `{ error: string }` — common server-action FormResult shape.
 *   5. `null` / `undefined` — generic fallback.
 *   6. fallback: `JSON.stringify(err)` truncated, or generic message
 *      if stringify fails (circular refs, BigInt, etc.).
 */
export function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err == null) return 'Unbekannter Fehler';

  if (typeof err === 'object') {
    // Duck-type: { message: string }
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    // Server-action FormResult: { error: string }
    if ('error' in err && typeof (err as { error: unknown }).error === 'string') {
      return (err as { error: string }).error;
    }
  }

  // Last resort: stringify. Truncate at 200 chars damit ein {} mit
  // 50 keys nicht den toast sprengt.
  try {
    const str = JSON.stringify(err);
    return str.length > 200 ? str.slice(0, 197) + '…' : str;
  } catch {
    return 'Unbekannter Fehler';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Show a success toast. Default duration 4s.
 *
 * @example
 *   toastSuccess('Gespeichert');
 *   toastSuccess('PIREP eingereicht', { description: 'Approval pending.' });
 */
export function toastSuccess(message: string, options?: ExternalToast): string | number {
  return sonnerToast.success(message, {
    duration: DURATION_SUCCESS,
    ...options,
  });
}

/**
 * Show an error toast. Accepts any error-shape and extracts a message.
 * Default duration 6s (longer than success because errors need more
 * lesezeit).
 *
 * @example
 *   try { ... } catch (e) { toastError(e); }
 *   toastError('Network unreachable');
 *   toastError(result.error); // server-action FormResult shape
 *   toastError({ message: 'Custom error' });
 */
export function toastError(err: unknown, options?: ExternalToast): string | number {
  return sonnerToast.error(extractErrorMessage(err), {
    duration: DURATION_ERROR,
    ...options,
  });
}

/**
 * Show a neutral info toast. Default duration 4s.
 *
 * @example
 *   toastInfo('5 PIREPs warten auf Prüfung');
 */
export function toastInfo(message: string, options?: ExternalToast): string | number {
  return sonnerToast.info(message, {
    duration: DURATION_INFO,
    ...options,
  });
}

/**
 * Show a warning toast. Default duration 5s.
 *
 * @example
 *   toastWarning('SimBrief-Account nicht verifiziert');
 */
export function toastWarning(message: string, options?: ExternalToast): string | number {
  return sonnerToast.warning(message, {
    duration: DURATION_WARNING,
    ...options,
  });
}

/**
 * Wrap an async-operation with loading → success/error transition. Sonner
 * handles the lifecycle (single toast-id, smooth swap).
 *
 * @example
 *   await toastPromise(
 *     submitPirep(data),
 *     {
 *       loading: 'PIREP wird übermittelt…',
 *       success: 'PIREP eingereicht',
 *       error: (e) => `Fehlgeschlagen: ${extractErrorMessage(e)}`,
 *     }
 *   );
 *
 * `success` und `error` können entweder strings sein ODER funktionen
 * die das resolved/rejected value bekommen für dynamische messages.
 */
export function toastPromise<T>(
  promise: Promise<T>,
  msgs: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((err: unknown) => string);
  },
  options?: ExternalToast,
): string | number {
  // sonner's `toast.promise` returns the toast-id directly.
  // Wir wrappen den error-callback damit er extractErrorMessage nutzt
  // wenn ein string übergeben wurde — sonst zeigt sonner default die
  // raw error-stringification, was inkonsistent zu toastError ist.
  const errorHandler =
    typeof msgs.error === 'string'
      ? msgs.error
      : (err: unknown) => msgs.error instanceof Function ? msgs.error(err) : extractErrorMessage(err);

  return sonnerToast.promise(promise, {
    loading: msgs.loading,
    success: msgs.success,
    error: errorHandler,
    ...options,
  }) as unknown as string | number;
}

/**
 * Dismiss a specific toast (or all toasts wenn id=undefined). Re-export
 * für convenience damit call-sites nicht zusätzlich `import { toast } from
 * 'sonner'` machen müssen.
 */
export function dismissToast(id?: string | number): void {
  sonnerToast.dismiss(id);
}
