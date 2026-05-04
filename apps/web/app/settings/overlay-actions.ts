'use server';

/**
 * Server-Actions für User-Overlay-Preferences.
 *
 * Verwendet von:
 *  - apps/web/app/settings/overlay-preferences.tsx
 *
 * Types kommen aus @/lib/overlay-types damit Settings-UI sie ohne
 * Bracket-Path-Probleme nutzen kann.
 */

import { prisma } from '@vam/db';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import {
  type CardPosition,
  type OverlayLayout,
  type PhaseColor,
  type PhaseColorMap,
} from '@/lib/overlay-types';

export {
  type CardPosition,
  type OverlayLayout,
  type PhaseColor,
  type PhaseColorMap,
};

// ────────────────────────────────────────────────────────────
// VALIDATION
// ────────────────────────────────────────────────────────────

const VALID_LAYOUTS: OverlayLayout[] = ['bar', 'card', 'cockpit'];
const VALID_CARD_POSITIONS: CardPosition[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// Welle 10 commit 10D: Logo-URL-validation. Conservative — must be https
// (mixed-content blocking would break the overlay anyway), must end in
// a common image extension (with optional query-string for CDN cache-
// busters), max 500 chars to keep the column small. Imperfect: a CDN
// that serves images via path-only URLs (e.g., /img/abc123) won't pass.
// That's an acceptable tradeoff for 10D — user can host on a service
// with proper extensions (imgur, github, plain S3-buckets all work).
// Future enhancement: server-side HEAD-request with content-type check.
const LOGO_URL_REGEX =
  /^https:\/\/[^\s"'<>]{1,485}\.(png|jpe?g|gif|webp|svg)(\?[^\s"'<>]{0,400})?$/i;
const LOGO_URL_MAX_LENGTH = 500;

function isValidColor(color: unknown): color is string {
  return typeof color === 'string' && HEX_COLOR_REGEX.test(color);
}

function isValidLogoUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.length > 0 &&
    url.length <= LOGO_URL_MAX_LENGTH &&
    LOGO_URL_REGEX.test(url)
  );
}

function isValidPhaseColorMap(value: unknown): value is PhaseColorMap {
  if (typeof value !== 'object' || value === null) return false;
  for (const phaseValue of Object.values(value as Record<string, unknown>)) {
    if (typeof phaseValue !== 'object' || phaseValue === null) return false;
    const pc = phaseValue as Record<string, unknown>;
    if (!isValidColor(pc.bg) || !isValidColor(pc.fg)) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// ACTIONS
// ────────────────────────────────────────────────────────────

export async function updateOverlayLayout(
  layout: OverlayLayout,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  if (!VALID_LAYOUTS.includes(layout)) {
    return { success: false, error: 'invalid_layout' };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { overlayLayout: layout },
  });

  revalidatePath('/settings');
  return { success: true };
}

export async function updateOverlayCardPosition(
  position: CardPosition,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  if (!VALID_CARD_POSITIONS.includes(position)) {
    return { success: false, error: 'invalid_position' };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { overlayCardPosition: position },
  });

  revalidatePath('/settings');
  return { success: true };
}

export async function updateOverlayPhaseColors(
  colors: PhaseColorMap | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  if (colors !== null && !isValidPhaseColorMap(colors)) {
    return { success: false, error: 'invalid_colors' };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { overlayPhaseColors: colors ?? undefined },
  });

  revalidatePath('/settings');
  return { success: true };
}

export async function resetOverlayPhaseColors(): Promise<
  { success: true } | { success: false; error: string }
> {
  return updateOverlayPhaseColors(null);
}

// ────────────────────────────────────────────────────────────
// BRANDING (Welle 10 commit 10D)
// ────────────────────────────────────────────────────────────

export type OverlayBranding = {
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

/**
 * Update one or more branding fields. Pass `null` to clear a field,
 * `undefined` to leave it unchanged. Each field is validated
 * independently — sending an invalid value rejects the whole call
 * (no partial-update). The UI saves all three together so that's the
 * normal path; partial updates exist for the reset flow.
 *
 * Why one combined action instead of three: branding feels like one
 * "look-and-feel preference" to the user — they tweak logo + colors
 * in the same panel, save together. Splitting into three separate
 * server-actions would mean three round-trips on save and three
 * separate revalidatePath calls. Combined is simpler.
 */
export async function updateOverlayBranding(input: {
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  // Build the prisma-update partial. We want to distinguish:
  //   - field omitted from input  → don't touch the column
  //   - field === null            → set column to null (clear)
  //   - field === string          → validate, then set
  // The conditional-assignment-pattern below preserves all three.
  const updateData: {
    overlayLogoUrl?: string | null;
    overlayPrimaryColor?: string | null;
    overlayAccentColor?: string | null;
  } = {};

  if ('logoUrl' in input) {
    if (input.logoUrl === null) {
      updateData.overlayLogoUrl = null;
    } else if (isValidLogoUrl(input.logoUrl)) {
      updateData.overlayLogoUrl = input.logoUrl;
    } else {
      return { success: false, error: 'invalid_logo_url' };
    }
  }

  if ('primaryColor' in input) {
    if (input.primaryColor === null) {
      updateData.overlayPrimaryColor = null;
    } else if (isValidColor(input.primaryColor)) {
      updateData.overlayPrimaryColor = input.primaryColor;
    } else {
      return { success: false, error: 'invalid_primary_color' };
    }
  }

  if ('accentColor' in input) {
    if (input.accentColor === null) {
      updateData.overlayAccentColor = null;
    } else if (isValidColor(input.accentColor)) {
      updateData.overlayAccentColor = input.accentColor;
    } else {
      return { success: false, error: 'invalid_accent_color' };
    }
  }

  if (Object.keys(updateData).length === 0) {
    // Nothing to update — silently succeed rather than 400. Lets the UI
    // call this without checking if the user actually changed anything.
    return { success: true };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: updateData,
  });

  revalidatePath('/settings');
  return { success: true };
}

export async function resetOverlayBranding(): Promise<
  { success: true } | { success: false; error: string }
> {
  return updateOverlayBranding({
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
  });
}

export async function getOverlayPreferences(): Promise<{
  layout: OverlayLayout;
  cardPosition: CardPosition;
  phaseColors: PhaseColorMap | null;
  branding: OverlayBranding;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      layout: 'bar',
      cardPosition: 'top-right',
      phaseColors: null,
      branding: { logoUrl: null, primaryColor: null, accentColor: null },
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      overlayLayout: true,
      overlayCardPosition: true,
      overlayPhaseColors: true,
      overlayLogoUrl: true,
      overlayPrimaryColor: true,
      overlayAccentColor: true,
    },
  });

  return {
    layout: (user?.overlayLayout as OverlayLayout) ?? 'bar',
    cardPosition: (user?.overlayCardPosition as CardPosition) ?? 'top-right',
    phaseColors: (user?.overlayPhaseColors as PhaseColorMap | null) ?? null,
    branding: {
      logoUrl: user?.overlayLogoUrl ?? null,
      primaryColor: user?.overlayPrimaryColor ?? null,
      accentColor: user?.overlayAccentColor ?? null,
    },
  };
}
