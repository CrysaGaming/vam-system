import type { Viewport } from 'next';

/**
 * Welle N / N3 — /m/watch sub-layout.
 *
 * Overrides the parent /m layout's gray surface with pure black for
 * maximum sun-readability on a wrist display. Also locks the viewport
 * scale so a stray finger-tap on the watch crown can't zoom the layout
 * out of frame.
 *
 * The chrome-suppression (AppShell.isPublicPath) inherits from /m via
 * the `startsWith('/m/')` match — no changes needed there.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Disable user-scaling: on a 198-pixel-wide Watch screen, accidental
  // pinch-zoom (from a sleeve, gloved finger, or crown bezel-press)
  // pushes the ALT readout off-frame. The whole UI is already sized
  // to fit — no zoom needed.
  maximumScale: 1,
  userScalable: false,
  // Pure black to match the page background. iOS Safari blends the
  // status-bar with this color when added to home screen.
  themeColor: '#000000',
};

export const metadata = {
  title: 'VAM Watch',
  robots: 'noindex, nofollow',
};

export default function WatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-black text-amber-300">{children}</div>;
}
