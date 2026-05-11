/**
 * Track 4 #82 (Section P) — PIREP-Entscheidungs-emails (Templates).
 *
 * Pure functions die HTML + text returnen — kein side-effect, kein I/O.
 * Wird von `pireps/actions.ts` `approvePirep` + `rejectPirep` aufgerufen
 * nach der DB-update, gated via getPref(prefs, 'pirepDecision', 'email').
 *
 * # Design-philosophie
 *
 * **Inline-CSS only.** Email-clients (Gmail, Outlook, Apple Mail, etc)
 * strippen <style>-blocks im head, supporten viele CSS-features nicht
 * (kein flexbox, kein grid, kein CSS-vars). Wir nutzen nur:
 *   - inline `style="..."` attributes
 *   - table-basierte layouts (max compat mit Outlook)
 *   - Hex-color statt named-colors
 *   - explicit font-stack inkl. fallbacks
 *
 * **Mobile-first via max-width.** Wir setzen container auf
 * `max-width: 600px` mit `width: 100%` — passt auf desktop UND auf
 * smartphone-screens ohne media-queries (die wieder in style-blocks
 * sein müssten).
 *
 * **Dark-mode-readable.** Wir bleiben bei einfachen contrast-pairs
 * (dunkles text auf hellem hintergrund). Gmail's dark-mode invertiert
 * automatisch wenn die palette einfach ist; complexere themes brauchen
 * `@media (prefers-color-scheme)` was wieder style-blocks erfordern
 * würde. Kompromiss: emails sehen im light-mode hübsch aus, im dark-
 * mode lesbar (nicht perfekt aber lesbar).
 *
 * **Plain-text companion.** Jedes template exportiert eine `text`-version
 * — accessibility (screen-reader), spam-score (mail-server gewichten
 * text/html-paare höher als pure-HTML), und fallback für plain-text-only
 * email-clients (bsplsw. terminal-mail).
 *
 * # Was wir NICHT machen
 *
 * - Kein react-email — overkill für zwei templates, eigene runtime+deps.
 * - Keine custom-fonts — system-fonts (Arial/Helvetica fallback) sind
 *   konsistent über alle email-clients.
 * - Keine images/logos — bilder werden in vielen email-clients standard-
 *   mäßig blockiert ("display images?"-button). Pure-text wirkt
 *   trustworthier + lädt instant.
 * - Keine tracking-pixel — wir wollen kein read-tracking, das ist creepy
 *   für transactional emails.
 */

export type PirepEmailContext = {
  /** Empfänger-name für die anrede ("Hallo Kevin"). Fallback "Pilot" wenn null. */
  pilotName: string | null;
  /** Flightnumber oder "PIREP" fallback wenn route fehlt. */
  flightNumber: string;
  /** Departure ICAO ("EDDF"). */
  departureIcao: string;
  /** Arrival ICAO ("LOWW"). */
  arrivalIcao: string;
  /** Name des admins/approvers der die entscheidung getroffen hat. */
  approverName: string;
  /**
   * Voller link zur PIREP-detail-page, z.B. "https://vam.kevindrack.de/pireps/abc123".
   * Wird vom call-site gebaut via process.env.AUTH_URL + /pireps/${id}.
   * Wenn AUTH_URL nicht gesetzt ist, fällt der call-site auf einen relativen
   * pfad zurück und der user klickt halt direkt aus seiner inbox-history
   * heraus drauf — nicht ideal aber kein blocker.
   */
  pirepUrl: string;
};

export type PirepRejectedContext = PirepEmailContext & {
  /** Begründung vom approver — wird im email als blockquote angezeigt. */
  reason: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Shared style + layout primitives
// ─────────────────────────────────────────────────────────────────────────

// System-font-stack — kein external-font-load nötig + identisch zu was
// die user eh in ihrer inbox sehen.
const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Baue ein HTML-document mit standard-header/footer drumrum. Inner-content
 * wird als string in den main-body eingesetzt. Inline-CSS only.
 *
 * Layout:
 *   ┌───────────────────────────────────┐
 *   │ Header (gradient bar)             │
 *   ├───────────────────────────────────┤
 *   │                                   │
 *   │   <inner content>                 │
 *   │                                   │
 *   ├───────────────────────────────────┤
 *   │ Footer (klein, grau, mit          │
 *   │ unsubscribe-hint)                 │
 *   └───────────────────────────────────┘
 */
function htmlShell({
  accentColor,
  preheader,
  innerHtml,
}: {
  /** Header-bar color (green=approved, red=rejected, etc.) */
  accentColor: string;
  /** Preview-text der im inbox-listing erscheint (z.B. neben subject). Wird optisch versteckt. */
  preheader: string;
  /** Main-content HTML (table-cells, paragraphs, button). */
  innerHtml: string;
}): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VAM System</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f4f6; font-family:${FONT_FAMILY}; color:#111827;">
  <!-- Preheader: shown in inbox preview, hidden in email body via inline-styles -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#f3f4f6;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Accent bar (top) -->
          <tr>
            <td style="background-color:${accentColor}; height:4px; line-height:4px; font-size:0;">&nbsp;</td>
          </tr>
          <!-- Brand-line -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <div style="font-size:13px; font-weight:600; color:#6b7280; letter-spacing:0.05em; text-transform:uppercase;">VAM System</div>
            </td>
          </tr>
          <!-- Inner content -->
          <tr>
            <td style="padding:16px 32px 32px 32px; font-size:15px; line-height:1.6; color:#111827;">
              ${innerHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb; border-top:1px solid #e5e7eb; padding:16px 32px; font-size:12px; line-height:1.5; color:#6b7280;">
              Du erhältst diese E-Mail weil du in deinen <a href="${escapeHtml(safeUrl(process.env.AUTH_URL ?? ''))}/settings/notifications" style="color:#4f46e5; text-decoration:underline;">Benachrichtigungs-Einstellungen</a> die Kategorie &quot;PIREP-Entscheidung&quot; aktiviert hast.<br />
              Du kannst E-Mails dort jederzeit pro Kategorie aus- oder anschalten.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * HTML-escape damit user-content (pilot-name, rejection-reason, etc.) nicht
 * als HTML interpretiert wird. Verhindert HTML-injection in subject/body.
 *
 * Email-clients zeigen `&amp;` korrekt als `&` an — kein extra-decoding
 * nötig.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Defensive URL-sanitize: wenn AUTH_URL leer oder weird ist, fallback
 * auf einen leeren string damit die href="" wird (klick = no-op, kein
 * javascript:-injection).
 */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return '';
  return trimmed.replace(/\/$/, ''); // Strip trailing slash damit "url/x" nicht "url//x" wird.
}

/**
 * Builds a button as a table-cell — outlook supportet keine CSS-padding
 * auf <a>-tags, also wrappen wir's in table-cells.
 */
function htmlButton(label: string, url: string, color: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
    <tr>
      <td style="border-radius:6px; background-color:${color};">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:6px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Template: PIREP Approved ✅
// ─────────────────────────────────────────────────────────────────────────

export function renderPirepApprovedEmail(ctx: PirepEmailContext): RenderedEmail {
  const greeting = ctx.pilotName ? `Hallo ${ctx.pilotName}` : 'Hallo Pilot';
  const route = `${ctx.departureIcao} → ${ctx.arrivalIcao}`;
  const subject = `✅ PIREP ${ctx.flightNumber} wurde genehmigt`;

  const innerHtml = `
    <h1 style="margin:0 0 16px 0; font-size:22px; line-height:1.3; font-weight:700; color:#111827;">
      ✅ Dein PIREP wurde genehmigt
    </h1>
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)},</p>
    <p style="margin:0 0 16px 0;">
      dein PIREP <strong style="font-family:monospace;">${escapeHtml(ctx.flightNumber)}</strong>
      auf der Strecke <strong style="font-family:monospace;">${escapeHtml(route)}</strong>
      wurde soeben von <strong>${escapeHtml(ctx.approverName)}</strong> genehmigt.
    </p>
    <p style="margin:0 0 8px 0;">
      Die Flugstunden wurden deinem Konto gutgeschrieben. Falls in deiner Airline
      Economy aktiv ist, ist auch dein Gehalt für diesen Flug ausgezahlt.
    </p>
    ${htmlButton('PIREP ansehen', ctx.pirepUrl, '#16a34a')}
    <p style="margin:16px 0 0 0; font-size:13px; color:#6b7280;">
      Schönen Flug bei deinem nächsten Trip 🛫
    </p>
  `;

  const html = htmlShell({
    accentColor: '#16a34a', // green-600
    preheader: `Dein PIREP ${ctx.flightNumber} (${route}) wurde von ${ctx.approverName} genehmigt.`,
    innerHtml,
  });

  const text = [
    `${greeting},`,
    '',
    `dein PIREP ${ctx.flightNumber} auf der Strecke ${route} wurde soeben`,
    `von ${ctx.approverName} genehmigt.`,
    '',
    'Die Flugstunden wurden deinem Konto gutgeschrieben. Falls in deiner',
    'Airline Economy aktiv ist, ist auch dein Gehalt für diesen Flug',
    'ausgezahlt.',
    '',
    `PIREP ansehen: ${ctx.pirepUrl}`,
    '',
    'Schönen Flug bei deinem nächsten Trip!',
    '',
    '---',
    'Du erhältst diese E-Mail weil du in deinen Benachrichtigungs-',
    'Einstellungen die Kategorie "PIREP-Entscheidung" aktiviert hast.',
    'Anpassen unter: ' + (safeUrl(process.env.AUTH_URL ?? '') + '/settings/notifications'),
  ].join('\n');

  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────────
// Template: PIREP Rejected ❌
// ─────────────────────────────────────────────────────────────────────────

export function renderPirepRejectedEmail(ctx: PirepRejectedContext): RenderedEmail {
  const greeting = ctx.pilotName ? `Hallo ${ctx.pilotName}` : 'Hallo Pilot';
  const route = `${ctx.departureIcao} → ${ctx.arrivalIcao}`;
  const subject = `❌ PIREP ${ctx.flightNumber} wurde abgelehnt`;

  const innerHtml = `
    <h1 style="margin:0 0 16px 0; font-size:22px; line-height:1.3; font-weight:700; color:#111827;">
      ❌ Dein PIREP wurde abgelehnt
    </h1>
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)},</p>
    <p style="margin:0 0 16px 0;">
      dein PIREP <strong style="font-family:monospace;">${escapeHtml(ctx.flightNumber)}</strong>
      auf der Strecke <strong style="font-family:monospace;">${escapeHtml(route)}</strong>
      wurde von <strong>${escapeHtml(ctx.approverName)}</strong> abgelehnt.
    </p>
    <p style="margin:0 0 8px 0; font-weight:600; color:#374151;">Begründung:</p>
    <blockquote style="margin:0 0 16px 0; padding:12px 16px; border-left:3px solid #dc2626; background-color:#fef2f2; color:#7f1d1d; border-radius:0 4px 4px 0; font-style:italic;">
      ${escapeHtml(ctx.reason)}
    </blockquote>
    <p style="margin:0 0 16px 0;">
      Wenn du Rückfragen hast, sprich bitte den Approver direkt an oder
      reiche einen korrigierten PIREP ein.
    </p>
    ${htmlButton('PIREP ansehen', ctx.pirepUrl, '#dc2626')}
    <p style="margin:16px 0 0 0; font-size:13px; color:#6b7280;">
      Lass dich nicht entmutigen — jeder PIREP ist auch ein Lerneffekt 💪
    </p>
  `;

  const html = htmlShell({
    accentColor: '#dc2626', // red-600
    preheader: `Dein PIREP ${ctx.flightNumber} (${route}) wurde abgelehnt: ${ctx.reason.slice(0, 80)}`,
    innerHtml,
  });

  const text = [
    `${greeting},`,
    '',
    `dein PIREP ${ctx.flightNumber} auf der Strecke ${route} wurde von`,
    `${ctx.approverName} abgelehnt.`,
    '',
    'Begründung:',
    `  ${ctx.reason}`,
    '',
    'Wenn du Rückfragen hast, sprich bitte den Approver direkt an oder',
    'reiche einen korrigierten PIREP ein.',
    '',
    `PIREP ansehen: ${ctx.pirepUrl}`,
    '',
    '---',
    'Du erhältst diese E-Mail weil du in deinen Benachrichtigungs-',
    'Einstellungen die Kategorie "PIREP-Entscheidung" aktiviert hast.',
    'Anpassen unter: ' + (safeUrl(process.env.AUTH_URL ?? '') + '/settings/notifications'),
  ].join('\n');

  return { subject, html, text };
}
