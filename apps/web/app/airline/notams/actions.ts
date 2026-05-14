'use server';

/**
 * Welle L / L5 — NOTAM server actions.
 *
 * # Permission model
 *
 * Airline-admin-only für mutations. Pilots können nur reading.
 *
 * # Lifecycle
 *
 *   create   → Draft (publishedAt=null)
 *   publish  → publishedAt=now()
 *   update   → erlaubt vor + nach publish (typo-fix, validUntil extension)
 *   cancel   → cancelledAt=now() — bleibt im audit-trail
 *   delete   → nur Drafts (hard delete)
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';

export type NotamActionResult =
  | { ok: true; message?: string; notamId?: string }
  | { ok: false; error: string };

const TITLE_MAX = 200;
const BODY_MAX = 10000;

type NotamTypeStr = 'Closure' | 'Restriction' | 'Procedure' | 'Info';
type NotamSeverityStr = 'Info' | 'Warning' | 'Critical';

const ALLOWED_TYPES: NotamTypeStr[] = ['Closure', 'Restriction', 'Procedure', 'Info'];
const ALLOWED_SEVERITIES: NotamSeverityStr[] = ['Info', 'Warning', 'Critical'];

function normalizeIcaos(input: string[]): string[] {
  const cleaned = input
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length >= 3 && s.length <= 10);
  // Dedupe
  return Array.from(new Set(cleaned));
}

// ─────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────

export async function createNotamAction(input: {
  type: string;
  severity: string;
  title: string;
  body: string;
  affectedIcaos: string[];
  validFromIso: string;
  validUntilIso?: string | null;
}): Promise<NotamActionResult> {
  const { user: admin, airlineId } = await requireAirlineManagerWithAirline();

  const title = input.title.trim();
  const body = input.body.trim();

  if (title.length < 5 || title.length > TITLE_MAX) {
    return { ok: false, error: `Titel 5-${TITLE_MAX} chars.` };
  }
  if (body.length < 10 || body.length > BODY_MAX) {
    return { ok: false, error: `Body 10-${BODY_MAX} chars.` };
  }
  if (!ALLOWED_TYPES.includes(input.type as NotamTypeStr)) {
    return { ok: false, error: 'Ungültiger NOTAM-typ.' };
  }
  if (!ALLOWED_SEVERITIES.includes(input.severity as NotamSeverityStr)) {
    return { ok: false, error: 'Ungültige severity.' };
  }

  const validFrom = new Date(input.validFromIso);
  if (isNaN(validFrom.getTime())) {
    return { ok: false, error: 'Ungültiges validFrom-datum.' };
  }
  let validUntil: Date | null = null;
  if (input.validUntilIso) {
    validUntil = new Date(input.validUntilIso);
    if (isNaN(validUntil.getTime())) {
      return { ok: false, error: 'Ungültiges validUntil-datum.' };
    }
    if (validUntil.getTime() <= validFrom.getTime()) {
      return { ok: false, error: 'validUntil muss nach validFrom liegen.' };
    }
  }

  const affectedIcaos = normalizeIcaos(input.affectedIcaos);

  const notam = await prisma.notam.create({
    data: {
      airlineId,
      type: input.type as NotamTypeStr,
      severity: input.severity as NotamSeverityStr,
      title,
      body,
      affectedIcaos,
      validFrom,
      validUntil,
      createdById: admin.id,
    },
    select: { id: true },
  });

  revalidatePath('/airline/notams');
  return { ok: true, notamId: notam.id, message: 'NOTAM erstellt (Draft).' };
}

// ─────────────────────────────────────────────────────────────────────
// helpers + transitions
// ─────────────────────────────────────────────────────────────────────

async function requireAdminOwnedNotam(
  notamId: string,
): Promise<{ airlineId: string; publishedAt: Date | null; cancelledAt: Date | null } | null> {
  const { airlineId } = await requireAirlineManagerWithAirline();
  const n = await prisma.notam.findUnique({
    where: { id: notamId },
    select: { airlineId: true, publishedAt: true, cancelledAt: true },
  });
  if (!n || n.airlineId !== airlineId) return null;
  return n;
}

export async function publishNotamAction(
  notamId: string,
): Promise<NotamActionResult> {
  const n = await requireAdminOwnedNotam(notamId);
  if (!n) return { ok: false, error: 'NOTAM nicht gefunden.' };
  if (n.publishedAt) return { ok: false, error: 'Schon publisht.' };
  if (n.cancelledAt) return { ok: false, error: 'Cancelled NOTAMs können nicht publisht werden.' };

  await prisma.notam.update({
    where: { id: notamId },
    data: { publishedAt: new Date() },
  });
  revalidatePath(`/airline/notams/${notamId}`);
  revalidatePath('/airline/notams');
  revalidatePath('/notams');
  return { ok: true, message: 'NOTAM publisht.' };
}

export async function cancelNotamAction(
  notamId: string,
): Promise<NotamActionResult> {
  const n = await requireAdminOwnedNotam(notamId);
  if (!n) return { ok: false, error: 'NOTAM nicht gefunden.' };
  if (n.cancelledAt) return { ok: false, error: 'Schon cancelled.' };

  await prisma.notam.update({
    where: { id: notamId },
    data: { cancelledAt: new Date() },
  });
  revalidatePath(`/airline/notams/${notamId}`);
  revalidatePath('/airline/notams');
  revalidatePath('/notams');
  return { ok: true, message: 'NOTAM cancelled.' };
}

export async function deleteNotamAction(
  notamId: string,
): Promise<NotamActionResult> {
  const n = await requireAdminOwnedNotam(notamId);
  if (!n) return { ok: false, error: 'NOTAM nicht gefunden.' };
  if (n.publishedAt) {
    return {
      ok: false,
      error: 'Nur Draft-NOTAMs können gelöscht werden. Sonst → cancel.',
    };
  }
  await prisma.notam.delete({ where: { id: notamId } });
  revalidatePath('/airline/notams');
  return { ok: true, message: 'NOTAM gelöscht.' };
}

export async function updateNotamAction(input: {
  notamId: string;
  title: string;
  body: string;
  severity: string;
  affectedIcaos: string[];
  validUntilIso?: string | null;
}): Promise<NotamActionResult> {
  const n = await requireAdminOwnedNotam(input.notamId);
  if (!n) return { ok: false, error: 'NOTAM nicht gefunden.' };
  if (n.cancelledAt) return { ok: false, error: 'Cancelled NOTAMs können nicht editiert werden.' };

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 5 || title.length > TITLE_MAX) {
    return { ok: false, error: `Titel 5-${TITLE_MAX} chars.` };
  }
  if (body.length < 10 || body.length > BODY_MAX) {
    return { ok: false, error: `Body 10-${BODY_MAX} chars.` };
  }
  if (!ALLOWED_SEVERITIES.includes(input.severity as NotamSeverityStr)) {
    return { ok: false, error: 'Ungültige severity.' };
  }
  let validUntil: Date | null = null;
  if (input.validUntilIso) {
    validUntil = new Date(input.validUntilIso);
    if (isNaN(validUntil.getTime())) {
      return { ok: false, error: 'Ungültiges validUntil-datum.' };
    }
  }
  const affectedIcaos = normalizeIcaos(input.affectedIcaos);

  await prisma.notam.update({
    where: { id: input.notamId },
    data: {
      title,
      body,
      severity: input.severity as NotamSeverityStr,
      affectedIcaos,
      validUntil,
    },
  });
  revalidatePath(`/airline/notams/${input.notamId}`);
  revalidatePath('/airline/notams');
  revalidatePath('/notams');
  return { ok: true, message: 'NOTAM aktualisiert.' };
}
