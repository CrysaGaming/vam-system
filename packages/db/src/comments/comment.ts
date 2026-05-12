/**
 * Track 5 #14 (Section C) — PIREP-Comments helpers.
 *
 * Free-form discussion threads unter PIREPs. Komplementär zu:
 *   - PirepKudos (#60): boolean reaction, 1 per user/pirep
 *   - PirepAnnotation (#3): frame-bound feedback von approvers
 * Comments sind general-purpose, jeder logged-in pilot kann posten.
 *
 * # Public API
 *
 *   - listCommentsForPirep(pirepId) — chrono asc, mit author-display-info
 *   - createComment(authorId, pirepId, rawBody)
 *   - updateComment(commentId, userId, rawBody)
 *   - deleteComment(commentId, userId)
 *   - getCommentCount(pirepId) — für badge auf PIREP-listings
 *
 * # Constraints
 *
 *   - Body max 2000 chars (server-enforced, nicht im schema)
 *   - Body plaintext, sanitized (selber pattern wie User.bio)
 *   - Owner-edit-window: 15 min, dann locked (V2 admin-override)
 *
 * # Errors
 *
 *   - CommentNotFoundError
 *   - CommentForbiddenError (= nicht owner)
 *   - CommentEditWindowClosedError (= owner, aber >15 min alt)
 *   - CommentBodyError (= ungültiger body nach sanitize)
 */

import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

const MAX_BODY_CHARS = 2000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

export class CommentNotFoundError extends Error {
  constructor() {
    super("Kommentar nicht gefunden.");
    this.name = "CommentNotFoundError";
  }
}

export class CommentForbiddenError extends Error {
  constructor() {
    super("Du kannst diesen Kommentar nicht bearbeiten oder löschen.");
    this.name = "CommentForbiddenError";
  }
}

export class CommentEditWindowClosedError extends Error {
  constructor() {
    super("Edit-Zeitfenster (15 min) ist abgelaufen.");
    this.name = "CommentEditWindowClosedError";
  }
}

export class CommentBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentBodyError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Sanitization (selbes pattern wie User.bio in app/settings/actions.ts)
// ─────────────────────────────────────────────────────────────────────

/**
 * Sanitisiert + validiert einen raw-body string. Returnt den cleanten
 * string oder wirft CommentBodyError bei empty/too-long.
 *
 *   1. Trim
 *   2. \r\n → \n, \r → \n
 *   3. Strip control-chars ausser \n und \t
 *   4. Collapse 3+ newlines auf 2
 *   5. Validate: non-empty + max 2000 chars
 */
function sanitizeBody(rawBody: string): string {
  let cleaned = rawBody.trim();

  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  if (cleaned.length === 0) {
    throw new CommentBodyError("Kommentar darf nicht leer sein.");
  }
  if (cleaned.length > MAX_BODY_CHARS) {
    throw new CommentBodyError(
      `Kommentar darf max. ${MAX_BODY_CHARS} zeichen lang sein.`,
    );
  }
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────
// Select-shapes (extended-prisma select-payload-inference workaround,
// selber pattern wie users/public-profile.ts, follows/follow.ts, etc.)
// ─────────────────────────────────────────────────────────────────────

const COMMENT_AUTHOR_SELECT = {
  id: true,
  name: true,
  image: true,
  rank: { select: { name: true } },
  airline: { select: { icao: true } },
  isProfilePublic: true,
} satisfies Prisma.UserSelect;

const COMMENT_LIST_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  editedAt: true,
  authorId: true,
  author: { select: COMMENT_AUTHOR_SELECT },
} satisfies Prisma.PirepCommentSelect;

type CommentAuthorRow = Prisma.UserGetPayload<{
  select: typeof COMMENT_AUTHOR_SELECT;
}>;

type CommentListRow = Prisma.PirepCommentGetPayload<{
  select: typeof COMMENT_LIST_SELECT;
}>;

export type CommentEntry = {
  id: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  authorId: string;
  author: {
    id: string;
    name: string | null;
    image: string | null;
    rankName: string | null;
    airlineIcao: string | null;
    isProfilePublic: boolean;
  };
};

function entryFromRow(row: CommentListRow): CommentEntry {
  const a = row.author as CommentAuthorRow;
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    authorId: row.authorId,
    author: {
      id: a.id,
      name: a.name,
      image: a.image,
      rankName: a.rank?.name ?? null,
      airlineIcao: a.airline?.icao ?? null,
      isProfilePublic: a.isProfilePublic,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Read queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Returnt alle comments eines PIREPs, ältester zuerst (chrono für
 * thread-reading). Default-limit 200 — wenn ein PIREP mehr hat ist das
 * im V1 ein design-fail (kein "load more" V1, alles auf einmal).
 */
export async function listCommentsForPirep(
  pirepId: string,
  options: { limit?: number } = {},
): Promise<CommentEntry[]> {
  const limit = Math.min(options.limit ?? 200, 500);
  const rowsRaw = await prisma.pirepComment.findMany({
    where: { pirepId },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: COMMENT_LIST_SELECT,
  });
  const rows = rowsRaw as unknown as CommentListRow[];
  return rows.map(entryFromRow);
}

/**
 * Count-only query — für badges auf PIREP-listings. Hits den
 * @@index([pirepId, createdAt]) prefix, O(log n).
 */
export async function getCommentCount(pirepId: string): Promise<number> {
  return prisma.pirepComment.count({ where: { pirepId } });
}

// ─────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────

/**
 * Erstellt einen neuen comment auf einem PIREP.
 *
 * Throws:
 *   - CommentBodyError bei empty/too-long
 *   - Re-wirft prisma-errors (z.b. P2003 wenn pirepId nicht existiert
 *     — der caller sollte den PIREP vorher checken)
 */
export async function createComment(
  authorId: string,
  pirepId: string,
  rawBody: string,
): Promise<CommentEntry> {
  const body = sanitizeBody(rawBody);

  const createdRaw = await prisma.pirepComment.create({
    data: { authorId, pirepId, body },
    select: COMMENT_LIST_SELECT,
  });
  const created = createdRaw as unknown as CommentListRow;
  return entryFromRow(created);
}

/**
 * Updated einen comment. Owner-only, 15-min edit-window.
 *
 * Throws:
 *   - CommentNotFoundError
 *   - CommentForbiddenError (nicht owner)
 *   - CommentEditWindowClosedError (owner aber zu alt)
 *   - CommentBodyError (ungültiger body)
 */
export async function updateComment(
  commentId: string,
  userId: string,
  rawBody: string,
): Promise<CommentEntry> {
  const body = sanitizeBody(rawBody);

  const existing = await prisma.pirepComment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, createdAt: true },
  });
  if (!existing) throw new CommentNotFoundError();
  if (existing.authorId !== userId) throw new CommentForbiddenError();

  const age = Date.now() - existing.createdAt.getTime();
  if (age > EDIT_WINDOW_MS) {
    throw new CommentEditWindowClosedError();
  }

  const updatedRaw = await prisma.pirepComment.update({
    where: { id: commentId },
    data: { body, editedAt: new Date() },
    select: COMMENT_LIST_SELECT,
  });
  const updated = updatedRaw as unknown as CommentListRow;
  return entryFromRow(updated);
}

/**
 * Löscht einen comment. Owner-only im V1 (V2: admin-override).
 *
 * KEIN edit-window-check beim delete — owner kann immer löschen.
 * Begründung: edit-window soll "hot-fix typos kurz nach posten"
 * ermöglichen, aber delete ist ein "ich will das nicht mehr da haben"
 * recht das nicht zeitlich beschränkt sein sollte.
 */
export async function deleteComment(
  commentId: string,
  userId: string,
): Promise<void> {
  const existing = await prisma.pirepComment.findUnique({
    where: { id: commentId },
    select: { authorId: true },
  });
  if (!existing) throw new CommentNotFoundError();
  if (existing.authorId !== userId) throw new CommentForbiddenError();

  await prisma.pirepComment.delete({ where: { id: commentId } });
}

// Re-exports
export { MAX_BODY_CHARS as COMMENT_MAX_BODY_CHARS };
export { EDIT_WINDOW_MS as COMMENT_EDIT_WINDOW_MS };
