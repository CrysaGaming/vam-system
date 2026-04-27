/**
 * Public Overlay Page für OBS Browser-Source
 *
 * Route: /overlay/[token]
 *
 * Wird vom Streamer in OBS als Browser-Source eingebunden.
 * Liefert Live-Daten als transparentes HTML-Overlay über dem Stream.
 *
 * Layout-Wahl (Priorität):
 *   1. URL-Parameter ?layout=bar|card  (überschreibt alles)
 *   2. User-Preference aus DB           (per Token gelookup)
 *   3. Default: 'bar'
 *
 * Phase-Colors:
 *   1. User-Preference aus DB
 *   2. Default-Colors aus @/lib/overlay-types
 *
 * Page ist Public-Route — kein Auth-Check, Token im URL ist genug.
 *
 * Polling: alle 5 Sekunden /api/overlay/[token]/data
 * Inactive-State: nichts wird gerendert (komplett unsichtbar)
 *
 * @see todo-obs-overlay-system.md  für Phase-Übersicht
 */

import { prisma } from '@vam/db';
import { OverlayClient } from './overlay-client';
import type { OverlayLayout, PhaseColorMap } from '@/lib/overlay-types';

// Page kann nicht statisch gerendert werden (Live-Daten)
export const dynamic = 'force-dynamic';

// SEO: Public-Page aber soll nicht indexiert werden
export const metadata = {
  title: 'VAM Overlay',
  robots: 'noindex, nofollow',
};

type SearchParams = Promise<{ layout?: string }>;
type RouteParams = Promise<{ token: string }>;

const VALID_LAYOUTS: readonly OverlayLayout[] = ['bar', 'card'];

function isValidLayout(value: unknown): value is OverlayLayout {
  return typeof value === 'string' && VALID_LAYOUTS.includes(value as OverlayLayout);
}

/**
 * Validiert Token-Format. Schnell-Check vor DB-Zugriff.
 */
function isValidTokenFormat(token: string): boolean {
  return /^[0-9a-f]{32}$/i.test(token);
}

export default async function OverlayPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { token } = await params;
  const { layout: layoutParam } = await searchParams;

  // ─── Token-Format-Pre-Check ──────────────────────────────
  if (!isValidTokenFormat(token)) {
    // Invalid format → render empty (Page wird einfach unsichtbar in OBS)
    return null;
  }

  // ─── User-Preferences aus DB laden ───────────────────────
  const user = await prisma.user.findUnique({
    where: { overlayToken: token },
    select: {
      overlayLayout: true,
      overlayPhaseColors: true,
    },
  });

  // ─── Layout-Resolution ────────────────────────────────────
  // Priorität: URL-Param > User-Preference > Default
  const userPreferredLayout = isValidLayout(user?.overlayLayout)
    ? user.overlayLayout
    : 'bar';
  const layoutMode: OverlayLayout = isValidLayout(layoutParam)
    ? layoutParam
    : userPreferredLayout;

  // ─── Phase-Colors-Resolution ─────────────────────────────
  // User-Override aus DB, sonst Defaults (im Client-Component)
  const phaseColors: PhaseColorMap | null =
    (user?.overlayPhaseColors as PhaseColorMap | null) ?? null;

  return (
    <OverlayClient
      token={token}
      initialLayout={layoutMode}
      phaseColorOverride={phaseColors}
    />
  );
}
