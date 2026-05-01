'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

// ───── Permission Gates ─────
// Hinweis: Identisch zu apps/web/app/airports/actions.ts. Phase 2+ kann das
// in apps/web/lib/auth/admin-gates.ts extrahiert werden wenn ein dritter
// Caller dazu kommt (PIREP-actions hat ähnlich, aber unterschiedlicher).

async function requireAirlineAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    throw new Error('forbidden');
  }
  if (!user.airlineId) {
    throw new Error('no-airline');
  }

  return { user, airlineId: user.airlineId };
}

async function requireSystemAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    throw new Error('forbidden');
  }

  return { user };
}

// ───── Validation Schemas ─────

// Categories sync mit AircraftTypeSeed in packages/db/prisma/aircraft-types.ts.
const AircraftTypeCategorySchema = z.enum([
  'narrow_body',
  'wide_body',
  'regional',
  'cargo',
  'ga',
]);

const AircraftTypeDataSchema = z.object({
  // ICAO type designator: 2-4 chars, letters + digits (e.g. "B738", "A20N",
  // "C172", "A359", "B788"). Stricter regex than airport ICAO.
  icaoType: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,4}$/, 'ICAO-Type must be 2-4 letters/digits'),
  name: z.string().trim().min(1).max(100),
  manufacturer: z.string().trim().min(1).max(50),
  category: AircraftTypeCategorySchema,
  rangeNm: z.number().int().min(1).max(20000),
  capacityPax: z.number().int().min(0).max(900),
  cruiseSpeedKt: z.number().int().min(50).max(700),
  fuelBurnKgH: z.number().int().min(1).max(50000),
  imageUrl: z
    .string()
    .url('Image URL must be a valid URL')
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

const SubmitAircraftTypeRequestSchema = AircraftTypeDataSchema.extend({
  reason: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

export type SubmitAircraftTypeRequestInput = z.input<
  typeof SubmitAircraftTypeRequestSchema
>;

const ApproveAircraftTypeRequestSchema = z.object({
  requestId: z.string().min(1),
  asVerified: z.boolean(),
  edits: AircraftTypeDataSchema.partial().nullable().optional(),
  reviewerNotes: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

export type ApproveAircraftTypeRequestInput = z.input<
  typeof ApproveAircraftTypeRequestSchema
>;

// ───── Submit ─────

/**
 * Airline-admin proposes a new aircraft type. Creates an AircraftTypeRequest
 * row in Submitted status. System-admin must approve.
 *
 * Duplicate-detection: rejects if icaoType already exists in AircraftType
 * table OR in an open AircraftTypeRequest. Approved/Rejected requests don't
 * block re-submission.
 */
export async function submitAircraftTypeRequest(
  input: SubmitAircraftTypeRequestInput,
) {
  const { user, airlineId } = await requireAirlineAdmin();
  const data = SubmitAircraftTypeRequestSchema.parse(input);

  const existing = await prisma.aircraftType.findUnique({
    where: { icaoType: data.icaoType },
    select: { id: true, name: true, verified: true },
  });
  if (existing) {
    throw new Error(
      `AircraftType ${data.icaoType} (${existing.name}) existiert bereits${
        existing.verified ? '' : ' (unverified)'
      }`,
    );
  }

  const existingOpenRequest = await prisma.aircraftTypeRequest.findFirst({
    where: {
      icaoType: data.icaoType,
      status: { in: ['Submitted', 'UnderReview'] },
    },
    select: { id: true, requestedById: true, submittedAt: true },
  });
  if (existingOpenRequest) {
    const ownLabel =
      existingOpenRequest.requestedById === user.id ? ' (deiner)' : '';
    throw new Error(
      `Es gibt bereits einen offenen Request für ${data.icaoType}${ownLabel} vom ` +
        `${existingOpenRequest.submittedAt.toISOString().slice(0, 10)}`,
    );
  }

  const request = await prisma.aircraftTypeRequest.create({
    data: {
      icaoType: data.icaoType,
      name: data.name,
      manufacturer: data.manufacturer,
      category: data.category,
      rangeNm: data.rangeNm,
      capacityPax: data.capacityPax,
      cruiseSpeedKt: data.cruiseSpeedKt,
      fuelBurnKgH: data.fuelBurnKgH,
      imageUrl: data.imageUrl ?? null,
      reason: data.reason ?? null,
      requestedById: user.id,
      requestedAirlineId: airlineId,
      status: 'Submitted',
    },
  });

  revalidatePath('/aircraft-types');
  revalidatePath('/admin/requests');

  return { id: request.id };
}

// ───── Withdraw ─────

export async function withdrawAircraftTypeRequest(requestId: string) {
  const { user } = await requireAirlineAdmin();

  const request = await prisma.aircraftTypeRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requestedById: true, status: true },
  });
  if (!request) throw new Error('Request nicht gefunden');
  if (request.requestedById !== user.id) {
    throw new Error('Du kannst nur eigene Requests zurückziehen');
  }
  if (request.status !== 'Submitted' && request.status !== 'UnderReview') {
    throw new Error(`Request hat bereits Status: ${request.status}`);
  }

  await prisma.aircraftTypeRequest.update({
    where: { id: requestId },
    data: {
      status: 'Rejected',
      reviewedAt: new Date(),
      reviewedById: user.id,
      rejectionReason: 'withdrawn by submitter',
    },
  });

  revalidatePath('/aircraft-types');
  revalidatePath('/admin/requests');
}

// ───── Approve ─────

export async function approveAircraftTypeRequest(
  input: ApproveAircraftTypeRequestInput,
) {
  const { user: approver } = await requireSystemAdmin();
  const { requestId, asVerified, edits, reviewerNotes } =
    ApproveAircraftTypeRequestSchema.parse(input);

  const request = await prisma.aircraftTypeRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) throw new Error('Request nicht gefunden');
  if (request.status === 'Approved' || request.status === 'Rejected') {
    throw new Error(`Request ist bereits terminal: ${request.status}`);
  }

  const effective = {
    icaoType: edits?.icaoType ?? request.icaoType,
    name: edits?.name ?? request.name,
    manufacturer: edits?.manufacturer ?? request.manufacturer,
    category: edits?.category ?? request.category,
    rangeNm: edits?.rangeNm ?? request.rangeNm,
    capacityPax: edits?.capacityPax ?? request.capacityPax,
    cruiseSpeedKt: edits?.cruiseSpeedKt ?? request.cruiseSpeedKt,
    fuelBurnKgH: edits?.fuelBurnKgH ?? request.fuelBurnKgH,
    imageUrl: edits?.imageUrl !== undefined ? edits.imageUrl : request.imageUrl,
  };

  const collision = await prisma.aircraftType.findUnique({
    where: { icaoType: effective.icaoType },
    select: { id: true, name: true },
  });
  if (collision) {
    throw new Error(
      `AircraftType ${effective.icaoType} (${collision.name}) existiert bereits — ` +
        `bitte Request rejecten statt approven`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const aircraftType = await tx.aircraftType.create({
      data: {
        icaoType: effective.icaoType,
        name: effective.name,
        manufacturer: effective.manufacturer,
        category: effective.category,
        rangeNm: effective.rangeNm,
        capacityPax: effective.capacityPax,
        cruiseSpeedKt: effective.cruiseSpeedKt,
        fuelBurnKgH: effective.fuelBurnKgH,
        imageUrl: effective.imageUrl,
        verified: asVerified,
        verifiedAt: asVerified ? new Date() : null,
        verifiedById: asVerified ? approver.id : null,
        proposedFromRequestId: request.id,
      },
    });

    await tx.aircraftTypeRequest.update({
      where: { id: request.id },
      data: {
        status: 'Approved',
        reviewedAt: new Date(),
        reviewedById: approver.id,
        reviewerNotes: reviewerNotes ?? null,
        approvedAsVerified: asVerified,
      },
    });

    return aircraftType;
  });

  revalidatePath('/aircraft-types');
  revalidatePath('/admin/requests');
  revalidatePath('/admin/aircraft-types');

  return { aircraftTypeId: result.id, icaoType: result.icaoType };
}

// ───── Reject ─────

export async function rejectAircraftTypeRequest(
  requestId: string,
  rejectionReason: string,
) {
  const { user: reviewer } = await requireSystemAdmin();

  const reason = z
    .string()
    .trim()
    .min(1, 'Begründung erforderlich')
    .max(500)
    .parse(rejectionReason);

  const request = await prisma.aircraftTypeRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true },
  });
  if (!request) throw new Error('Request nicht gefunden');
  if (request.status === 'Approved' || request.status === 'Rejected') {
    throw new Error(`Request ist bereits terminal: ${request.status}`);
  }

  await prisma.aircraftTypeRequest.update({
    where: { id: requestId },
    data: {
      status: 'Rejected',
      reviewedAt: new Date(),
      reviewedById: reviewer.id,
      rejectionReason: reason,
    },
  });

  revalidatePath('/aircraft-types');
  revalidatePath('/admin/requests');
}
