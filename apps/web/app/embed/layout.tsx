import type { Viewport } from 'next';

/**
 * Welle N / N5 — /embed sub-layout.
 *
 * Transparent background by default so the page renders correctly when
 * embedded as an iframe with a parent-page background — OBS, Twitch
 * panels, Discord activities. The client component applies its own
 * card-style background.
 *
 * No theme-toggle, no nav, no chrome — that's all handled by AppShell.
 * isPublicPath('/embed/*') = true.
 *
 * # Why no robots-noindex
 *
 * Public-shareable URL is the whole point. If users want to share their
 * flight status on Twitter or paste it in a Discord pinned message, the
 * preview-card should work. The token is the secret, not the URL-existence.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata = {
  title: 'VAM Live Flight',
};

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-transparent">{children}</div>;
}
