/**
 * Welle L / L5 — NOTAM status helper.
 *
 * Bestimmt aus den lifecycle-felder publishedAt/validFrom/validUntil/
 * cancelledAt den derived-status. Ein einzelnes status-field im model
 * würde redundant zu den timestamps sein und wäre out-of-sync-gefahr;
 * die derived-funktion ist stets konsistent.
 */

export type NotamStatus = 'Draft' | 'Pending' | 'Active' | 'Expired' | 'Cancelled';

export type NotamStatusInput = {
  publishedAt: Date | null;
  cancelledAt: Date | null;
  validFrom: Date;
  validUntil: Date | null;
};

export function deriveNotamStatus(n: NotamStatusInput, now = new Date()): NotamStatus {
  if (n.cancelledAt) return 'Cancelled';
  if (!n.publishedAt) return 'Draft';
  if (n.validFrom.getTime() > now.getTime()) return 'Pending';
  if (n.validUntil !== null && n.validUntil.getTime() <= now.getTime()) {
    return 'Expired';
  }
  return 'Active';
}
