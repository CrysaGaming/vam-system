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

type SearchParams = Promise<{
  layout?: string;
  position?: string;
  /**
   * Welle 10 commit 10C: mini-map toggle. URL-only opt-in (kein DB-pref) —
   * streamer setzt einmal `?map=on` in der OBS-browser-source-URL und
   * fertig. Werte: 'on' aktiviert, alles andere (oder fehlend) = aus.
   * Wenn user-feedback zeigt dass das pref gespeichert werden soll,
   * kommt das in einem follow-up commit mit User.overlayTrailEnabled.
   */
  map?: string;
  /**
   * Welle O / O3: opt-in toggle for the v2 widget bundle — route-
   * progress bar, wind-component badge, phase-transition toast.
   * URL-only ('v2=on'), same pattern as `map=on` for the same reason:
   * existing streamer-overlays in OBS scenes shouldn't change shape
   * after an upgrade unless the streamer explicitly enables them.
   * If user-feedback shows people want it remembered, we can later
   * add a User.overlayV2Enabled pref and read it here too.
   */
  v2?: string;
}>;
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
  const {
    layout: layoutParam,
    position: positionParam,
    map: mapParam,
    v2: v2Param,
  } = await searchParams;

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
      // Welle 10 commit 10D: custom-branding. Read directly from DB
      // here (not via /api/overlay/[token]/data) for two reasons:
      // (a) the API is the high-rate polling channel — branding is
      // static across a flight, no point pushing it every 5s; (b)
      // branding is rendered chrome (logo + CSS-vars) that's set
      // once at mount, identical pattern to layout/cardPosition.
      overlayLogoUrl: true,
      overlayPrimaryColor: true,
      overlayAccentColor: true,
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

  // ─── Mini-Map-Resolution ─────────────────────────────────
  // Strict opt-in via 'on' string. Anything else (incl. typos like
  // 'true'/'1') deliberately fails closed — better to show no map
  // than to surprise a streamer who didn't ask for one.
  const showTrail = mapParam === 'on';

  // ─── V2-Widgets-Resolution (Welle O / O3) ────────────────
  // Same strict 'on' check as showTrail above. Future opt-in toggles
  // should follow this same pattern — single canonical value, no
  // truthy-coercion, no surprises in OBS scenes that were configured
  // before the feature shipped.
  const showV2Widgets = v2Param === 'on';

  // ─── Branding-Resolution ─────────────────────────────────
  // Read-through from the User row. Validation already happened in
  // updateOverlayBranding (settings server-action) — by the time the
  // values land in the DB they're either valid or null. We still
  // shape-narrow to be defensive (e.g., a manual SQL update bypassing
  // the action wouldn't go through validation).
  const branding = {
    logoUrl:
      typeof user?.overlayLogoUrl === 'string' && user.overlayLogoUrl.length > 0
        ? user.overlayLogoUrl
        : null,
    primaryColor:
      typeof user?.overlayPrimaryColor === 'string' &&
      /^#[0-9A-Fa-f]{6}$/.test(user.overlayPrimaryColor)
        ? user.overlayPrimaryColor
        : null,
    accentColor:
      typeof user?.overlayAccentColor === 'string' &&
      /^#[0-9A-Fa-f]{6}$/.test(user.overlayAccentColor)
        ? user.overlayAccentColor
        : null,
  };

  return (
    <OverlayClient
      token={token}
      initialLayout={layoutMode}
      cardPosition={cardPosition}
      phaseColorOverride={phaseColors}
      showTrail={showTrail}
      branding={branding}
      showV2Widgets={showV2Widgets}
    />
  );
}
