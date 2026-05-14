import type { Viewport } from 'next';

/**
 * Welle E / E3 — mobile-companion-app route.
 *
 * /m is a chrome-free, mobile-optimized "second-screen" surface for
 * pilots who want a phone next to their MSFS rig showing the current
 * flight state (callsign, route, phase, telemetry, last heartbeat
 * age). Designed for portrait-orientation phones running it either:
 *   - Standalone via "Add to Home Screen" (Android Chrome / iOS Safari)
 *   - As a browser tab pinned to a tablet at the desk
 *
 * # Why a separate /m route rather than just letting /dashboard be
 *   responsive?
 *
 * The dashboard is information-dense (multiple cards, sidebar nav,
 * notifications). On a 6.1" phone screen it works but doesn't shine
 * — pilots want *one big readable surface* during a flight, not a
 * scrollable summary. /m is the focused version: large type, single-
 * column, auto-polling at 5s, no nav distractions.
 *
 * # Auth
 *
 * page.tsx auth-gates via `auth()` + `redirect('/')`. The route is
 * also marked public in <AppShell>.isPublicPath so the desktop chrome
 * (header + sidebar) is suppressed even when the user is signed in
 * — this is the trick that lets us share the auth/session middleware
 * with the rest of the app without inheriting its layout.
 *
 * # Why no service-worker / manifest in v1
 *
 * The companion app needs network connectivity to be useful anyway
 * (poll /api/mobile/state every 5s for live flight data). A SW with
 * offline-fallback would just show stale data without the user
 * understanding why. v2 could add a SW that surfaces "offline since
 * X" but for v1 we lean on the existing root-layout PWA-manifest +
 * keep this layout focused on visual chrome.
 *
 * # Viewport
 *
 * width=device-width + initialScale=1 are baseline. interactiveWidget
 * defaults to 'resizes-visual' which on iOS/Android pushes the page
 * up when the keyboard appears — but we have no inputs here, so the
 * default is fine. userScalable=true (default) keeps a11y zoom
 * available.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Dark-theme status-bar / browser-chrome to match the page's dark
  // background. Same brand-indigo as the root layout's dark variant,
  // so the chrome stays consistent if the user navigates back to the
  // main app.
  themeColor: '#1e1b4b',
};

export const metadata = {
  title: 'VAM Companion',
  // Don't index the mobile-companion in search engines — it's a
  // gated user-tool, not a public page.
  robots: 'noindex, nofollow',
};

/**
 * The wrapper div carries the dark background + min-h-screen so the
 * mobile surface fills the viewport regardless of how short the
 * content is. Tailwind utility classes (no custom CSS) so we stay
 * consistent with the rest of the app's styling pipeline.
 *
 * The root layout's html/body still wraps this — but AppShell's
 * isPublicPath check means no header/sidebar/floating-PWA-prompt is
 * rendered, just the children directly inside <body>. We add our own
 * full-bleed background here so the body's default light-mode bg
 * doesn't bleed through.
 */
export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {children}
    </div>
  );
}
