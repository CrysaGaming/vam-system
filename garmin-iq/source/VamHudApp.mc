// Welle N / N4 — VAM Flight HUD Connect IQ data-field app.
//
// App entry-point. Constructs the data-field-view and wires it up.
// All the actual rendering logic lives in VamHudView.mc; this file
// just orchestrates.

using Toybox.Application;
using Toybox.WatchUi;

class VamHudApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    // Called once when the data-field is added to an activity. Return
    // the single view that owns the lifecycle.
    function getInitialView() {
        return [new VamHudView()];
    }

    // Called when the user changes a setting in the Connect-IQ phone-
    // app. We re-read properties so the next poll uses the new token /
    // server / interval immediately.
    function onSettingsChanged() {
        WatchUi.requestUpdate();
    }
}
