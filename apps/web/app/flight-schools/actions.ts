'use server';

import { auth } from '@/auth';
import { prisma, hasLicense, type LicenseType } from '@vam/db';
import {
  recordTransaction,
  InsufficientFundsError,
  getOrCreateWallet,
  getSystemWallet,
} from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Pilot-side flight-school enrollment + hours-buying actions (Welle 13E-12).
 *
 * Auth-pattern: jede action requireht hasCareer (user.careerEnabled UND
 * airline.careerEnabled). Strikt: ohne career-mode darf gar nichts in
 * diesen flow passieren — kein enrollment, kein hours-kaufen, kein
 * withdraw. Wenn ein pilot mid-enrollment career-mode deaktiviert,
 * bleibt der enrollment-record erhalten aber ist quasi "frozen" bis
 * career wieder aktiviert wird.
 *
 * Cost-flow:
 *   USER-wallet → SYSTEM-wallet (FlightSchools sind NPCs ohne wallet).
 *   Kein two-leg-transfer weil SYSTEM-wallet als counterparty hier
 *   bewusst gleich behandelt wird wie bei fuel-fees (nur outflow auf
 *   user-seite, nichts auf der NPC-seite zu tracken). Wir nutzen
 *   recordTransaction direkt mit type=EXPENSE_FLIGHT_SCHOOL.
 *
 *   Alternative wäre transfer() mit out=EXPENSE_FLIGHT_SCHOOL und
 *   in=TRANSFER_IN auf SYSTEM, aber das ist semantisch ungenauer und
 *   pollutet das SYSTEM-wallet-tx-log. Der current pattern (siehe
 *   process-flight.ts EXPENSE_FUEL) bucht single-leg auf user, kein
 *   counterparty-tx — wir machen das gleich.
 */

const LICENSE_TYPE_VALUES = [
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
] as const satisfies readonly LicenseType[];

/**
 * Auth-gate für alle enrollment-actions. Returnt user + airline. Wirft
 * 'unauthorized' wenn keine session, 'career-not-enabled' wenn die
 * career-toggles nicht beide ON sind.
 */
async function requireCareerUser() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: { select: { id: true, careerEnabled: true } } },
  });
  if (!user) throw new Error('unauthorized');

  if (!user.careerEnabled || !user.airline?.careerEnabled) {
    throw new Error(
      'Career-System nicht aktiviert. Aktiviere es in den Profil-Einstellungen.',
    );
  }
  return user;
}

// ──────────────────────────────────────────────────────────────────────────
// enrollInFlightSchool
// ──────────────────────────────────────────────────────────────────────────

const EnrollSchema = z.object({
  schoolId: z.string().min(1),
  licenseType: z.enum(LICENSE_TYPE_VALUES),
});

/**
 * Pilot schreibt sich in eine Flight-School ein für einen bestimmten
 * License-Typ. Erzeugt einen IN_PROGRESS enrollment-record mit 0 hours
 * und 0 cost — kein initial-payment.
 *
 * Validation:
 *   1. School existiert + active=true
 *   2. School bietet den gewählten LicenseType an
 *   3. Pilot hat KEINE active license für diesen typ schon
 *   4. Pilot hat KEINEN running enrollment für diesen typ schon
 *      (IN_PROGRESS oder EXAM_SCHEDULED — also "noch nicht fertig")
 *
 * Bewusst KEIN check auf "pilot bereits in anderer schule für anderen
 * license-typ" — pilot kann mehrere parallel laufen lassen (z.B.
 * IR-rating während gleichzeitig CPL-theorie). Realistic + erlaubt
 * sinnvolles training-stacking.
 */
export async function enrollInFlightSchool(input: z.infer<typeof EnrollSchema>) {
  const parsed = EnrollSchema.parse(input);
  const user = await requireCareerUser();

  const school = await prisma.flightSchool.findUnique({
    where: { id: parsed.schoolId },
    select: {
      id: true,
      name: true,
      active: true,
      offeredLicenses: true,
    },
  });
  if (!school) {
    throw new Error('Flugschule nicht gefunden.');
  }
  if (!school.active) {
    throw new Error(
      'Diese Flugschule ist nicht mehr aktiv. Wähle eine andere.',
    );
  }
  if (!school.offeredLicenses.includes(parsed.licenseType)) {
    throw new Error(
      `Diese Schule bietet keine ${parsed.licenseType}-Lizenz an.`,
    );
  }

  // Active-license-check via existing helper. Wenn der pilot die license
  // schon hat, muss er sich nicht nochmal einschreiben — er kann die
  // existing license behalten. Edge-case: license ist EXPIRED, dann ist
  // hasLicense=false und enrollment für renewal ist erlaubt.
  const alreadyHas = await hasLicense(user.id, parsed.licenseType);
  if (alreadyHas) {
    throw new Error(
      `Du hast bereits eine aktive ${parsed.licenseType}-Lizenz.`,
    );
  }

  // Running-enrollment-check.
  const existing = await prisma.flightSchoolEnrollment.findFirst({
    where: {
      userId: user.id,
      licenseType: parsed.licenseType,
      status: { in: ['IN_PROGRESS', 'EXAM_SCHEDULED'] },
    },
    select: { id: true, school: { select: { name: true } } },
  });
  if (existing) {
    throw new Error(
      `Du bist bereits in einem laufenden ${parsed.licenseType}-Training bei ${existing.school.name}. Beende oder canzel das vorher.`,
    );
  }

  await prisma.flightSchoolEnrollment.create({
    data: {
      userId: user.id,
      schoolId: parsed.schoolId,
      licenseType: parsed.licenseType,
      // status default IN_PROGRESS, hours/cost default 0 (siehe schema)
    },
  });

  revalidatePath('/flight-schools');
  revalidatePath(`/flight-schools/${parsed.schoolId}`);
  revalidatePath('/licenses');
}

// ──────────────────────────────────────────────────────────────────────────
// buyTrainingHours
// ──────────────────────────────────────────────────────────────────────────

const BuyHoursSchema = z
  .object({
    enrollmentId: z.string().min(1),
    // Je hours-block KANN 0 sein (pilot kauft nur theory diesmal),
    // aber MINDESTENS einer muss > 0 sein. Float (0.5h-blocks erlaubt).
    hoursTheory: z.coerce.number().min(0).max(50).default(0),
    hoursPractical: z.coerce.number().min(0).max(50).default(0),
    hoursSim: z.coerce.number().min(0).max(50).default(0),
  })
  .refine(
    (v) => v.hoursTheory > 0 || v.hoursPractical > 0 || v.hoursSim > 0,
    { message: 'Mindestens ein hours-block muss > 0 sein.' },
  );

/**
 * Pilot kauft trainings-stunden für einen aktiven enrollment. Berechnet
 * cost = sum(hours × rate) und debited das user-wallet via EXPENSE_-
 * FLIGHT_SCHOOL transaction. Inkrementiert die hours-counter und total-
 * CostPaid auf dem enrollment.
 *
 * Atomicity: alles in einer prisma.$transaction — wenn das wallet
 * insufficient-funds ist, rollback'd der gesamte block (kein partial-
 * state mit gebuchten hours aber ungezahltem geld).
 *
 * Sim-stunden sind nur erlaubt wenn die schule sim anbietet (hourlyRateSim
 * != null). Sonst error.
 *
 * Rate-cap: max 50h pro block. Verhindert dass ein pilot accidentally
 * 500h kauft und sein wallet leerschießt — bei größeren beträgen muss
 * er mehrere blocks machen.
 */
export async function buyTrainingHours(input: z.infer<typeof BuyHoursSchema>) {
  const parsed = BuyHoursSchema.parse(input);
  const user = await requireCareerUser();

  const enrollment = await prisma.flightSchoolEnrollment.findUnique({
    where: { id: parsed.enrollmentId },
    include: {
      school: {
        select: {
          id: true,
          name: true,
          active: true,
          hourlyRateGround: true,
          hourlyRateAir: true,
          hourlyRateSim: true,
        },
      },
    },
  });
  if (!enrollment) {
    throw new Error('Enrollment nicht gefunden.');
  }
  if (enrollment.userId !== user.id) {
    throw new Error('forbidden');
  }
  if (enrollment.status !== 'IN_PROGRESS' && enrollment.status !== 'EXAM_SCHEDULED') {
    throw new Error(
      `Enrollment ist im status ${enrollment.status} — keine weiteren hours buchbar.`,
    );
  }
  if (!enrollment.school.active) {
    throw new Error(
      'Diese Flugschule ist deaktiviert. Wende dich an einen Admin oder cancel das enrollment.',
    );
  }
  if (parsed.hoursSim > 0 && !enrollment.school.hourlyRateSim) {
    throw new Error(
      `${enrollment.school.name} bietet keinen Simulator an. Sim-Stunden auf 0 setzen.`,
    );
  }

  // Cost-calculation. Decimal-rates × Float-hours. Wir konvertieren rate
  // zu Number (vorsichtig, weil Decimal eigentlich precision-safer ist —
  // aber bei einzeln-block-amounts unter 50h × max ~500/h = max 25k VAM$
  // ist Float-rounding-error vernachlässigbar < 0.01). Storage: Decimal.
  const groundRate = Number(enrollment.school.hourlyRateGround);
  const airRate = Number(enrollment.school.hourlyRateAir);
  const simRate = enrollment.school.hourlyRateSim
    ? Number(enrollment.school.hourlyRateSim)
    : 0;

  const cost =
    parsed.hoursTheory * groundRate +
    parsed.hoursPractical * airRate +
    parsed.hoursSim * simRate;

  if (cost <= 0) {
    // Defensive — sollte schon durch zod-refine ausgeschlossen sein.
    throw new Error('Berechnete Kosten sind 0. Mindestens ein hours-block > 0.');
  }

  // Wallet + transaction in EINER db-transaction für atomicity.
  await prisma.$transaction(async (tx) => {
    const userWallet = await getOrCreateWallet({
      ownerType: 'USER',
      ownerUserId: user.id,
      db: tx,
    });
    const systemWallet = await getSystemWallet('primary', tx);

    try {
      await recordTransaction({
        walletId: userWallet.id,
        amount: -cost,
        type: 'EXPENSE_FLIGHT_SCHOOL',
        category: 'training-hours',
        description: `Training-Stunden bei ${enrollment.school.name} (${enrollment.licenseType}): ${parsed.hoursTheory}h Theorie + ${parsed.hoursPractical}h Flug + ${parsed.hoursSim}h Sim`,
        counterpartyWalletId: systemWallet.id,
        metadata: {
          enrollmentId: enrollment.id,
          schoolId: enrollment.school.id,
          licenseType: enrollment.licenseType,
          hoursTheory: parsed.hoursTheory,
          hoursPractical: parsed.hoursPractical,
          hoursSim: parsed.hoursSim,
        },
        db: tx,
      });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        throw new Error(
          `Nicht genug Geld im Wallet. Benötigt: ${cost.toFixed(2)} VAM$, verfügbar: ${e.available.toFixed(2)} VAM$.`,
        );
      }
      throw e;
    }

    await tx.flightSchoolEnrollment.update({
      where: { id: enrollment.id },
      data: {
        hoursTheory: { increment: parsed.hoursTheory },
        hoursPractical: { increment: parsed.hoursPractical },
        hoursSim: { increment: parsed.hoursSim },
        totalCostPaid: { increment: cost },
      },
    });
  });

  revalidatePath('/flight-schools');
  revalidatePath(`/flight-schools/${enrollment.school.id}`);
  revalidatePath('/wallet');
}

// ──────────────────────────────────────────────────────────────────────────
// withdrawEnrollment
// ──────────────────────────────────────────────────────────────────────────

const WithdrawSchema = z.object({
  enrollmentId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * Pilot canceled das enrollment. Status → WITHDRAWN, withdrawnAt + reason
 * gesetzt. Kein refund im MVP — das simplifiziert die finance-policy
 * deutlich (sonst müssten wir entscheiden: wieviel % refund vor exam,
 * vor 25% hours, etc.). Pilot weiß beim klick "geld ist weg" und es ist
 * dadurch eine bewusste entscheidung.
 *
 * Wenn später refund-policy gewünscht: hier wäre der ort dafür — würde
 * via recordTransaction mit type=ADMIN_ADJUSTMENT einen partial refund
 * vom SYSTEM zurück auf user-wallet buchen.
 *
 * Status-vorbedingung: nur IN_PROGRESS oder EXAM_SCHEDULED können
 * withdrawed werden. PASSED/FAILED/WITHDRAWN sind end-states und
 * unveränderlich.
 */
export async function withdrawEnrollment(input: z.infer<typeof WithdrawSchema>) {
  const parsed = WithdrawSchema.parse(input);
  const user = await requireCareerUser();

  const enrollment = await prisma.flightSchoolEnrollment.findUnique({
    where: { id: parsed.enrollmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      schoolId: true,
    },
  });
  if (!enrollment) {
    throw new Error('Enrollment nicht gefunden.');
  }
  if (enrollment.userId !== user.id) {
    throw new Error('forbidden');
  }
  if (enrollment.status !== 'IN_PROGRESS' && enrollment.status !== 'EXAM_SCHEDULED') {
    throw new Error(
      `Enrollment ist im status ${enrollment.status} — kein withdraw mehr möglich.`,
    );
  }

  await prisma.flightSchoolEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: 'WITHDRAWN',
      withdrawnAt: new Date(),
      withdrawnReason: parsed.reason?.trim() || null,
    },
  });

  revalidatePath('/flight-schools');
  revalidatePath(`/flight-schools/${enrollment.schoolId}`);
  revalidatePath('/licenses');
}
