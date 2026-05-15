# VAM Flight HUD — Garmin Connect IQ data-field

Welle N / N4 skeleton for a Connect-IQ data-field that displays your
VAM Live-Session telemetry (callsign, altitude, ground-speed, heading,
route) on a Garmin watch or Edge cyclo-computer during a flight.

## Status

**Skeleton.** The code in this directory is structurally complete but
has not been compiled or tested on hardware. The Connect IQ SDK is not
part of the vam-system repo; you need to install it locally to build,
sideload, and submit.

## Architecture

The data-field polls `GET /api/garmin/state` on the VAM server every
`pollSeconds` seconds (default 10), authenticates with a bearer token
that the user generates at `/settings/garmin` and pastes into the
Connect-IQ phone-app.

The server endpoint returns a flat JSON payload:

```
{
  "t": "2026-05-15T10:23:45.123Z",
  "callsign": "DLH400",
  "alt": 35000,
  "gs": 450,
  "hdg": 285,
  "dep": "EDDF",
  "arr": "KJFK",
  "onGnd": false,
  "hbAge": 3
}
```

The view renders this as monochrome amber-on-black to match the web
`/m/watch` surface.

## Building

1. Install the [Connect IQ SDK](https://developer.garmin.com/connect-iq/sdk/)
   (Garmin only ships installers for Windows, macOS, and Ubuntu).
2. Install VS Code + the Monkey C extension.
3. Open this directory as a workspace.
4. Replace `resources/drawables/launcher_icon.png` with a real
   40×40 PNG (placeholder is missing — the build will fail until you
   add one).
5. Build with `monkeyc` or via the VS Code task. To sideload onto a
   physically-connected watch, copy the resulting `.prg` into the
   `GARMIN/APPS/` folder on the watch's USB-mounted storage.

## Submitting to Connect IQ Store

Garmin Developer account required (free). Use `connectiq` CLI to
package: `connectiq package` → upload `.iq` bundle to the developer
dashboard. Review typically takes 3-5 business days.

## File layout

```
garmin-iq/
├── manifest.xml              app metadata + target devices
├── monkey.jungle             build config (single source tree)
├── resources/
│   ├── strings/strings.xml   localized strings
│   ├── drawables/            launcher icon + bitmap refs
│   ├── properties/           runtime app-properties (apiToken, etc.)
│   └── settings/             phone-app settings-UI definitions
└── source/
    ├── VamHudApp.mc          Application.AppBase subclass
    └── VamHudView.mc         WatchUi.DataField subclass — render loop
```

## Future

- **Glances** (the new compact home-screen tile format on fenix 7+):
  duplicate `VamHudView.mc` as a `VamHudGlance.mc` extending
  `WatchUi.GlanceView`. Same poll logic, smaller layout.
- **Edge bike-computers**: the existing manifest already lists Edge
  1040 / 840, but the bottom-row HDG label collides with the cyclo's
  speed-gauge on small screens. May need a `resources-edge1040/`
  override.
- **Native iOS companion** (the Path B from N3): track at
  `docs/vision/n3-apple-watch.md`. The bearer-token contract here is
  identical; that future native app would re-use `/api/garmin/state`.
