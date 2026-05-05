import { Prisma, type Event, type EventParticipant, type EventStatus, type EventKind } from "@prisma/client";
import { prisma } from "../index.js";
import { getOrCreateWallet, recordTransaction } from "../economy/wallet.js";
import { toDecimal } from "../economy/decimal.js";

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Write-side actions.
 *
 * Auth-checks sind caller-responsibility (server-actions in apps/web).
 * Pure DB-helpers ohne session-context bleiben composable für CLI-tools
 * und seed-scripts.
 *
 * # State-machine
 *
 * DRAFT → PUBLISHED → COMPLETED
 *      ↓
 *  CANCELLED  (jederzeit vor COMPLETED möglich)
 *
 * - createEvent → DRAFT
 * - publishEvent: DRAFT → PUBLISHED
 * - cancelEvent: DRAFT|PUBLISHED → CANCELLED
 * - completeEvent: PUBLISHED → COMPLETED
 *
 * Re-publish nach cancel ist NICHT vorgesehen — wenn ein admin einen
 * cancellation rückgängig machen will, soll er einen neuen event mit
 * neuer ID anlegen. Verhindert "ghost-events" deren state-historie
 * verwirrend ist.
 *
 * # Slug
 *
 * Slug wird beim createEvent automatisch generiert aus title via
 * `slugify(title)`. Bei kollision hängt -2/-3/etc. an. Slug ist 1x
 * gesetzt + immutable beim updateEvent (deshalb kein slug-feld in
 * UpdateEventInput) — sonst würden public-links nach edit kaputtgehen.
 *
 * # bonusReward + completion-economics
 *
 * Beim markParticipantCompleted credit'n wir den bonusReward (wenn > 0)
 * dem user-wallet als REVENUE_PASSENGER mit category="event-bonus".
 * Schema-comment dokumentiert warum wir hier kein separater
 * REVENUE_EVENT_BONUS-enum-value einführen (MVP-policy).
 *
 * Idempotency: wenn participant schon completed=true ist, returnt der
 * call wasAlreadyCompleted=true OHNE doppelt zu zahlen — und auch ohne
 * den completedAt-timestamp zu überschreiben.
 */

// ─────────────────────────────────────────────────────────────────────
// Slug-helper
// ─────────────────────────────────────────────────────────────────────

/**
 * Konvertiert einen titel in einen URL-safe slug.
 *
 * - Lowercase
 * - Diakritika entfernt (NFD + remove combining-marks)
 * - Nicht-alphanumerische zeichen → "-"
 * - Konsekutive "-" zusammenfassen
 * - Trim leading/trailing "-"
 * - Maxlänge: 80 chars (slug ist DB @unique, nicht beliebig lang)
 */
export function slugify(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base.length > 0 ? base : "event";
}

/**
 * Generiert einen unique slug. Bei kollision hängt -2, -3, etc. an.
 * Race-conditions werden NICHT behandelt — die kollisionschance bei
 * pro-event-slug ist verschwindend gering und im worst-case kriegt
 * der zweite caller einen P2002 (unique-constraint), den der admin-UI
 * als "name schon vergeben — versuch einen kleinen unterschied" rendert.
 */
async function findUniqueSlug(baseTitle: string): Promise<string> {
  const base = slugify(baseTitle);
  let candidate = base;
  let suffix = 2;
  while (
    await prisma.event.findUnique({ where: { slug: candidate }, select: { id: true } })
  ) {
    candidate = `${base}-${suffix}`;
    suffix++;
    if (suffix > 100) {
      // Defensiv: bei einem absurd-häufigen titel würden wir ewig loopen.
      // Throw in production damit fix klar wird.
      throw new Error(`Cannot find unique slug for title="${baseTitle}" after 100 attempts`);
    }
  }
  return candidate;
}

// ─────────────────────────────────────────────────────────────────────
// createEvent
// ─────────────────────────────────────────────────────────────────────

export type CreateEventInput = {
  airlineId: string | null;
  title: string;
  description: string;
  kind?: EventKind;
  coverImageUrl?: string | null;
  bonusReward?: number;
  maxParticipants?: number | null;
  startsAt: Date;
  endsAt?: Date | null;
  legs?: Array<{ icao: string; label?: string; note?: string }> | null;
  createdById: string;
};

/**
 * Erstellt einen neuen event als DRAFT. Slug wird auto-generiert aus
 * title (mit kollisions-suffix). Caller ist verantwortlich für
 * permission-checks (admin-only).
 */
export async function createEvent(input: CreateEventInput): Promise<Event> {
  const slug = await findUniqueSlug(input.title);
  return prisma.event.create({
    data: {
      airlineId: input.airlineId,
      title: input.title,
      slug,
      description: input.description,
      kind: input.kind ?? "THEMED",
      status: "DRAFT",
      coverImageUrl: input.coverImageUrl ?? null,
      bonusReward: toDecimal(input.bonusReward ?? 0),
      maxParticipants: input.maxParticipants ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      legs:
        input.legs === undefined || input.legs === null
          ? Prisma.JsonNull
          : (input.legs as unknown as Prisma.InputJsonValue),
      createdById: input.createdById,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// updateEvent
// ─────────────────────────────────────────────────────────────────────

export type UpdateEventInput = {
  id: string;
  title?: string;
  description?: string;
  kind?: EventKind;
  coverImageUrl?: string | null;
  bonusReward?: number;
  maxParticipants?: number | null;
  startsAt?: Date;
  endsAt?: Date | null;
  legs?: Array<{ icao: string; label?: string; note?: string }> | null;
};

/**
 * Updated event-felder. Slug ist EXPLIZIT NICHT updatable — links
 * sollen stabil bleiben. Falls admin den title komplett anders machen
 * will und ein neuer slug gewünscht ist, soll er einen neuen event
 * anlegen + den alten cancellen.
 */
export async function updateEvent(input: UpdateEventInput): Promise<Event> {
  const data: Prisma.EventUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.coverImageUrl !== undefined) data.coverImageUrl = input.coverImageUrl;
  if (input.bonusReward !== undefined) data.bonusReward = toDecimal(input.bonusReward);
  if (input.maxParticipants !== undefined) data.maxParticipants = input.maxParticipants;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;
  if (input.legs !== undefined) {
    data.legs =
      input.legs === null
        ? Prisma.JsonNull
        : (input.legs as unknown as Prisma.InputJsonValue);
  }
  return prisma.event.update({ where: { id: input.id }, data });
}

// ─────────────────────────────────────────────────────────────────────
// State transitions (publish, cancel, complete)
// ─────────────────────────────────────────────────────────────────────

export type StateTransitionResult =
  | { ok: true; event: Event }
  | { ok: false; reason: string; currentStatus: EventStatus };

/**
 * Publiziert einen DRAFT event. Falls der event nicht im DRAFT-status
 * ist, returnt ok=false mit current-status. Bot-dispatch (discord-embed)
 * passiert NICHT hier — caller macht emitEventPublished nach
 * erfolgreichem publish (race-tolerance: wenn bot down ist, hat der
 * publish trotzdem stattgefunden).
 */
export async function publishEvent(id: string): Promise<StateTransitionResult> {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return { ok: false, reason: "Event nicht gefunden", currentStatus: "DRAFT" };
  if (event.status !== "DRAFT") {
    return {
      ok: false,
      reason: `Event ist im status ${event.status}, kann nicht publiziert werden`,
      currentStatus: event.status,
    };
  }
  const updated = await prisma.event.update({
    where: { id },
    data: { status: "PUBLISHED" },
  });
  return { ok: true, event: updated };
}

/**
 * Markiert event als CANCELLED. Erlaubt von DRAFT und PUBLISHED.
 * COMPLETED-events können nicht mehr cancelled werden (history wäre
 * inkonsistent).
 */
export async function cancelEvent(id: string): Promise<StateTransitionResult> {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return { ok: false, reason: "Event nicht gefunden", currentStatus: "DRAFT" };
  if (event.status === "COMPLETED" || event.status === "CANCELLED") {
    return {
      ok: false,
      reason: `Event ist im status ${event.status}, cancel nicht möglich`,
      currentStatus: event.status,
    };
  }
  const updated = await prisma.event.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  return { ok: true, event: updated };
}

/**
 * Markiert event als COMPLETED. Erlaubt nur von PUBLISHED.
 *
 * NOTE: completes für individuelle participants müssen separat via
 * markParticipantCompleted gesetzt werden — completeEvent flippt nur
 * den event-level status, nicht die per-participant flags. Admin kann
 * also event als complete markieren ohne dass alle participants als
 * completed flagged sein müssen (z.B. einige no-shows).
 */
export async function completeEvent(id: string): Promise<StateTransitionResult> {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return { ok: false, reason: "Event nicht gefunden", currentStatus: "DRAFT" };
  if (event.status !== "PUBLISHED") {
    return {
      ok: false,
      reason: `Event ist im status ${event.status}, kann nicht abgeschlossen werden`,
      currentStatus: event.status,
    };
  }
  const updated = await prisma.event.update({
    where: { id },
    data: { status: "COMPLETED" },
  });
  return { ok: true, event: updated };
}

// ─────────────────────────────────────────────────────────────────────
// deleteEvent (DRAFT/CANCELLED only)
// ─────────────────────────────────────────────────────────────────────

/**
 * Löscht einen event PLUS alle EventParticipant-rows (cascade via
 * schema). Erlaubt nur für DRAFT und CANCELLED — published/completed
 * events bleiben erhalten als historie.
 *
 * Returnt die zahl der mitgelöschten participants als fyi für UI-
 * confirmation.
 */
export async function deleteEvent(id: string): Promise<
  | { ok: true; participantsDeleted: number }
  | { ok: false; reason: string; currentStatus: EventStatus }
> {
  const event = await prisma.event.findUnique({
    where: { id },
    include: { _count: { select: { participants: true } } },
  });
  if (!event) return { ok: false, reason: "Event nicht gefunden", currentStatus: "DRAFT" };
  if (event.status !== "DRAFT" && event.status !== "CANCELLED") {
    return {
      ok: false,
      reason: `Event ist im status ${event.status}, kann nicht gelöscht werden`,
      currentStatus: event.status,
    };
  }
  await prisma.event.delete({ where: { id } });
  return { ok: true, participantsDeleted: event._count.participants };
}

// ─────────────────────────────────────────────────────────────────────
// joinEvent / leaveEvent (participant-actions)
// ─────────────────────────────────────────────────────────────────────

export type JoinEventResult =
  | { ok: true; wasAlreadyJoined: false; participant: EventParticipant }
  | { ok: true; wasAlreadyJoined: true; participant: EventParticipant }
  | { ok: false; reason: "event-not-found" | "event-not-published" | "event-full" | "event-ended" };

/**
 * Pilot meldet sich an einem event an. Idempotent: wenn schon angemeldet,
 * returnt wasAlreadyJoined=true. Validations:
 *
 * - Event muss existieren
 * - Event muss PUBLISHED sein (DRAFT/CANCELLED/COMPLETED → reject)
 * - Event endsAt darf nicht vergangen sein (kein anmelden für past events)
 * - Wenn maxParticipants gesetzt + erreicht → "event-full"
 *
 * Race auf maxParticipants: zwei concurrent joins könnten beide den
 * count-check bestehen und dann beide den row anlegen. Wir nutzen
 * eine transaction mit count + create — postgres serialisiert das
 * sodass im worst-case einer den 11. slot kriegt wenn cap=10 (kleines
 * over-fill). Akzeptabel weil maxParticipants ein soft-limit ist —
 * härteres locking wäre overengineering für MVP.
 */
export async function joinEvent(
  eventId: string,
  userId: string,
): Promise<JoinEventResult> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { participants: true } } },
    });
    if (!event) return { ok: false as const, reason: "event-not-found" as const };
    if (event.status !== "PUBLISHED") {
      return { ok: false as const, reason: "event-not-published" as const };
    }
    if (event.endsAt && event.endsAt.getTime() < Date.now()) {
      return { ok: false as const, reason: "event-ended" as const };
    }

    // Existing-check
    const existing = await tx.eventParticipant.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (existing) {
      return { ok: true as const, wasAlreadyJoined: true as const, participant: existing };
    }

    // Cap-check
    if (
      event.maxParticipants !== null &&
      event._count.participants >= event.maxParticipants
    ) {
      return { ok: false as const, reason: "event-full" as const };
    }

    const participant = await tx.eventParticipant.create({
      data: { eventId, userId },
    });
    return {
      ok: true as const,
      wasAlreadyJoined: false as const,
      participant,
    };
  });
}

export type LeaveEventResult = {
  ok: true;
  wasAlreadyAbsent: boolean;
};

/**
 * Pilot meldet sich vom event ab. Idempotent: wenn nicht angemeldet,
 * wasAlreadyAbsent=true. Erlaubt auch nach completion-flag — der
 * participant verschwindet aus der liste, aber wallet-credits aus
 * markParticipantCompleted bleiben (transactions sind immutable).
 */
export async function leaveEvent(
  eventId: string,
  userId: string,
): Promise<LeaveEventResult> {
  const result = await prisma.eventParticipant.deleteMany({
    where: { eventId, userId },
  });
  return { ok: true, wasAlreadyAbsent: result.count === 0 };
}

// ─────────────────────────────────────────────────────────────────────
// markParticipantCompleted (admin-action)
// ─────────────────────────────────────────────────────────────────────

export type MarkCompletedResult =
  | {
      ok: true;
      wasAlreadyCompleted: false;
      participant: EventParticipant;
      bonusCredited: number;
    }
  | {
      ok: true;
      wasAlreadyCompleted: true;
      participant: EventParticipant;
    }
  | { ok: false; reason: "participant-not-found" };

/**
 * Admin markiert einen participant als event-completed. Idempotent: wenn
 * schon completed=true, return wasAlreadyCompleted=true ohne das
 * completedAt zu überschreiben oder den bonus nochmal zu zahlen.
 *
 * Bei first-time-completion + event.bonusReward > 0:
 *   1. Participant.completed=true gesetzt
 *   2. completedAt = now
 *   3. completedById = adminUserId (audit-trail)
 *   4. Wallet-credit über recordTransaction (REVENUE_PASSENGER mit
 *      category="event-bonus") an user's primary wallet
 *
 * Alle 4 schritte in einer prisma-transaction damit bei DB-error
 * nichts inkonsistent bleibt (z.B. flag gesetzt aber wallet nicht
 * gecredited).
 */
export async function markParticipantCompleted(input: {
  participantId: string;
  adminUserId: string;
}): Promise<MarkCompletedResult> {
  const participant = await prisma.eventParticipant.findUnique({
    where: { id: input.participantId },
    include: { event: true },
  });
  if (!participant) return { ok: false, reason: "participant-not-found" };
  if (participant.completed) {
    return { ok: true, wasAlreadyCompleted: true, participant };
  }

  const bonus = participant.event.bonusReward;
  const bonusNumber = Number(bonus);

  // Wir machen die transaction außerhalb von $transaction-callback
  // weil recordTransaction selbst ein wallet-write ist der seine
  // eigene transaction-semantik hat. Stattdessen serielle calls mit
  // bewusstem fail-mode: wenn wallet-credit fehlschlägt, ist der
  // completed-flag schon gesetzt — admin sieht das im UI als
  // "completed=ja, bonus=fehlgeschlagen" und kann manuell nachholen
  // (zukünftig: retry-button). Akzeptabel weil completed-flag der
  // user-facing primary-status ist.
  const updated = await prisma.eventParticipant.update({
    where: { id: input.participantId },
    data: {
      completed: true,
      completedAt: new Date(),
      completedById: input.adminUserId,
    },
  });

  if (bonusNumber > 0) {
    const wallet = await getOrCreateWallet({
      ownerType: "USER",
      ownerUserId: participant.userId,
      walletType: "primary",
    });
    await recordTransaction({
      walletId: wallet.id,
      amount: toDecimal(bonusNumber),
      type: "REVENUE_PASSENGER",
      category: "event-bonus",
      description: `Event-Bonus: ${participant.event.title}`,
      metadata: {
        eventId: participant.eventId,
        eventTitle: participant.event.title,
        eventSlug: participant.event.slug,
        eventKind: participant.event.kind,
      },
    });
  }

  return {
    ok: true,
    wasAlreadyCompleted: false,
    participant: updated,
    bonusCredited: bonusNumber,
  };
}

/**
 * Reverse von markParticipantCompleted: setzt completed=false zurück.
 * Wallet-bonus wird NICHT rückgebucht — der admin müsste das manuell
 * via wallet-adjustment machen wenn er den bonus auch zurücknehmen will.
 *
 * Use-case: admin hat versehentlich den falschen pilot completed —
 * unmark, dann den richtigen marken.
 */
export async function unmarkParticipantCompleted(
  participantId: string,
): Promise<{ ok: true; wasAlreadyAbsent: boolean }> {
  const participant = await prisma.eventParticipant.findUnique({
    where: { id: participantId },
  });
  if (!participant) return { ok: true, wasAlreadyAbsent: true };
  if (!participant.completed) return { ok: true, wasAlreadyAbsent: true };
  await prisma.eventParticipant.update({
    where: { id: participantId },
    data: {
      completed: false,
      completedAt: null,
      completedById: null,
    },
  });
  return { ok: true, wasAlreadyAbsent: false };
}
