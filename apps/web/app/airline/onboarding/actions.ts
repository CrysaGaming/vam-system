'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';

/**
 * Welle F / F4 — Member-Onboarding-Wizard server actions.
 *
 * Diese actions werden von den 4 step-components in
 * /airline/onboarding aufgerufen. Jede action ist idempotent — der
 * pilot kann jeden step beliebig oft wiederholen ohne dass etwas
 * kaputt geht. Der "wizard" ist UI-zucker drumherum; die echte
 * source-of-truth bleiben die User-row + AirlineHub-rows + airline-
 * flags.
 *
 * # Auth-Gating
 *
 * Alle actions hier prüfen:
 *   - session vorhanden
 *   - user.airlineId nicht null (sonst ist die ganze page sinnlos)
 *
 * Wir prüfen NICHT, ob `onboardingCompletedAt` schon gesetzt ist —
 * wenn der pilot die page erneut besucht (nach wizard-abschluss),
 * kann er trotzdem felder ändern. Die page selber redirected zwar
 * bei completed → /dashboard, aber direkter URL-aufruf bleibt
 * benutzbar als "settings-zugang über den wizard".
 *
 * # Side-effects
 *
 * - Profile (step 1): User.name + User.bio
 * - Base (step 2): User.baseIcao
 * - Preferences (step 3): User.economyEnabled + User.careerEnabled
 *   (nur wenn airline-toggles auch true sind — sonst no-op)
 * - Complete (step 4): User.onboardingCompletedAt = now()
 * - Skip (any time): User.onboardingCompletedAt = now() (no other writes)
 *
 * Alle actions revalidaten /airline/onboarding + /dashboard + /settings
 * weil die touched fields auf allen drei seiten sichtbar sind.
 */

function revalidateUserPages() {
  revalidatePath('/airline/onboarding');
  revalidatePath('/dashboard');
  revalidatePath('/settings');
}

/**
 * Step 1: profile-completion. Setzt name + bio. Beide optional —
 * users mit pre-existing name (z.B. via Discord-OAuth) können leer
 * lassen und der existing name bleibt. Bio cap 500 zeichen (matched
 * setUserBio in settings/actions.ts).
 */
export async function completeProfileStep(
  input: { name?: string | null; bio?: string | null },
): Promise<
  | { success: true }
  | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  // Trim inputs. Empty-string nach trim = "nicht ändern" für name
  // (existing values bleiben), bio kann explizit null gesetzt
  // werden = cleared.
  const cleanName =
    typeof input.name === 'string'
      ? input.name.trim().length === 0
        ? null
        : input.name.trim()
      : null;

  let cleanBio: string | null = null;
  if (typeof input.bio === 'string') {
    let b = input.bio.trim();
    // Strip control chars except \n and \t (mirrors setUserBio).
    b = b.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    b = b.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
    b = b.replace(/\n{3,}/g, '\n\n');
    if (b.length === 0) {
      cleanBio = null;
    } else if (b.length > 500) {
      return { success: false, error: 'bio_too_long' };
    } else {
      cleanBio = b;
    }
  }

  // Conditional update: only write the fields that the user actually
  // provided. Sending {name: null, bio: undefined} should NOT clear
  // a pre-existing name.
  const data: { name?: string | null; bio?: string | null } = {};
  if (input.name !== undefined && cleanName !== null) {
    // Only set name if non-empty — never clear an existing name.
    data.name = cleanName;
  }
  if (input.bio !== undefined) {
    // Bio can be explicitly cleared (cleanBio = null).
    data.bio = cleanBio;
  }

  if (Object.keys(data).length > 0) {
    await prisma.user.update({
      where: { id: session.user.id },
      data,
    });
  }

  revalidateUserPages();
  return { success: true };
}

/**
 * Step 2: home-base selection. Setzt User.baseIcao auf einen der
 * airline.hubs ICAOs. Whitelist enforcement gegen den hub-array
 * verhindert dass jemand via direct-API einen freitext-ICAO setzt.
 * NULL erlaubt = "noch keinen base wählen" — wizard kann diesen step
 * skippen.
 */
export async function completeBaseStep(
  icao: string | null,
): Promise<
  | { success: true }
  | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  if (icao !== null) {
    if (typeof icao !== 'string' || !/^[A-Z0-9]{3,4}$/.test(icao)) {
      return { success: false, error: 'invalid_icao_format' };
    }
  }

  // Resolve user.airline + hubs in one round-trip for the whitelist check.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      airlineId: true,
      airline: { select: { hubs: { select: { airportIcao: true } } } },
    },
  });
  if (!user?.airlineId || !user.airline) {
    return { success: false, error: 'no_airline' };
  }

  if (icao !== null) {
    const hubIcaos = new Set(user.airline.hubs.map((h) => h.airportIcao));
    if (!hubIcaos.has(icao)) {
      return { success: false, error: 'not_a_hub' };
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { baseIcao: icao },
  });

  revalidateUserPages();
  return { success: true };
}

/**
 * Step 3: preferences. Setzt economyEnabled + careerEnabled. Wenn die
 * airline einen flag nicht aktiviert hat, ist der entsprechende
 * user-toggle ein no-op (kann gesetzt werden, hat aber keinen effekt
 * bis airline-admin den airline-toggle anwirft — gleicher mental-
 * model wie EconomyCard im settings).
 */
export async function completePreferencesStep(
  input: { economyEnabled: boolean; careerEnabled: boolean },
): Promise<
  | { success: true }
  | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  if (
    typeof input.economyEnabled !== 'boolean' ||
    typeof input.careerEnabled !== 'boolean'
  ) {
    return { success: false, error: 'invalid_input' };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      economyEnabled: input.economyEnabled,
      careerEnabled: input.careerEnabled,
    },
  });

  revalidateUserPages();
  return { success: true };
}

/**
 * Step 4 (terminal): markiert onboarding als abgeschlossen.
 * Setzt nur den timestamp; alle field-updates passieren in den
 * vorherigen steps. Wenn der user direkt step 4 erreicht (ohne
 * vorherige steps), wird trotzdem completedAt gesetzt — das ist
 * "ich will den wizard nicht durchklicken, lass mich raus"-semantik.
 *
 * Nach diesem call redirected die UI zu /dashboard.
 */
export async function completeOnboarding(): Promise<
  | { success: true }
  | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { onboardingCompletedAt: new Date() },
  });

  revalidateUserPages();
  return { success: true };
}

/**
 * Skip-shortcut: markiert wizard als abgeschlossen ohne andere
 * field-updates. Gleicher effect wie completeOnboarding aber semantisch
 * verschieden (analytics-tracking könnte später zwischen "completed all
 * steps" vs "skipped after step N" unterscheiden via separate field;
 * für jetzt sind sie identisch).
 */
export async function skipOnboarding(): Promise<
  | { success: true }
  | { success: false; error: string }
> {
  return completeOnboarding();
}
