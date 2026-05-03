'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Jumpseat-Transfer server-action. Schreibt einen JumpseatTransfer-eintrag
 * (append-only audit-log) UND updated User.currentLocation* atomar via
 * $transaction. Quelle = JUMPSEAT (LocationSource enum).
 *
 * Architectural notes:
 * - Eine reihe pro transfer — kein update, kein soft-delete, append-only.
 *   Wenn ein admin-correction nötig ist, kommt ein NEUER transfer mit
 *   reason=ADMIN_TRANSFER. Audit-trail bleibt vollständig.
 * - Atomicity: insert + user.update müssen beide gelingen ODER beide
 *   rollbacken. Sonst hätte man entweder einen audit-eintrag ohne
 *   position-change (war-history aber falsche position) oder einen
 *   position-change ohne audit (kein nachvollziehen). $transaction
 *   garantiert das.
 * - Source-precedence beim WRITE: wir setzen immer Source=JUMPSEAT,
 *   überschreiben damit auch ACARS/VATSIM/PIREP. Das ist gewollt — ein
 *   manueller jumpseat soll der primäre fakt sein, andere quellen werden
 *   beim nächsten event sowieso refreshed (PIREP-approval setzt zurück
 *   auf PIREP, ACARS-heartbeat auf ACARS, etc).
 *
 * Out-of-scope für Welle 4:
 * - Kosten / restrictions: alle jumpseats sind aktuell free + unrestricted.
 *   Welle 12 (economy) bringt cost-logik (z.B. RETURN_TO_HUB free, andere
 *   Reasons kosten currency).
 * - Multi-leg jumpseat (FRA → DXB → SYD): aktuell nur 1-step direkt zum
 *   ziel. Multi-leg käme mit time-based mechanics (z.B. "12h cooldown
 *   nach jumpseat").
 * - Cooldown / rate-limit: aktuell unlimited. Wenn pilots das ausnutzen
 *   um schnell zwischen hubs zu hopsen, kommt ein cooldown.
 */
const TransferSchema = z.object({
  toIcao: z
    .string()
    .min(3)
    .max(4)
    .regex(/^[A-Z0-9]+$/, 'ICAO darf nur A-Z und 0-9 enthalten')
    .transform((s) => s.toUpperCase()),
  reason: z.enum(['RETURN_TO_HUB', 'HUB_TO_HUB', 'POSITIONING', 'ADMIN_TRANSFER']),
  // Optional, max 500 chars (form-textarea-limit) — bei längeren notes
  // sollte ein admin-flow her statt freitext.
  notes: z.string().max(500).optional().nullable(),
});

export async function executeJumpseat(
  _prevState: unknown,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Nicht eingeloggt.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      airlineId: true,
      currentLocationIcao: true,
      baseIcao: true,
    },
  });

  if (!user) {
    return { ok: false, error: 'User nicht gefunden.' };
  }

  if (!user.airlineId) {
    return { ok: false, error: 'Du gehörst keiner Airline an.' };
  }

  if (!user.currentLocationIcao) {
    return {
      ok: false,
      error:
        'Du hast keine bekannte Position. Reiche erst einen PIREP ein oder lass dich vom Admin manuell positionieren.',
    };
  }

  const parsed = TransferSchema.safeParse({
    toIcao: String(formData.get('toIcao') ?? '').trim().toUpperCase(),
    reason: String(formData.get('reason') ?? ''),
    notes: (() => {
      const raw = String(formData.get('notes') ?? '').trim();
      return raw.length > 0 ? raw : null;
    })(),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Ungültige Eingabe',
    };
  }

  // No-op-check: jumpseat zum aktuellen standort macht keinen sinn.
  if (parsed.data.toIcao === user.currentLocationIcao) {
    return {
      ok: false,
      error: `Du bist bereits in ${parsed.data.toIcao}.`,
    };
  }

  // Validate: target ist ein hub DIESER airline. Cross-airline-jumpseats
  // sind in Welle 4 nicht erlaubt — pilot kann nur zwischen den hubs
  // seiner eigenen airline jumpen. Welle 5+ kann das aufweichen für
  // partner-airlines o.ä.
  const targetHub = await prisma.airlineHub.findUnique({
    where: {
      airlineId_airportIcao: {
        airlineId: user.airlineId,
        airportIcao: parsed.data.toIcao,
      },
    },
    select: { id: true },
  });

  if (!targetHub) {
    return {
      ok: false,
      error: `${parsed.data.toIcao} ist kein Hub deiner Airline. Wähle einen der angezeigten Hubs.`,
    };
  }

  // Transaction: insert audit-log + update user-position.
  // Beide müssen gleichzeitig gelingen. Wenn user.update aus irgendwelchen
  // gründen scheitert (race-condition mit anderem update?), rollback.
  await prisma.$transaction([
    prisma.jumpseatTransfer.create({
      data: {
        userId: user.id,
        fromIcao: user.currentLocationIcao,
        toIcao: parsed.data.toIcao,
        reason: parsed.data.reason,
        notes: parsed.data.notes ?? null,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        currentLocationIcao: parsed.data.toIcao,
        currentLocationSource: 'JUMPSEAT',
        currentLocationAt: new Date(),
      },
    }),
  ]);

  revalidatePath('/jumpseat');
  revalidatePath('/dashboard');
  // Pilot-profile zeigt position prominent — refresh damit der user sofort
  // den neuen state sieht.
  revalidatePath(`/pilots/${user.id}`);

  return { ok: true };
}
