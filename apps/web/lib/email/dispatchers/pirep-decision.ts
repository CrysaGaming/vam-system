import { sendEmail } from '../send';
import {
  renderPirepApprovedEmail,
  renderPirepRejectedEmail,
  type PirepEmailContext,
  type PirepRejectedContext,
} from '../templates/pirep-decision';
import { getPref, parsePrefs } from '@/lib/notification-prefs';

/**
 * Track 4 #82 (Section P) — Dispatcher für PIREP-Entscheidungs-emails.
 *
 * Bündelt die ganze pipeline (pref-check, URL-build, template-render,
 * send) in einer kleinen funktion damit `pireps/actions.ts` nur einen
 * call braucht statt 5 lines boilerplate. Returns NIE einen throw —
 * alle errors werden eingefangen + geloggt.
 *
 * # Pipeline
 *
 *   1. Parse rohe `userNotificationPrefs` Json → typed NotificationPrefs
 *   2. getPref(prefs, 'pirepDecision', 'email') → bei false: silent skip
 *   3. Wenn `userEmail` null/leer: silent skip (kein recipient)
 *   4. Build `pirepUrl` aus AUTH_URL env + /pireps/<id>
 *   5. Render template (approved oder rejected)
 *   6. sendEmail → bei fail: log warning, kein throw
 *
 * # Why pref-check HIER statt in der action?
 *
 * Damit ein call-site nur eine zeile schreibt. Wenn jeder action-handler
 * die getPref-logic dupliziert, gibt's drift wenn wir später z.B. eine
 * "globaler kill-switch"-pref oder quiet-hours dazu nehmen. Zentral hier
 * = ein punkt zum erweitern.
 */

/**
 * Build a fully-qualified URL zur PIREP-detail-page. Wenn AUTH_URL nicht
 * gesetzt ist, fällt das auf relativen pfad zurück — emails sehen dann
 * "klicke /pireps/abc123" statt "klicke https://...", was unschön ist
 * aber funktional weil viele email-clients relative-paths gegen den
 * sender-domain auflösen.
 *
 * Trailing-slash auf AUTH_URL wird gestripped damit nicht `//pireps`
 * entsteht.
 */
function buildPirepUrl(pirepId: string): string {
  const base = (process.env.AUTH_URL ?? '').trim().replace(/\/$/, '');
  if (!base) {
    return `/pireps/${pirepId}`;
  }
  return `${base}/pireps/${pirepId}`;
}

export type PirepDecisionDispatchInput = {
  /** PIREP-id für die URL + logging. */
  pirepId: string;
  /** Empfänger email-addr. NULL = silent skip (user hat keine email — sollte nicht passieren weil email @unique ist). */
  userEmail: string | null;
  /** Empfänger name für die anrede (User.name). NULL = "Pilot" fallback. */
  userName: string | null;
  /**
   * Raw notification-prefs Json vom user-record. Wird intern via parsePrefs
   * geparst, dann gegen 'pirepDecision' + 'email' gegated.
   */
  userNotificationPrefs: unknown;
  /** Flightnumber für subject + body. Fallback "PIREP" wenn route fehlt. */
  flightNumber: string;
  /** Departure ICAO. */
  departureIcao: string;
  /** Arrival ICAO. */
  arrivalIcao: string;
  /** Name des admins der approved/rejected hat. */
  approverName: string;
};

/**
 * Send the "PIREP approved" email if the pilot has opted in. Silently
 * skips if (a) email-pref is off, (b) pilot has no email, oder (c)
 * RESEND_API_KEY ist nicht gesetzt (sendEmail returnt no_client).
 *
 * All log-output is `console.info` for skipped-paths + `console.warn`
 * für unexpected-failures. Niemals throws.
 */
export async function dispatchPirepApprovedEmail(
  input: PirepDecisionDispatchInput,
): Promise<void> {
  const prefs = parsePrefs(input.userNotificationPrefs);
  if (!getPref(prefs, 'pirepDecision', 'email')) {
    return; // user opted out, silent
  }
  if (!input.userEmail || input.userEmail.trim().length === 0) {
    console.info(
      `[email] skipped pirep-approved for ${input.pirepId}: no recipient email on user record`,
    );
    return;
  }

  const ctx: PirepEmailContext = {
    pilotName: input.userName,
    flightNumber: input.flightNumber,
    departureIcao: input.departureIcao,
    arrivalIcao: input.arrivalIcao,
    approverName: input.approverName,
    pirepUrl: buildPirepUrl(input.pirepId),
  };

  const { subject, html, text } = renderPirepApprovedEmail(ctx);
  const result = await sendEmail({
    to: input.userEmail,
    subject,
    html,
    text,
  });

  if (result.sent) {
    console.info(
      `[email] pirep-approved sent to ${input.userEmail} (resend-id: ${result.id})`,
    );
  } else if (result.reason === 'failed') {
    console.warn(
      `[email] pirep-approved send FAILED for ${input.pirepId} → ${input.userEmail}: ${result.error}`,
    );
  }
  // reason === 'no_client' wird schon vom client.ts beim boot geloggt;
  // pro send nochmal log wäre noise.
}

/**
 * Send the "PIREP rejected" email if the pilot has opted in. Same
 * gating + error-handling als der approved-dispatcher.
 *
 * Reason ist required hier (rejectPirep enforced min-length=3 client-
 * + server-side), daher kein null-check.
 */
export async function dispatchPirepRejectedEmail(
  input: PirepDecisionDispatchInput & { reason: string },
): Promise<void> {
  const prefs = parsePrefs(input.userNotificationPrefs);
  if (!getPref(prefs, 'pirepDecision', 'email')) {
    return; // user opted out
  }
  if (!input.userEmail || input.userEmail.trim().length === 0) {
    console.info(
      `[email] skipped pirep-rejected for ${input.pirepId}: no recipient email on user record`,
    );
    return;
  }

  const ctx: PirepRejectedContext = {
    pilotName: input.userName,
    flightNumber: input.flightNumber,
    departureIcao: input.departureIcao,
    arrivalIcao: input.arrivalIcao,
    approverName: input.approverName,
    pirepUrl: buildPirepUrl(input.pirepId),
    reason: input.reason,
  };

  const { subject, html, text } = renderPirepRejectedEmail(ctx);
  const result = await sendEmail({
    to: input.userEmail,
    subject,
    html,
    text,
  });

  if (result.sent) {
    console.info(
      `[email] pirep-rejected sent to ${input.userEmail} (resend-id: ${result.id})`,
    );
  } else if (result.reason === 'failed') {
    console.warn(
      `[email] pirep-rejected send FAILED for ${input.pirepId} → ${input.userEmail}: ${result.error}`,
    );
  }
}
