'use server';

import { auth } from '@/auth';
import {
  prisma,
  grantLicense,
  revokeLicense,
  suspendLicense,
  reinstateLicense,
  grantTypeRating,
  revokeTypeRating,
  extendTypeRating,
  type LicenseType,
} from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Pilot-detail server-actions (Welle 13E-6) — license + type-rating
 * management für admins, scoped pro pilot.
 *
 * Auth-gate: AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor).
 * Spiegelt die airline-/pilots/actions.ts-policy. Plus: target-user muss
 * member der actor-airline sein (cross-airline-edit-prävention).
 *
 * Convention: alle helpers delegieren an die @vam/db career-helpers für
 * die actual DB-arbeit. Hier nur auth + scope-validation + revalidate.
 */
const AIRLINE_MANAGER_ROLES = ['admin', 'airline-admin', 'instructor'];

async function requireAirlineAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || !AIRLINE_MANAGER_ROLES.includes(user.role.name)) {
    throw new Error('forbidden');
  }
  if (!user.airlineId) {
    throw new Error('no-airline');
  }

  return { user, airlineId: user.airlineId };
}

/**
 * Scope-check: target-user muss in derselben airline sein wie der actor.
 * Verhindert dass ein admin von airline A licenses für users von airline B
 * vergeben kann. Auch private-data-leak-prävention — die ID-route ist
 * öffentlich aufrufbar, also brauchen wir die airline-grenze auch hier.
 */
async function requireSameAirline(targetUserId: string) {
  const { user: actor, airlineId } = await requireAirlineAdmin();
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, airlineId: true, name: true },
  });
  if (!target || target.airlineId !== airlineId) {
    throw new Error('forbidden');
  }
  return { actor, target, airlineId };
}

// ─────────────────────────────────────────────────────────────────────────
// License management
// ─────────────────────────────────────────────────────────────────────────

const GrantLicenseSchema = z.object({
  userId: z.string().min(1),
  type: z.enum([
    'SPL',
    'PPL',
    'NIGHT_RATING',
    'INSTRUMENT_RATING',
    'MULTI_ENGINE_RATING',
    'CPL',
    'MCC',
    'ATPL',
    'TRI',
    'TRE',
  ]) satisfies z.ZodType<LicenseType>,
  // ISO-string von datetime-local input. Optional — leer = kein expiry.
  expiresAt: z.string().optional().nullable(),
  // Free-text notes für admin-comment ("ausgestellt nach DLR-prüfung").
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Grant a license to a pilot. Idempotent-failure: wenn user bereits eine
 * license dieses typs hat, kommt P2002 (composite-unique constraint
 * userId+type). Wir fangen den ab und werfen einen friendly error.
 *
 * Certificate-number wird auto-generiert. Audit-trail via issuedById = actor.
 */
export async function adminGrantLicense(
  input: z.infer<typeof GrantLicenseSchema>,
) {
  const parsed = GrantLicenseSchema.parse(input);
  const { actor } = await requireSameAirline(parsed.userId);

  // expiresAt parsing: HTML datetime-local sendet "2027-05-05T12:00".
  // Empty-string oder null = kein expiry (license gilt bis revoke).
  const expiresAt =
    parsed.expiresAt && parsed.expiresAt.trim()
      ? new Date(parsed.expiresAt)
      : null;

  try {
    await grantLicense({
      userId: parsed.userId,
      type: parsed.type as LicenseType,
      expiresAt,
      issuedById: actor.id,
      notes: parsed.notes ?? null,
    });
  } catch (e: unknown) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: string }).code === 'P2002'
    ) {
      throw new Error(
        `Pilot hat bereits eine ${parsed.type}-Lizenz. Bestehende widerrufen oder verlängern.`,
      );
    }
    throw e;
  }

  revalidatePath(`/airline/pilots/${parsed.userId}`);
  revalidatePath('/licenses');
}

const RevokeLicenseSchema = z.object({
  licenseId: z.string().min(1),
  userId: z.string().min(1), // for scope-check + revalidate
  reason: z.string().trim().min(3).max(500),
});

export async function adminRevokeLicense(
  input: z.infer<typeof RevokeLicenseSchema>,
) {
  const parsed = RevokeLicenseSchema.parse(input);
  const { actor } = await requireSameAirline(parsed.userId);

  // Extra-check: license-row gehört wirklich zum target-user. Verhindert
  // dass ein admin per ID-stuffing eine fremde license revoked.
  const license = await prisma.pilotLicense.findUnique({
    where: { id: parsed.licenseId },
    select: { userId: true },
  });
  if (!license || license.userId !== parsed.userId) {
    throw new Error('forbidden');
  }

  await revokeLicense({
    id: parsed.licenseId,
    reason: parsed.reason,
    revokedById: actor.id,
  });

  revalidatePath(`/airline/pilots/${parsed.userId}`);
  revalidatePath('/licenses');
}

const SuspendLicenseSchema = z.object({
  licenseId: z.string().min(1),
  userId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

export async function adminSuspendLicense(
  input: z.infer<typeof SuspendLicenseSchema>,
) {
  const parsed = SuspendLicenseSchema.parse(input);
  const { actor } = await requireSameAirline(parsed.userId);

  const license = await prisma.pilotLicense.findUnique({
    where: { id: parsed.licenseId },
    select: { userId: true },
  });
  if (!license || license.userId !== parsed.userId) {
    throw new Error('forbidden');
  }

  await suspendLicense({
    id: parsed.licenseId,
    reason: parsed.reason,
    suspendedById: actor.id,
  });

  revalidatePath(`/airline/pilots/${parsed.userId}`);
  revalidatePath('/licenses');
}

const ReinstateLicenseSchema = z.object({
  licenseId: z.string().min(1),
  userId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
  // Optional: neuer expiry beim renewal nach recurrent-training.
  newExpiresAt: z.string().optional().nullable(),
});

export async function adminReinstateLicense(
  input: z.infer<typeof ReinstateLicenseSchema>,
) {
  const parsed = ReinstateLicenseSchema.parse(input);
  const { actor } = await requireSameAirline(parsed.userId);

  const license = await prisma.pilotLicense.findUnique({
    where: { id: parsed.licenseId },
    select: { userId: true },
  });
  if (!license || license.userId !== parsed.userId) {
    throw new Error('forbidden');
  }

  const newExpiresAt =
    parsed.newExpiresAt && parsed.newExpiresAt.trim()
      ? new Date(parsed.newExpiresAt)
      : undefined;

  await reinstateLicense({
    id: parsed.licenseId,
    reason: parsed.reason ?? undefined,
    reinstatedById: actor.id,
    newExpiresAt,
  });

  revalidatePath(`/airline/pilots/${parsed.userId}`);
  revalidatePath('/licenses');
}

// ─────────────────────────────────────────────────────────────────────────
// Type-rating management
// ─────────────────────────────────────────────────────────────────────────

const GrantTypeRatingSchema = z.object({
  userId: z.string().min(1),
  // ICAO-typ (4 zeichen, uppercase). Validation lasch: nicht jeder ICAO-
  // typ ist in unserer aircraftType-tabelle gelistet (manche sind selten).
  // Admin sollte wissen was er tut.
  aircraftType: z.string().trim().min(2).max(8).regex(/^[A-Z0-9]+$/),
  // Default: 12 monate ab obtained. Optional override.
  expiresAt: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function adminGrantTypeRating(
  input: z.infer<typeof GrantTypeRatingSchema>,
) {
  const parsed = GrantTypeRatingSchema.parse(input);
  const { actor } = await requireSameAirline(parsed.userId);

  // expiresAt parsing — wenn nicht angegeben, lässt grantTypeRating den
  // default (obtainedAt + 12 monate) greifen.
  const expiresAt =
    parsed.expiresAt && parsed.expiresAt.trim()
      ? new Date(parsed.expiresAt)
      : undefined;

  try {
    await grantTypeRating({
      userId: parsed.userId,
      aircraftType: parsed.aircraftType.toUpperCase(),
      expiresAt,
      issuedById: actor.id,
      notes: parsed.notes ?? null,
    });
  } catch (e: unknown) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: string }).code === 'P2002'
    ) {
      throw new Error(
        `Pilot hat bereits ein Type-Rating für ${parsed.aircraftType}. Verlängern statt neu vergeben.`,
      );
    }
    throw e;
  }

  revalidatePath(`/airline/pilots/${parsed.userId}`);
  revalidatePath('/licenses');
}

const RevokeTypeRatingSchema = z.object({
  ratingId: z.string().min(1),
  userId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Type-rating revoke ist ein HARD-DELETE — anders als PilotLicense (welche
 * status-feld haben) kennen type-ratings nur "exists/not-exists". Daher
 * hat die @vam/db-helper auch keinen revokedBy/reason im record selbst.
 * Wir schreiben den reason ins console-log als audit-trail-placeholder bis
 * eine dedizierte audit-table existiert (siehe revokeTypeRating-docstring
 * in @vam/db).
 */
export async function adminRevokeTypeRating(
  input: z.infer<typeof RevokeTypeRatingSchema>,
) {
  const parsed = RevokeTypeRatingSchema.parse(input);
  const { actor } = await requireSameAirline(parsed.userId);

  const rating = await prisma.typeRating.findUnique({
    where: { id: parsed.ratingId },
    select: { userId: true, aircraftType: true },
  });
  if (!rating || rating.userId !== parsed.userId) {
    throw new Error('forbidden');
  }

  // Audit-log VOR dem delete — sonst ist der context weg.
  console.log(
    `[airline-admin] ${actor.name} revoked type-rating ${rating.aircraftType} ` +
      `(id=${parsed.ratingId}) from user ${parsed.userId}: ${parsed.reason}`,
  );

  await revokeTypeRating(parsed.ratingId);

  revalidatePath(`/airline/pilots/${parsed.userId}`);
  revalidatePath('/licenses');
}

const ExtendTypeRatingSchema = z.object({
  ratingId: z.string().min(1),
  userId: z.string().min(1),
  // Optional: explizites neues expiry-datum. Wenn weggelassen: extendType-
  // Rating fügt 12 monate ab altem expiresAt hinzu (oder ab now wenn
  // already-expired). HTML datetime-local liefert "YYYY-MM-DDTHH:mm".
  newExpiresAt: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function adminExtendTypeRating(
  input: z.infer<typeof ExtendTypeRatingSchema>,
) {
  const parsed = ExtendTypeRatingSchema.parse(input);
  const { actor } = await requireSameAirline(parsed.userId);

  const rating = await prisma.typeRating.findUnique({
    where: { id: parsed.ratingId },
    select: { userId: true },
  });
  if (!rating || rating.userId !== parsed.userId) {
    throw new Error('forbidden');
  }

  const newExpiresAt =
    parsed.newExpiresAt && parsed.newExpiresAt.trim()
      ? new Date(parsed.newExpiresAt)
      : undefined;

  await extendTypeRating({
    id: parsed.ratingId,
    issuedById: actor.id,
    newExpiresAt,
    notesAppend: parsed.notes ?? undefined,
  });

  revalidatePath(`/airline/pilots/${parsed.userId}`);
  revalidatePath('/licenses');
}
