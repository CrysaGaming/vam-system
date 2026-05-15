// Welle N / N4 — VAM Flight HUD data-field view.
//
// The view runs three loops:
//
//   1. compute() — Connect-IQ heartbeat (~1 Hz). Decides whether it's
//      time to poll the server (based on user's pollSeconds setting)
//      and fires the HTTP request if so.
//   2. onUpdate(dc) — Connect-IQ render call. Draws the current state
//      to the watch dc (drawing context). Pure function of mState.
//   3. onReceive — HTTP-callback. Parses the JSON response into mState
//      and asks WatchUi to redraw.
//
// State machine:
//
//   SETUP    — no apiToken configured
//   IDLE     — token set, never polled yet
//   POLLING  — request in flight
//   LIVE     — got data, hbAge ≤ 30s
//   STALE    — got data, hbAge > 30s OR last poll > 60s ago
//   NOFLT    — server said no active session (404)
//   ERROR    — last poll returned 4xx/5xx/network-error
//
// Drawing is monochrome amber where possible; on devices without
// color, the SDK auto-translates to grayscale.

using Toybox.Application;
using Toybox.Communications;
using Toybox.Graphics;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

class VamHudView extends WatchUi.DataField {

    // Display state
    hidden var mState as Symbol = :setup;
    hidden var mCallsign as String = "";
    hidden var mAlt as Number = 0;
    hidden var mGs as Number = 0;
    hidden var mHdg as Number = 0;
    hidden var mDep as String = "";
    hidden var mArr as String = "";
    hidden var mOnGround as Boolean = false;
    hidden var mHbAge as Number? = null;
    hidden var mLastPollMs as Number = 0;
    hidden var mErrorCode as Number? = null;

    function initialize() {
        DataField.initialize();
    }

    // ─────────────────────────────────────────────────────────
    // Poll scheduling
    // ─────────────────────────────────────────────────────────

    // Called ~1×/sec by the activity engine. We use it as a clock
    // tick: every N seconds (from pollSeconds setting) we fire a new
    // request. compute() must be cheap — no IO here, just decision-
    // making.
    function compute(info as Activity.Info) as Void {
        var token = getApiToken();
        if (token == null) {
            mState = :setup;
            return;
        }

        var now = System.getTimer();
        var intervalMs = getPollIntervalMs();

        if (now - mLastPollMs >= intervalMs) {
            mLastPollMs = now;
            pollServer(token);
        }
    }

    function getApiToken() as String? {
        var raw = Application.Properties.getValue("apiToken");
        if (raw == null || raw.equals("")) {
            return null;
        }
        return raw;
    }

    function getServerBase() as String {
        var raw = Application.Properties.getValue("serverBase");
        if (raw == null || raw.equals("")) {
            return "https://vam.kevindrack.de";
        }
        return raw;
    }

    function getPollIntervalMs() as Number {
        var raw = Application.Properties.getValue("pollSeconds");
        if (raw == null || raw < 5 || raw > 60) {
            return 10000;
        }
        return raw * 1000;
    }

    // ─────────────────────────────────────────────────────────
    // HTTP poll
    // ─────────────────────────────────────────────────────────

    function pollServer(token as String) as Void {
        var url = getServerBase() + "/api/garmin/state";
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "Authorization" => "Bearer " + token,
                "Accept" => "application/json"
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Communications.makeWebRequest(url, null, options, method(:onReceive));
    }

    function onReceive(responseCode as Number, data as Dictionary?) as Void {
        if (responseCode == 200 && data != null) {
            mCallsign = (data["callsign"] != null) ? data["callsign"] : "";
            mAlt = (data["alt"] != null) ? data["alt"] : 0;
            mGs = (data["gs"] != null) ? data["gs"] : 0;
            mHdg = (data["hdg"] != null) ? data["hdg"] : 0;
            mDep = (data["dep"] != null) ? data["dep"] : "";
            mArr = (data["arr"] != null) ? data["arr"] : "";
            mOnGround = (data["onGnd"] != null) ? data["onGnd"] : false;
            mHbAge = (data["hbAge"] != null) ? data["hbAge"] : null;
            mErrorCode = null;

            if (mHbAge == null || mHbAge > 30) {
                mState = :stale;
            } else {
                mState = :live;
            }
        } else if (responseCode == 404) {
            mState = :noflt;
            mErrorCode = 404;
        } else if (responseCode == 401) {
            mState = :setup;  // token revoked/invalid — treat as setup
            mErrorCode = 401;
        } else {
            mState = :error;
            mErrorCode = responseCode;
        }

        WatchUi.requestUpdate();
    }

    // ─────────────────────────────────────────────────────────
    // Drawing
    // ─────────────────────────────────────────────────────────

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();

        // Black background, amber foreground — matches the web /m/watch
        // surface so users get a consistent look across surfaces.
        dc.setColor(Graphics.COLOR_TRANSPARENT, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);

        if (mState == :setup) {
            drawCenteredText(dc, w, h, "SETUP", "set apiToken");
            return;
        }
        if (mState == :noflt) {
            drawCenteredText(dc, w, h, "NO FLT", "start ACARS");
            return;
        }
        if (mState == :error) {
            drawCenteredText(dc, w, h, "ERR " + mErrorCode, "retry…");
            return;
        }

        // Live or stale path — dim if stale.
        if (mState == :stale) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        }

        // Top: callsign + STALE chip if applicable
        var topY = h * 0.10;
        dc.drawText(
            w / 2, topY,
            Graphics.FONT_XTINY,
            (mState == :stale) ? mCallsign + " STALE" : mCallsign,
            Graphics.TEXT_JUSTIFY_CENTER
        );

        // Center: ALT (massive)
        var altLabel = (mAlt >= 18000)
            ? "FL" + (mAlt / 100).toNumber().toString()
            : mAlt.toString();
        dc.drawText(
            w / 2, h * 0.42,
            Graphics.FONT_NUMBER_THAI_HOT,
            altLabel,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );

        // Bottom: GS / HDG / route
        var bottomY = h * 0.75;
        dc.drawText(
            w / 2, bottomY,
            Graphics.FONT_TINY,
            "GS " + mGs + "  HDG " + mHdg,
            Graphics.TEXT_JUSTIFY_CENTER
        );

        if (mDep != null && !mDep.equals("") && mArr != null && !mArr.equals("")) {
            dc.drawText(
                w / 2, bottomY + 18,
                Graphics.FONT_XTINY,
                mDep + "→" + mArr,
                Graphics.TEXT_JUSTIFY_CENTER
            );
        }
    }

    // Helper for SETUP / NO FLT / ERR screens — big-text-on-line-1,
    // small-hint-on-line-2.
    hidden function drawCenteredText(
        dc as Graphics.Dc,
        w as Number,
        h as Number,
        primary as String,
        hint as String
    ) as Void {
        dc.drawText(
            w / 2, h * 0.40,
            Graphics.FONT_LARGE,
            primary,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
        dc.drawText(
            w / 2, h * 0.65,
            Graphics.FONT_XTINY,
            hint,
            Graphics.TEXT_JUSTIFY_CENTER
        );
    }
}
