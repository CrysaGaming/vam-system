/**
 * Track 5 #15 (Section C) — PIREP-Photo helpers.
 *
 * URL-based photo attachments an PIREPs. Kein file-upload, kein S3 —
 * author pastet eine direct-image-URL plus optional caption.
 *
 * # Public API
 *
 *   - listPhotosForPirep(pirepId) — chrono asc, mit author-info
 *   - getPhotoCount(pirepId) — für badges
 *   - createPhoto(authorId, pirepId, rawUrl, rawCaption)
 *   - deletePhoto(photoId, userId, options) — owner-or-admin
 *
 * # URL validation
 *
 *   - Muss https:// prefix haben
 *   - Max 1000 chars
 *   - Muss valid URL sein (new URL() throws sonst)
 *   - Keine host-whitelist V1 — wir vertrauen dem user (alle viewer
 *     sind auth'd airline-members oder owner; das ist kein anonymous
 *     posting). V2 könnte eine soft-whitelist als hint anzeigen.
 *
 * # Caption sanitization
 *
 *   Selber pattern wie comments/bio: trim, control-char-strip, collapse
 *   newlines. Empty-nach-sanitize wird zu null (= keine caption).
 *
 * # Per-PIREP limit
 *
 *   Hard-cap 12 photos pro PIREP (V1). Beim createPhoto check'n wir den
 *   count VOR insert. Race-condition: zwei posts gleichzeitig könnten
 *   theoretisch 13 erzeugen, V1 acceptable.
 */

import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

const MAX_URL_CHARS = 1000;
const MAX_CAPTION_CHARS = 500;
const MAX_PHOTOS_PER_PIREP = 12;

export class PhotoNotFoundError extends Error {
  constructor() {
    super("Foto nicht gefunden.");
    this.name = "PhotoNotFoundError";
  }
}

export class PhotoForbiddenError extends Error {
  constructor() {
    super("Du kannst dieses Foto nicht löschen.");
    this.name = "PhotoForbiddenError";
  }
}

export class PhotoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoUrlError";
  }
}

export class PhotoCaptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoCaptionError";
  }
}

export class PhotoLimitError extends Error {
  constructor() {
    super(
      `Maximal ${MAX_PHOTOS_PER_PIREP} Fotos pro PIREP — bitte lösche eins bevor du ein neues hochlädst.`,
    );
    this.name = "PhotoLimitError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Validation + sanitization
// ─────────────────────────────────────────────────────────────────────

/**
 * Validiert + normalisiert eine photo-URL. Returnt den cleanten URL-string
 * oder wirft PhotoUrlError.
 *
 *   1. Trim
 *   2. Length-check (max 1000 chars)
 *   3. URL-parse-check (new URL throws bei invalid)
 *   4. Protocol-check (muss https sein)
 */
function sanitizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    throw new PhotoUrlError("URL darf nicht leer sein.");
  }
  if (trimmed.length > MAX_URL_CHARS) {
    throw new PhotoUrlError(`URL darf max. ${MAX_URL_CHARS} zeichen lang sein.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PhotoUrlError("Keine gültige URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new PhotoUrlError("Nur https-URLs erlaubt (kein http, kein data:).");
  }
  return parsed.toString();
}

/**
 * Sanitisiert eine optional caption. Returnt null bei empty/null-input,
 * sonst den cleanten string. Wirft PhotoCaptionError bei too-long.
 *
 * Selber control-char-strip pattern wie comments/bio.
 */
function sanitizeCaption(rawCaption: string | null | undefined): string | null {
  if (rawCaption === null || rawCaption === undefined) return null;

  let cleaned = rawCaption.trim();
  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  if (cleaned.length === 0) return null;
  if (cleaned.length > MAX_CAPTION_CHARS) {
    throw new PhotoCaptionError(
      `Caption darf max. ${MAX_CAPTION_CHARS} zeichen lang sein.`,
    );
  }
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────
// Select-shapes (extended-prisma payload-inference workaround)
// ─────────────────────────────────────────────────────────────────────

const PHOTO_AUTHOR_SELECT = {
  id: true,
  name: true,
  image: true,
  isProfilePublic: true,
} satisfies Prisma.UserSelect;

const PHOTO_LIST_SELECT = {
  id: true,
  url: true,
  caption: true,
  createdAt: true,
  authorId: true,
  author: { select: PHOTO_AUTHOR_SELECT },
} satisfies Prisma.PirepPhotoSelect;

type PhotoAuthorRow = Prisma.UserGetPayload<{
  select: typeof PHOTO_AUTHOR_SELECT;
}>;

type PhotoListRow = Prisma.PirepPhotoGetPayload<{
  select: typeof PHOTO_LIST_SELECT;
}>;

export type PhotoEntry = {
  id: string;
  url: string;
  caption: string | null;
  createdAt: Date;
  authorId: string;
  author: {
    id: string;
    name: string | null;
    image: string | null;
    isProfilePublic: boolean;
  };
};

function entryFromRow(row: PhotoListRow): PhotoEntry {
  const a = row.author as PhotoAuthorRow;
  return {
    id: row.id,
    url: row.url,
    caption: row.caption,
    createdAt: row.createdAt,
    authorId: row.authorId,
    author: {
      id: a.id,
      name: a.name,
      image: a.image,
      isProfilePublic: a.isProfilePublic,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Read queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Listet alle photos eines PIREPs, ältester zuerst. Hits den
 * @@index([pirepId, createdAt]). Hard-cap auf MAX_PHOTOS_PER_PIREP+1
 * (defensive — sollte nie über 12 sein, aber wenn doch zeigen wir's).
 */
export async function listPhotosForPirep(
  pirepId: string,
): Promise<PhotoEntry[]> {
  const rowsRaw = await prisma.pirepPhoto.findMany({
    where: { pirepId },
    orderBy: { createdAt: "asc" },
    take: MAX_PHOTOS_PER_PIREP + 1,
    select: PHOTO_LIST_SELECT,
  });
  const rows = rowsRaw as unknown as PhotoListRow[];
  return rows.map(entryFromRow);
}

export async function getPhotoCount(pirepId: string): Promise<number> {
  return prisma.pirepPhoto.count({ where: { pirepId } });
}

// ─────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────

/**
 * Erstellt einen neuen photo-post.
 *
 * Throws:
 *   - PhotoUrlError bei invalid/empty/non-https URL
 *   - PhotoCaptionError bei caption too long
 *   - PhotoLimitError wenn schon 12 photos auf dem PIREP
 *   - Re-wirft prisma-errors (z.b. P2003 bei nonexistent pirepId)
 */
export async function createPhoto(
  authorId: string,
  pirepId: string,
  rawUrl: string,
  rawCaption: string | null,
): Promise<PhotoEntry> {
  const url = sanitizeUrl(rawUrl);
  const caption = sanitizeCaption(rawCaption);

  // Limit-check VOR insert. Race-condition möglich (2 inserts gleichzeitig
  // könnten 13 erzeugen) — V1 acceptable, V2 könnte unique constraint
  // auf (pirepId, sequence) machen.
  const current = await prisma.pirepPhoto.count({ where: { pirepId } });
  if (current >= MAX_PHOTOS_PER_PIREP) {
    throw new PhotoLimitError();
  }

  const createdRaw = await prisma.pirepPhoto.create({
    data: { authorId, pirepId, url, caption },
    select: PHOTO_LIST_SELECT,
  });
  const created = createdRaw as unknown as PhotoListRow;
  return entryFromRow(created);
}

/**
 * Löscht ein photo.
 *
 * Permissions:
 *   - Owner kann eigene photos löschen (immer)
 *   - canDeleteAny=true (admin/airline-admin context) kann beliebige löschen
 *
 * Throws:
 *   - PhotoNotFoundError
 *   - PhotoForbiddenError wenn weder owner noch canDeleteAny
 */
export async function deletePhoto(
  photoId: string,
  userId: string,
  options: { canDeleteAny?: boolean } = {},
): Promise<void> {
  const existing = await prisma.pirepPhoto.findUnique({
    where: { id: photoId },
    select: { authorId: true },
  });
  if (!existing) throw new PhotoNotFoundError();
  if (existing.authorId !== userId && !options.canDeleteAny) {
    throw new PhotoForbiddenError();
  }
  await prisma.pirepPhoto.delete({ where: { id: photoId } });
}

// Re-exports
export { MAX_URL_CHARS as PHOTO_MAX_URL_CHARS };
export { MAX_CAPTION_CHARS as PHOTO_MAX_CAPTION_CHARS };
export { MAX_PHOTOS_PER_PIREP };
