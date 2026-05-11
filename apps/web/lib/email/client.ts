import { Resend } from 'resend';

/**
 * Track 4 #82 (Section P) — Resend client (lazy-initialized).
 *
 * # Why lazy + nullable
 *
 * Email-dispatch ist OPTIONAL. Wenn der admin keine `RESEND_API_KEY`
 * gesetzt hat (z.B. self-hosted dev-instance ohne mail-provider), soll
 * der server trotzdem fehlerfrei starten + die ganze app weiter funktio-
 * nieren — emails werden dann silently no-op'ed (siehe `lib/email/send.ts`
 * für das gating).
 *
 * Wir initialisieren den client beim ERSTEN `getResendClient()`-call
 * (module-load-time-init würde immer eine Resend-instance machen, auch
 * wenn nie eine email gesendet wird — minimal overhead aber unsauber).
 * Bei wiederholten calls wird die instance gecached.
 *
 * # Why nicht direkt `new Resend(...)` exportieren
 *
 * Direkter export würde `RESEND_API_KEY` zur module-load-time evaluieren,
 * was zwei probleme verursacht:
 *   1. Wenn `RESEND_API_KEY` fehlt, würde Resend's constructor entweder
 *      throwen oder ein invalides client-object zurückgeben — call-site
 *      hätte keine chance vor dem ersten send zu prüfen.
 *   2. Tests die env-vars setzen NACH dem import (z.B. test-setup-hooks)
 *      würden alte werte sehen.
 *
 * Lazy-init umgeht beides: env-var wird beim ersten use evaluiert, nicht
 * beim import.
 */

let cachedClient: Resend | null = null;
let initialized = false;

/**
 * Returns a Resend client instance, or `null` if `RESEND_API_KEY` is not
 * configured. Callers MUST check for null and handle the "no-email" case
 * gracefully (siehe `sendEmail()` für das standard-pattern).
 *
 * Re-uses the same instance across calls (module-level cache). Resend's
 * client is stateless (just wraps fetch), so caching is purely for
 * avoiding re-construction overhead.
 */
export function getResendClient(): Resend | null {
  if (initialized) return cachedClient;

  initialized = true;
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || apiKey.trim().length === 0) {
    // Wir loggen das EINMAL zur boot-zeit damit der admin sieht "ah,
    // emails sind off". Nicht warnings für jeden send — das wäre log-spam.
    // eslint-disable-next-line no-console
    console.info(
      '[email] RESEND_API_KEY not configured — email-dispatch is disabled (no-op).',
    );
    cachedClient = null;
    return null;
  }

  cachedClient = new Resend(apiKey);
  return cachedClient;
}

/**
 * The "From"-address für alle outgoing emails. Liest `EMAIL_FROM` aus
 * env, fällt auf einen sinnvollen default zurück damit die app auch ohne
 * explicit-config nicht throwed (resend nimmt die fallback-domain dann
 * von dort, was bei free-tier `onboarding@resend.dev` ist).
 *
 * Format kann entweder ein nur-mail-adresse sein ("noreply@vam.example")
 * oder ein "Display Name <addr@domain>" string — Resend akzeptiert beides.
 *
 * Wenn der admin eine eigene domain bei Resend verifiziert hat, sollte
 * EMAIL_FROM auf `VAM System <noreply@deine-domain.de>` gesetzt werden
 * damit emails nicht als "via resend.dev" markiert sind.
 */
export function getEmailFrom(): string {
  const configured = process.env.EMAIL_FROM?.trim();
  if (configured && configured.length > 0) return configured;
  // Resend's verified sandbox-sender — funktioniert ohne domain-setup,
  // landed aber öfter im spam. Ok als dev-fallback.
  return 'VAM System <onboarding@resend.dev>';
}
