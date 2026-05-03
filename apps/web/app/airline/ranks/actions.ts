'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Rank-Management server-actions (Welle 6 commit 6B-1).
 *
 * Ranks sind airline-spezifisch (jede airline definiert ihre eigene
 * hierarchie) und haben einen `minFlightHours`-threshold der den
 * auto-promotion-trigger steuert (welle 6B-3 hooks das in
 * pireps/actions.ts approvePirep). Der `order`-int legt die hierarchie
 * fest — höhere order = höherer rank (Cadet=0, Captain=99).
 *
 * Mirror der policy aus airline/actions.ts:
 * - AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor)
 * - requireAirlineAdmin() guard
 * - Multi-tenant gates: airline-id-check vor jeder mutation
 *
 * Out-of-scope für 6B-1:
 * - Auto-promotion-logic → 6B-3
 * - Bulk-reorder via drag-drop → wenn user-feedback kommt
 * - Rank-history-tracking (welcher pilot wurde wann promoted) → später
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

// ─────────────────────────────────────────────────────────────────────────
// List ranks (mit user-counts)
// ─────────────────────────────────────────────────────────────────────────

export type RankWithStats = {
  id: string;
  name: string;
  minFlightHours: number;
  order: number;
  userCount: number;
  createdAt: Date;
};

/**
 * Listet alle ranks der eigenen airline mit per-rank user-count
 * (= wie viele piloten aktuell diesen rank haben). Sortiert nach
 * order absc — niedrigster rank zuerst.
 *
 * Used by /airline/ranks page für die haupt-tabelle.
 */
export async function listRanksWithStats(): Promise<RankWithStats[]> {
  const { airlineId } = await requireAirlineAdmin();

  const ranks = await prisma.rank.findMany({
    where: { airlineId },
    include: { _count: { select: { users: true } } },
    orderBy: { order: 'asc' },
  });

  return ranks.map((r) => ({
    id: r.id,
    name: r.name,
    minFlightHours: r.minFlightHours,
    order: r.order,
    userCount: r._count.users,
    createdAt: r.createdAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Create rank
// ─────────────────────────────────────────────────────────────────────────

const RankInputSchema = z.object({
  // Name muss innerhalb der airline einmalig sein. 1-50 chars cover alle
  // realistischen rank-namen (Cadet, First Officer, Senior Captain,
  // Type Rating Examiner, etc.).
  name: z
    .string()
    .min(1, 'Name erforderlich')
    .max(50, 'Name zu lang (max 50 Zeichen)'),
  // minFlightHours float — kann auch 0.5 oder 12.5 sein wenn airline das
  // will. Default 0 für entry-rank. Realistisch: 0, 50, 250, 500, 1500,
  // 3000 für eine typische 6-stufen-hierarchie.
  minFlightHours: z.coerce
    .number()
    .min(0, 'minFlightHours kann nicht negativ sein')
    .max(50000, 'unrealistisch hoch (max 50000)'),
  // Order: 0 = niedrigster rank (zeigt OBEN in der liste, weil neue piloten
  // dort starten), höher = höher in der hierarchie. Realistisch 0-999.
  // Schema hat keinen unique-constraint auf [airlineId, order] weil das zu
  // restriktiv wäre (admin will manchmal zwei ranks mit derselben order
  // temporär haben während er reorganisiert). UI zeigt aber warning bei
  // duplikaten.
  order: z.coerce
    .number()
    .int()
    .min(0, 'Order muss >= 0 sein')
    .max(999, 'Order zu hoch (max 999)'),
});

export type RankFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export async function createRank(
  _prev: RankFormState | null,
  formData: FormData,
): Promise<RankFormState> {
  const { airlineId } = await requireAirlineAdmin();

  const raw = {
    name: String(formData.get('name') ?? '').trim(),
    minFlightHours: formData.get('minFlightHours') || '0',
    order: formData.get('order') || '0',
  };

  const parsed = RankInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      ok: false,
      message: 'Bitte korrigiere die markierten felder.',
      fieldErrors,
    };
  }

  // Unique-constraint check — DB-constraint @@unique([airlineId, name])
  // würde es eh fangen, aber generic prisma-error ist schwer für UI.
  const existing = await prisma.rank.findUnique({
    where: { airlineId_name: { airlineId, name: parsed.data.name } },
  });
  if (existing) {
    return {
      ok: false,
      message: `Rang "${parsed.data.name}" existiert bereits in deiner Airline.`,
      fieldErrors: { name: 'Bereits vergeben' },
    };
  }

  await prisma.rank.create({
    data: {
      airlineId,
      name: parsed.data.name,
      minFlightHours: parsed.data.minFlightHours,
      order: parsed.data.order,
    },
  });

  revalidatePath('/airline/ranks');
  revalidatePath('/airline'); // member-table zeigt ranks
  revalidatePath('/pilots'); // pilot-listing zeigt ranks

  return { ok: true, message: `Rang "${parsed.data.name}" angelegt.` };
}

// ─────────────────────────────────────────────────────────────────────────
// Update rank
// ─────────────────────────────────────────────────────────────────────────

export async function updateRank(
  rankId: string,
  _prev: RankFormState | null,
  formData: FormData,
): Promise<RankFormState> {
  const { airlineId } = await requireAirlineAdmin();

  // Ownership-check zuerst — rank muss zur airline des admins gehören.
  const existing = await prisma.rank.findUnique({
    where: { id: rankId },
  });
  if (!existing || existing.airlineId !== airlineId) {
    return { ok: false, message: 'Dieser Rang gehört nicht zu deiner Airline.' };
  }

  const raw = {
    name: String(formData.get('name') ?? '').trim(),
    minFlightHours: formData.get('minFlightHours') || '0',
    order: formData.get('order') || '0',
  };

  const parsed = RankInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      ok: false,
      message: 'Bitte korrigiere die markierten felder.',
      fieldErrors,
    };
  }

  // Wenn der name geändert wurde, unique-check gegen neuen namen.
  if (parsed.data.name !== existing.name) {
    const conflict = await prisma.rank.findUnique({
      where: { airlineId_name: { airlineId, name: parsed.data.name } },
    });
    if (conflict) {
      return {
        ok: false,
        message: `Rang "${parsed.data.name}" existiert bereits.`,
        fieldErrors: { name: 'Bereits vergeben' },
      };
    }
  }

  await prisma.rank.update({
    where: { id: rankId },
    data: {
      name: parsed.data.name,
      minFlightHours: parsed.data.minFlightHours,
      order: parsed.data.order,
    },
  });

  revalidatePath('/airline/ranks');
  revalidatePath('/airline');
  revalidatePath('/pilots');

  return { ok: true, message: `Rang "${parsed.data.name}" aktualisiert.` };
}

// ─────────────────────────────────────────────────────────────────────────
// Delete rank
// ─────────────────────────────────────────────────────────────────────────

/**
 * Löscht einen rank wenn KEINE piloten ihn aktuell zugeordnet haben.
 * Wenn piloten den rank haben, refuse mit hinweis "Erst piloten umranggen".
 *
 * Alternative wäre cascade-on-delete mit auto-reassignment auf nächst-
 * niedrigeren rank, aber das ist riskant — admin könnte versehentlich
 * 50 Captains auf "Cadet" zurückstufen. Besser: explizit fehlschlagen
 * und admin muss den rank vorher freiräumen.
 *
 * DiscordRoleMapping referenzen werden NICHT geblockt — die werden via
 * onDelete: SetNull (oder Restrict?) am schema gehandhabt. Ich check
 * das mal:
 *
 * → DiscordRoleMapping hat rankId optional + airlineId, das schema
 * legt den onDelete-Verhalten fest. Wir lassen die DB das machen.
 */
const DeleteRankSchema = z.object({
  rankId: z.string().min(1),
});

export async function deleteRank(
  formData: FormData,
): Promise<RankFormState> {
  const { airlineId } = await requireAirlineAdmin();

  const parsed = DeleteRankSchema.safeParse({
    rankId: String(formData.get('rankId') ?? ''),
  });
  if (!parsed.success) {
    return { ok: false, message: 'Ungültige Eingabe' };
  }

  const rank = await prisma.rank.findUnique({
    where: { id: parsed.data.rankId },
    include: { _count: { select: { users: true } } },
  });

  if (!rank || rank.airlineId !== airlineId) {
    return { ok: false, message: 'Rang nicht gefunden.' };
  }

  if (rank._count.users > 0) {
    return {
      ok: false,
      message: `${rank._count.users} ${rank._count.users === 1 ? 'Pilot hat' : 'Piloten haben'} aktuell den Rang "${rank.name}". Bitte erst diese piloten auf einen anderen rang setzen, dann löschen.`,
    };
  }

  await prisma.rank.delete({ where: { id: rank.id } });

  revalidatePath('/airline/ranks');
  revalidatePath('/airline');
  revalidatePath('/pilots');

  return { ok: true, message: `Rang "${rank.name}" gelöscht.` };
}
