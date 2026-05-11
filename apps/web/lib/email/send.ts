import { getResendClient, getEmailFrom } from './client';

/**
 * Track 4 #82 (Section P) — Email-send wrapper.
 *
 * Thin layer über Resend's send-API der:
 *   1. **No-op'ed wenn kein client** — wenn `RESEND_API_KEY` fehlt, returnt
 *      die funktion `{ sent: false, reason: 'no_client' }` OHNE zu throwen.
 *      Call-site loggt das + macht weiter. Niemals soll ein missing-key
 *      einen approval-flow brechen.
 *   2. **Error-resilient** — fehlschläge bei Resend (network, 4xx, rate-
 *      limit) werden gefangen und als `{ sent: false, reason: 'failed',
 *      error }` zurückgegeben. Call-site loggt + macht weiter.
 *   3. **Standardized return** — discriminated union, kein throw. Macht
 *      es dem call-site einfach zu unterscheiden zwischen "absichtlich
 *      nicht gesendet" und "send-versuch ist fehlgeschlagen".
 *
 * # Why kein throw?
 *
 * Emails sind eine SEKUNDÄRE benachrichtigung. Der primäre flow (PIREP-
 * approval, kudos, etc.) muss IMMER erfolgreich sein — auch wenn die
 * email nicht raus geht. Wenn wir hier throwen, müsste jeder call-site
 * try/catch'en, und ein einzelner fehler (z.B. resend hat outage) würde
 * den approval-button broken aussehen lassen. Mit silent-no-op-pattern
 * ist email genuin opt-in side-effect.
 *
 * # Idempotency
 *
 * Keine eingebaute idempotency — wenn ein call-site denselben
 * `sendEmail()` zweimal aufruft (z.B. doppel-approval bei race-condition),
 * gehen zwei emails raus. Das ist beim approval-flow ok weil die
 * `pirep.status !== 'Submitted'`-guard in approvePirep ein doppel-approve
 * schon im DB-layer verhindert.
 */

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: 'no_client' }
  | { sent: false; reason: 'failed'; error: string };

export type SendEmailInput = {
  /** Empfänger-adresse(n). Kann ein single email oder array von emails sein. */
  to: string | string[];
  /** Subject-line. Sollte NICHT abgekürzt sein — gmail/outlook truncaten ab ~70 chars. */
  subject: string;
  /** HTML-body. Plain-text fallback wird automatisch von Resend generiert wenn `text` nicht gesetzt ist. */
  html: string;
  /** Optional explicit plain-text version (für clients die kein HTML rendern oder für besseren spam-score). */
  text?: string;
  /** Optional reply-to address — wenn user antwortet, geht's an diese addr (statt EMAIL_FROM). */
  replyTo?: string;
};

/**
 * Send a transactional email via Resend. Returns a discriminated-union
 * result so call-sites can log appropriately ohne try/catch boilerplate.
 *
 * @example
 *   const result = await sendEmail({
 *     to: pilot.email,
 *     subject: `PIREP ${flightNumber} wurde genehmigt`,
 *     html: pirepApprovedTemplate({...}).html,
 *   });
 *   if (!result.sent) {
 *     console.info(`[email] send skipped/failed: ${result.reason}`);
 *   }
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getResendClient();
  if (!client) {
    return { sent: false, reason: 'no_client' };
  }

  try {
    const { data, error } = await client.emails.send({
      from: getEmailFrom(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      // Resend will auto-derive a text-version from HTML if we don't pass one,
      // aber wenn wir einen expliziten text haben, ist der oft kompakter +
      // besser strukturiert für screen-readers.
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });

    if (error) {
      // Resend returns errors as { name, message } objects rather than
      // throws. Normalize to a string for logging.
      return {
        sent: false,
        reason: 'failed',
        error: `${error.name}: ${error.message}`,
      };
    }

    if (!data?.id) {
      // Defensive — sollte nicht passieren wenn error null ist, aber
      // wenn Resend's API-vertrag mal bricht, fail loud.
      return { sent: false, reason: 'failed', error: 'no_id_returned' };
    }

    return { sent: true, id: data.id };
  } catch (err) {
    // Network-fehler, JSON-parse-fehler, etc. — alles was Resend nicht
    // selbst als structured-error returned.
    return {
      sent: false,
      reason: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
