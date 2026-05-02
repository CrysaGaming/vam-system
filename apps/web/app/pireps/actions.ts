'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { emitPirepApproved, emitPirepRejected } from '@/lib/bot-events';
import { APPROVER_ROLES, isApproverRole } from '@/lib/roles';

/**
 * Server-side guard: throws wenn der current user keine approver-rolle hat.
 * Approver-rollen sind in @/lib/roles.ts (APPROVER_ROLES) zentralisiert
 * damit die liste nicht in mehreren files driftet — siehe dortigen
 * dokumentations-block.
 */
async function assertCanApprove() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user) {
    throw new Error('User nicht gefunden');
  }

  if (!isApproverRole(user.role?.name)) {
    throw new Error(
      `Keine Berechtigung — nur ${APPROVER_ROLES.join(', ')} dürfen PIREPs prüfen`,
    );
  }

  return user;
}

/**
 * Genehmigt einen PIREP. Nur für rollen aus APPROVER_ROLES.
 * Postet Bot-Event nach #pireps.
 */
export async function approvePirep(pirepId: string) {
  const approver = await assertCanApprove();

  // Hole PIREP inkl. aller Daten für Bot-Embed
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      user: {
        include: {
          accounts: {
            where: { provider: 'discord' },
            select: { providerAccountId: true },
          },
        },
      },
    },
  });

  if (!pirep) {
    throw new Error('PIREP nicht gefunden');
  }

  if (pirep.status !== 'Submitted') {
    throw new Error(`PIREP hat bereits Status: ${pirep.status}`);
  }

  // Update in Transaktion
  await prisma.pirep.update({
    where: { id: pirepId },
    data: {
      status: 'Approved',
      approvedAt: new Date(),
      approvedById: approver.id,
      // Falls vorher rejected war (nicht möglich aus diesem Zweig, aber defensiv): clearen
      rejectedAt: null,
      rejectionReason: null,
    },
  });

  // Bot benachrichtigen — silent failure wenn Bot offline
  try {
    await emitPirepApproved({
      pirepId: pirep.id,
      flightNumber: pirep.route?.flightNumber ?? 'PIREP',
      pilotDiscordId: pirep.user.accounts[0]?.providerAccountId ?? null,
      pilotName: pirep.user.name ?? 'Unbenannt',
      approverName: approver.name ?? 'Unbenannt',
      approverDiscordId: null, // wird im nächsten Step befüllt wenn nötig
      departureIcao: pirep.departure.icao,
      arrivalIcao: pirep.arrival.icao,
    });
  } catch (err) {
    console.error('[approvePirep] Bot-Event fehlgeschlagen:', err);
  }

  // Caches invalidieren
  revalidatePath('/pireps');
  revalidatePath('/pireps/pending');
  revalidatePath(`/pireps/${pirepId}`);
  revalidatePath('/dashboard');
}

/**
 * Lehnt einen PIREP ab. Nur für rollen aus APPROVER_ROLES.
 * Grund ist erforderlich.
 * Postet Bot-Event nach #pireps.
 */
export async function rejectPirep(pirepId: string, reason: string) {
  const approver = await assertCanApprove();

  if (!reason || reason.trim().length < 3) {
    throw new Error('Ablehnungsgrund muss mindestens 3 Zeichen lang sein');
  }

  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      user: {
        include: {
          accounts: {
            where: { provider: 'discord' },
            select: { providerAccountId: true },
          },
        },
      },
    },
  });

  if (!pirep) {
    throw new Error('PIREP nicht gefunden');
  }

  if (pirep.status !== 'Submitted') {
    throw new Error(`PIREP hat bereits Status: ${pirep.status}`);
  }

  await prisma.pirep.update({
    where: { id: pirepId },
    data: {
      status: 'Rejected',
      rejectedAt: new Date(),
      approvedById: approver.id,
      rejectionReason: reason.trim(),
      approvedAt: null,
    },
  });

  // Bot benachrichtigen
  try {
    await emitPirepRejected({
      pirepId: pirep.id,
      flightNumber: pirep.route?.flightNumber ?? 'PIREP',
      pilotDiscordId: pirep.user.accounts[0]?.providerAccountId ?? null,
      pilotName: pirep.user.name ?? 'Unbenannt',
      approverName: approver.name ?? 'Unbenannt',
      approverDiscordId: null,
      departureIcao: pirep.departure.icao,
      arrivalIcao: pirep.arrival.icao,
      reason: reason.trim(),
    });
  } catch (err) {
    console.error('[rejectPirep] Bot-Event fehlgeschlagen:', err);
  }

  revalidatePath('/pireps');
  revalidatePath('/pireps/pending');
  revalidatePath(`/pireps/${pirepId}`);
  revalidatePath('/dashboard');
}