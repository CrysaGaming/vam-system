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

function isValidColor(color: unknown): color is string {
  return typeof color === 'string' && HEX_COLOR_REGEX.test(color);
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

export async function getOverlayPreferences(): Promise<{
  layout: OverlayLayout;
  cardPosition: CardPosition;
  phaseColors: PhaseColorMap | null;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { layout: 'bar', cardPosition: 'top-right', phaseColors: null };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      overlayLayout: true,
      overlayCardPosition: true,
      overlayPhaseColors: true,
    },
  });

  return {
    layout: (user?.overlayLayout as OverlayLayout) ?? 'bar',
    cardPosition: (user?.overlayCardPosition as CardPosition) ?? 'top-right',
    phaseColors: (user?.overlayPhaseColors as PhaseColorMap | null) ?? null,
  };
}
