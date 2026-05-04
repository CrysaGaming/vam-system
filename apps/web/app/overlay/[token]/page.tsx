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
 * Card-Position (nur wenn Layout=card):
 *   1. URL-Parameter ?position=top-left|top-right|bottom-left|bottom-right
 *   2. User-Preference aus DB
 *   3. Default: 'top-right'
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
import type {
  CardPosition,
  OverlayLayout,
  PhaseColorMap,
} from '@/lib/overlay-types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'VAM Overlay',
  robots: 'noindex, nofollow',
};

type SearchParams = Promise<{ layout?: string; position?: string }>;
type RouteParams = Promise<{ token: string }>;

const VALID_LAYOUTS: readonly OverlayLayout[] = ['bar', 'card', 'cockpit'];
const VALID_POSITIONS: readonly CardPosition[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

function isValidLayout(value: unknown): value is OverlayLayout {
  return typeof value === 'string' && VALID_LAYOUTS.includes(value as OverlayLayout);
}

function isValidPosition(value: unknown): value is CardPosition {
  return typeof value === 'string' && VALID_POSITIONS.includes(value as CardPosition);
}

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
  const { layout: layoutParam, position: positionParam } = await searchParams;

  // ─── Token-Format-Pre-Check ──────────────────────────────
  if (!isValidTokenFormat(token)) {
    return null;
  }

  // ─── User-Preferences aus DB laden ───────────────────────
  const user = await prisma.user.findUnique({
    where: { overlayToken: token },
    select: {
      overlayLayout: true,
      overlayCardPosition: true,
      overlayPhaseColors: true,
    },
  });

  // ─── Layout-Resolution (URL > User-Pref > Default) ───────
  const userPreferredLayout = isValidLayout(user?.overlayLayout)
    ? user.overlayLayout
    : 'bar';
  const layoutMode: OverlayLayout = isValidLayout(layoutParam)
    ? layoutParam
    : userPreferredLayout;

  // ─── Card-Position-Resolution (URL > User-Pref > Default) ─
  const userPreferredPosition = isValidPosition(user?.overlayCardPosition)
    ? user.overlayCardPosition
    : 'top-right';
  const cardPosition: CardPosition = isValidPosition(positionParam)
    ? positionParam
    : userPreferredPosition;

  // ─── Phase-Colors-Resolution ─────────────────────────────
  const phaseColors: PhaseColorMap | null =
    (user?.overlayPhaseColors as PhaseColorMap | null) ?? null;

  return (
    <OverlayClient
      token={token}
      initialLayout={layoutMode}
      cardPosition={cardPosition}
      phaseColorOverride={phaseColors}
    />
  );
}
