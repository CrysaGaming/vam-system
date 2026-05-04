'use server';

import { auth } from '@/auth';
import { prisma, Prisma, processFlightEconomy, InsufficientFundsError } from '@vam/db';
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

  // Welle 4: Position-tracking. Bei approval setzen wir User.currentLocation*
  // auf den arrival-airport. Quelle = PIREP (audit-trail über LocationSource
  // enum). Das passiert ATOMAR mit dem PIREP-status-update via $transaction
  // — wenn entweder fehlschlägt, rollback. Verhindert inconsistent state
  // wo PIREP="Approved" aber User.currentLocation noch alt ist.
  //
  // Edge-cases:
  // - User hat schon eine ACARS/VATSIM-position: wir überschreiben trotzdem
  //   mit PIREP. Source-precedence (ACARS > VATSIM/IVAO > PIREP > JUMPSEAT >
  //   MANUAL) ist eine read-side concern (welche position bevorzugen wir
  //   beim ANZEIGEN?), nicht write-side. Beim WRITE setzen wir immer auf
  //   den aktuellsten event. App kann später z.B. live ACARS-positions
  //   bevorzugen wenn currentLocationAt jünger als x minuten ist.
  // - Multi-leg-flights: jeder approved PIREP setzt position auf seinen
  //   arrival. Sequenzielle approvals → letzte arrival gewinnt (correct).
  // - PIREP-re-approval nach un-reject: rejectPirep cleart position NICHT
  //   (siehe dortigen kommentar), also bleibt die alte position bis ein
  //   neuer PIREP approved wird. Bewusst — un-reject ist ein admin-fix-flow,
  //   nicht ein flight-event.
  //
  // Welle 5: Aircraft-position-tracking. Wenn der PIREP an ein aircraft
  // gebunden ist (aircraftId not null), setzen wir auch Aircraft.current
  // Location*. Mirrors die User-position-logik. Wenn aircraftId null ist
  // (z.B. legacy-PIREPs ohne aircraft, oder free-flight-PIREPs), kein
  // aircraft-update. Conditional ins transaction-array gepushed damit die
  // atomicity erhalten bleibt — entweder beide updates greifen oder keiner.
  // RETIRED-aircraft kriegen trotzdem position-updates wenn ein PIREP an
  // sie gebunden ist (kann durch alte bookings passieren); audit-trail
  // ist wertvoller als status-purity.
  const transactionOps: Prisma.PrismaPromise<unknown>[] = [
    prisma.pirep.update({
      where: { id: pirepId },
      data: {
        status: 'Approved',
        approvedAt: new Date(),
        approvedById: approver.id,
        // Falls vorher rejected war (nicht möglich aus diesem Zweig, aber defensiv): clearen
        rejectedAt: null,
        rejectionReason: null,
      },
    }),
    prisma.user.update({
      where: { id: pirep.userId },
      data: {
        currentLocationIcao: pirep.arrival.icao,
        currentLocationSource: 'PIREP',
        currentLocationAt: new Date(),
      },
    }),
  ];

  if (pirep.aircraftId) {
    transactionOps.push(
      prisma.aircraft.update({
        where: { id: pirep.aircraftId },
        data: {
          currentLocationIcao: pirep.arrival.icao,
          currentLocationAt: new Date(),
        },
      }),
    );
  }

  await prisma.$transaction(transactionOps);

  // Welle 13 (Economy MVP): nach erfolgreichem approval die economy
  // verarbeiten — passenger/cargo revenue auf airline-wallet, fuel/
  // landing/ground/catering expenses auf airline-wallet, salary-transfer
  // airline → user. Idempotent via Pirep.revenueProcessed-flag.
  //
  // Kein await innerhalb der approval-$transaction weil:
  //   1. Economy-processing hat seine eigene atomicity (separate
  //      $transaction für die 4-7 wallet-bewegungen)
  //   2. Wenn economy fehlschlägt (z.B. airline-wallet ist nicht
  //      mehr decken-fähig auch mit credit-puffer), soll der approval
  //      trotzdem stehen — admin kann später re-eval'n.
  //   3. Nicht-economy-airlines/-pilots sollen ohne overhead approven
  //      können — processFlightEconomy returnt early mit reason.
  //
  // Errors loggen wir, aber werfen NICHT weiter — der approval ist
  // gültig auch wenn die wallet-buchungen scheitern.
  try {
    const result = await processFlightEconomy(pirepId);
    if (result.processed) {
      console.info(
        `[approvePirep] economy processed for ${pirepId}: net=${result.summary.net.toString()} VAM$`,
      );
    } else if (result.reason !== 'airline-economy-disabled' && result.reason !== 'user-economy-disabled') {
      // Nur loggen wenn die airline/user economy aktiv haben — sonst
      // ist das normal-skip und log-noise.
      console.info(`[approvePirep] economy skipped: ${result.reason}`);
    }
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      console.error(
        `[approvePirep] economy-processing failed for ${pirepId}: airline-wallet insufficient funds (${err.message}). Approval stands; admin can retry via re-eval.`,
      );
    } else {
      console.error('[approvePirep] economy-processing failed:', err);
    }
  }

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