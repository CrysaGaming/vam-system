import { AirlineHubTabs } from './_hub-tabs';

/**
 * Welle Q (UX-Reorg) — /airline/* layout.
 *
 * Renders a hub-tab navigation bar above every /airline/* child page.
 * The actual tab-selection logic lives in _hub-tabs.tsx (client
 * component). The layout itself is a server component, so it doesn't
 * cascade-client-render any child pages.
 *
 * When the current /airline route isn't part of any hub (e.g.
 * /airline/dashboard, /airline/finance), AirlineHubTabs returns null
 * and only the child page renders — no empty bar, no visual artifact.
 *
 * Fragment wrap is intentional. We do NOT add a containing element
 * because each child page already renders its own `<main>` with
 * page-level padding + background. Wrapping in another container would
 * either double-pad (nested padding) or break the page's full-width
 * background (a `<div>` would shrink to content width). The hub-tabs
 * component takes responsibility for its own visual continuity with
 * the page below via matching bg-gray-50/950.
 */
export default function AirlineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AirlineHubTabs />
      {children}
    </>
  );
}
