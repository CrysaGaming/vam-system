/**
 * Welle F / F5 — Multi-base helpers.
 *
 * Pilots können mehrere "bases" haben aus denen sie operieren:
 *   - baseIcao         — primary base (existing, Welle 4)
 *   - secondaryBaseIcaos[] — additional bases (Welle F / F5)
 *
 * Use-case: pilot wohnt in EDDF aber pendelt regelmäßig nach EDDM. Ohne
 * multi-base müsste jeder EDDM-flight als ferry/positioning verkauft
 * werden. Mit multi-base sind direct-flights aus EDDM ohne ferry-
 * voraussetzung möglich.
 *
 * Dieser modul kapselt die "wo darf der pilot starten?"-frage in einer
 * single source of truth damit booking-eligibility-checks, route-
 * suggestions und admin-displays alle dieselbe konsistente antwort
 * geben.
 *
 * # Why not a separate PilotSecondaryBase model?
 *
 * Secondary-bases sind eine kleine whitelist (typisch 0-3 entries per
 * pilot), mutieren selten (admin-action oder pilot-settings-update),
 * und brauchen keine eigenen attributen (date-added, reason, etc.).
 * postgres String[]-column ist ausreichend und vermeidet eine join-
 * table die einfache reads (lese alle bases eines piloten) zu einem
 * 2-step process machen würde.
 *
 * Wenn später attribute pro secondary-base nötig werden (z.B. "valid
 * until", "reason: temporary assignment"), wird auf eine join-table
 * migriert — dann mit data-migration aus dem String[].
 *
 * # Validation
 *
 * Diese helpers vertrauen ihren inputs. Validation (ICAOs müssen
 * matching airline.hubs entries sein, primary darf nicht in secondary
 * sein, etc.) gehört in die server-action die das User.secondaryBaseIcaos
 * setzt — siehe apps/web/app/settings/actions.ts updateSecondaryBases.
 */

export interface UserWithBases {
  baseIcao: string | null;
  secondaryBaseIcaos: string[];
}

/**
 * Returns all base-ICAOs für einen pilot, primary first dann secondary.
 * Deduped (falls primary versehentlich in secondary auch drin ist) und
 * filtered for null/empty.
 *
 * @example
 *   getAllBaseIcaos({ baseIcao: 'EDDF', secondaryBaseIcaos: ['EDDM', 'EDDL'] })
 *   // → ['EDDF', 'EDDM', 'EDDL']
 *
 *   getAllBaseIcaos({ baseIcao: null, secondaryBaseIcaos: [] })
 *   // → []
 *
 *   getAllBaseIcaos({ baseIcao: 'EDDF', secondaryBaseIcaos: ['EDDF', 'EDDM'] })
 *   // → ['EDDF', 'EDDM']   (dedupe)
 */
export function getAllBaseIcaos(user: UserWithBases): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  if (user.baseIcao) {
    seen.add(user.baseIcao);
    result.push(user.baseIcao);
  }

  for (const icao of user.secondaryBaseIcaos) {
    if (icao && !seen.has(icao)) {
      seen.add(icao);
      result.push(icao);
    }
  }

  return result;
}

/**
 * Returns true wenn der currentIcao zu einer der bases des piloten passt.
 * Convenience für booking-eligibility + display "at home"-badges.
 *
 * @example
 *   isAtAnyBase('EDDF', { baseIcao: 'EDDF', secondaryBaseIcaos: ['EDDM'] })
 *   // → true (matches primary)
 *
 *   isAtAnyBase('EDDM', { baseIcao: 'EDDF', secondaryBaseIcaos: ['EDDM'] })
 *   // → true (matches secondary)
 *
 *   isAtAnyBase('EDDH', { baseIcao: 'EDDF', secondaryBaseIcaos: ['EDDM'] })
 *   // → false
 *
 *   isAtAnyBase(null, { baseIcao: 'EDDF', secondaryBaseIcaos: [] })
 *   // → false (no current position to compare)
 */
export function isAtAnyBase(
  currentIcao: string | null | undefined,
  user: UserWithBases,
): boolean {
  if (!currentIcao) return false;
  if (user.baseIcao === currentIcao) return true;
  return user.secondaryBaseIcaos.includes(currentIcao);
}

/**
 * Returns true wenn `icao` als secondary-base hinzugefügt werden darf
 * (= valid hub-ICAO der airline UND nicht bereits in der liste UND
 * nicht der primary-base). Wird von der server-action benutzt um
 * malformed input abzulehnen.
 *
 * Argumentation: primary-base ist semantisch "der base" — den als
 * secondary doppelt zu listen ist redundant. UI sollte den primary in
 * der select-liste eh disabled rendern, aber server-side enforcement
 * verhindert dass clients via direct-API call den state korrupten.
 */
export function canAddSecondaryBase(
  icao: string,
  availableHubIcaos: ReadonlyArray<string>,
  user: UserWithBases,
): boolean {
  if (!availableHubIcaos.includes(icao)) return false;
  if (user.baseIcao === icao) return false;
  if (user.secondaryBaseIcaos.includes(icao)) return false;
  return true;
}
