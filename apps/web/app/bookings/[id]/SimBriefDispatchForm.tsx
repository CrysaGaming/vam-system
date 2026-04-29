'use client';

import Script from 'next/script';
import type { SimBriefFormField } from '@/lib/simbrief/buildFormFields';

// The vendored /public/simbrief.apiv1.js exposes simbriefsubmit() as a
// global. Declaring it on Window keeps TypeScript happy without spreading
// `any`.
declare global {
  interface Window {
    simbriefsubmit?: (referralPage: string) => void;
  }
}

export interface SimBriefDispatchFormProps {
  /** Hidden input values from buildSimBriefFormFields. */
  fields: readonly SimBriefFormField[];
  /**
   * URL the popup should redirect back to once the OFP is generated.
   * Should point at the same booking-detail page so the page-level
   * `?ofp_id=…` handler can persist the result via processSimBriefCallback.
   */
  referralPage: string;
  /**
   * Submit button label. Defaults to the primary-CTA wording used when
   * the booking has no cached OFP yet; the "plan again" call-site on a
   * SimBriefDispatched booking passes a shorter label.
   */
  buttonLabel?: string;
  /**
   * Submit button className. Defaults to the primary-CTA indigo styling;
   * the "plan again" call-site passes the smaller gray-secondary styling
   * used by sibling buttons (Refresh OFP, etc.) for visual consistency.
   */
  buttonClassName?: string;
}

const DEFAULT_BUTTON_LABEL = 'Generate Flight Plan →';
const DEFAULT_BUTTON_CLASSNAME =
  'px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded font-medium transition';

/**
 * Pattern Z dispatch form (client component).
 *
 * The form-id and submit-button-onclick are dictated by the vendored
 * `simbrief.apiv1.js` (see `var sbform = "sbapiform"`); they are not free
 * to change. The JS:
 *
 *   1. Reads the form by `id="sbapiform"`,
 *   2. Calls /api/simbrief/api-code with the dispatch parameters to obtain
 *      the md5 hash (server-side hashing keeps the API key private),
 *   3. Appends the hash + outputpage + timestamp as hidden inputs,
 *   4. Opens the popup and submits the form into it,
 *   5. Polls /api/simbrief/check-ofp until SimBrief reports the XML is
 *      ready, then redirects this window back to `referralPage` with the
 *      `?ofp_id=…` query string appended.
 *
 * This component lives in its own file because the vendored JS uses inline
 * `onclick="simbriefsubmit(…)"` semantics which React refuses to render in
 * a Server Component context. Splitting it out keeps the page-level RSC
 * pure while letting the dispatch widget run client-side.
 */
export function SimBriefDispatchForm({
  fields,
  referralPage,
  buttonLabel = DEFAULT_BUTTON_LABEL,
  buttonClassName = DEFAULT_BUTTON_CLASSNAME,
}: SimBriefDispatchFormProps) {
  return (
    <>
      {/* `afterInteractive` is fine — the JS only needs to be present by the
          time the user clicks the submit button. Loading it lazily keeps the
          first paint fast for users who never trigger dispatch. */}
      <Script src="/simbrief.apiv1.js" strategy="afterInteractive" />

      <form id="sbapiform">
        {fields.map((field) => (
          <input
            key={field.name}
            type="hidden"
            name={field.name}
            value={field.value}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            // The vendored JS attaches itself globally. If the script has
            // not loaded yet (slow connection, blocker), we no-op rather
            // than crash — the user can retry once it's ready.
            window.simbriefsubmit?.(referralPage);
          }}
          className={buttonClassName}
        >
          {buttonLabel}
        </button>
      </form>
    </>
  );
}
