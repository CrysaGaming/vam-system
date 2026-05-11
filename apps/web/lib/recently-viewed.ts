/**
 * Track 4 #71 (Section N) — Recently-Viewed: localStorage-helpers
 *
 * Speichert die letzten ~10 detail-pages die der pilot besucht hat. Wird
 * in zwei zonen konsumiert:
 *
 *   1. RecentlyViewedBlock — sidebar-section "Kürzlich" mit den 5
 *      neuesten items als quick-reaccess-links.
 *   2. (potential) Command-Palette — als "Recent items"-section.
 *
 * # Storage-format
 *
 * Plain JSON-array unter dem key 'vam:recently-viewed'. Schema-versionierung
 * über das `v`-feld am wrapper-objekt:
 *
 *   { v: 1, items: RecentItem[] }
 *
 * Wenn `v` nicht 1 ist (oder das parsing schiefgeht), wird der storage-
 * eintrag als kaputt behandelt und discarded. Beim nächsten append wird
 * frisch geschrieben. Damit können wir später das schema brechen ohne
 * crashes bei alten clients.
 *
 * # Reihenfolge + dedup
 *
 * Append-pattern: neu reingekommenes item ist immer ganz vorne. Wenn die
 * id+type-kombination schon existiert, wird das alte vorkommen entfernt
 * und das neue an position 0 geschoben (LRU-stil). MAX_ITEMS=10 begrenzt
 * die liste; ältere werden hinten abgeschnitten.
 *
 * # Cross-tab + concurrent writes
 *
 * Bewusst KEIN cross-tab-sync via storage-event listener (würde unnötig
 * komplex sein für so eine nebensächlichkeit). Wenn der pilot in tab A
 * eine booking ansieht und tab B die liste rendert, sieht tab B die
 * änderung erst beim nächsten read (z.B. page-reload). Last-write-wins
 * bei concurrent writes — acceptable für ein UX-convenience-feature.
 *
 * # SSR-safety
 *
 * Alle funktionen sind no-ops auf dem server (typeof window check).
 * Render-pattern in den consumer-components: useState + useEffect mit
 * mounted-flag → erster render zeigt nichts, zweiter render zeigt
 * die items. Verhindert hydration-mismatch.
 */

/** Maximum anzahl items im storage. Älteste werden bei überlauf gedroppt. */
const MAX_ITEMS = 10;

/** localStorage-key. Versionierte struktur unter dem `v`-feld. */
const STORAGE_KEY = 'vam:recently-viewed';

/** Current schema-version. Bei breaking-changes hochzählen. */
const SCHEMA_VERSION = 1;

export type RecentItemType = 'booking' | 'pirep' | 'route' | 'pilot' | 'airport';

export interface RecentItem {
  /** Stable item-id (route-id, booking-id, etc.) */
  id: string;
  /** Type-discriminator for icon + grouping */
  type: RecentItemType;
  /** Display-label, e.g. "LH401 EDDF→EGLL" oder "PIREP NGN902" */
  label: string;
  /** Optional sub-label (z.B. "13.05.2026, 14:30") */
  subLabel?: string;
  /** Navigation-target (relative path) */
  href: string;
  /** Unix-millis wann zuletzt besucht. Für sortierung + display "vor X min". */
  viewedAt: number;
}

interface StoragePayload {
  v: number;
  items: RecentItem[];
}

/**
 * Liest die items aus dem localStorage. Bei parsing-fehlern oder
 * schema-mismatch returns []. SSR-safe (returns [] auf dem server).
 *
 * Filtert defensive auch fehlende/ungültige felder raus — wenn ein
 * legacy-eintrag z.B. ohne `type` rumliegt, ignorieren wir ihn statt
 * zu crashen.
 */
export function getRecentItems(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('v' in parsed) ||
      !('items' in parsed)
    ) {
      return [];
    }
    const payload = parsed as Partial<StoragePayload>;
    if (payload.v !== SCHEMA_VERSION || !Array.isArray(payload.items)) {
      return [];
    }
    // Defensive validation: filter raus was nicht alle required-felder hat.
    return payload.items.filter(
      (it): it is RecentItem =>
        typeof it === 'object' &&
        it !== null &&
        typeof (it as RecentItem).id === 'string' &&
        typeof (it as RecentItem).type === 'string' &&
        typeof (it as RecentItem).label === 'string' &&
        typeof (it as RecentItem).href === 'string' &&
        typeof (it as RecentItem).viewedAt === 'number',
    );
  } catch {
    // Quota-exceeded, JSON-parse-fail, serialization-error — alles akzeptabel
    // weil das feature optional ist. Silently no-op.
    return [];
  }
}

/**
 * Append ein neues item. Wenn id+type schon existiert, wird der alte
 * eintrag entfernt und das neue an position 0 gesetzt (LRU). Liste
 * wird auf MAX_ITEMS gekürzt.
 *
 * No-op auf dem server. No-op bei storage-fehlern (quota, write-block).
 */
export function appendRecentItem(item: Omit<RecentItem, 'viewedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getRecentItems();
    // Dedup: gleiche id+type → alten eintrag entfernen.
    const dedupped = existing.filter(
      (it) => !(it.id === item.id && it.type === item.type),
    );
    // Neu an position 0, gekürzt auf MAX_ITEMS.
    const updated: RecentItem[] = [
      { ...item, viewedAt: Date.now() },
      ...dedupped,
    ].slice(0, MAX_ITEMS);
    const payload: StoragePayload = { v: SCHEMA_VERSION, items: updated };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    // Custom-event so SAME-tab consumers re-rendern wenn ein neues item
    // appended wird. storage-events feuern nur cross-tab — innerhalb des
    // selben tabs muss man manuell broadcasten.
    window.dispatchEvent(new CustomEvent('vam:recently-viewed-updated'));
  } catch {
    // Quota-exceeded etc. — kein crash, kein log, einfach skippen.
  }
}

/**
 * Hilfs-format: "vor X min" / "vor X h" / "gestern". Für sub-label
 * im sidebar-block.
 *
 * Wir formattieren bewusst MINIMAL — der nutzer braucht keinen absoluten
 * timestamp im sidebar-quick-block (er kann auf den item klicken um
 * details zu sehen).
 */
export function formatRelativeTime(viewedAt: number, now: number = Date.now()): string {
  const diffMs = now - viewedAt;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 30) return 'gerade eben';
  if (diffMin < 1) return 'vor wenigen Sekunden';
  if (diffMin < 60) return `vor ${diffMin} min`;
  if (diffHour < 24) return `vor ${diffHour} h`;
  if (diffDay === 1) return 'gestern';
  if (diffDay < 7) return `vor ${diffDay} Tagen`;
  return `vor ${Math.floor(diffDay / 7)} Wochen`;
}

/**
 * Icon-glyph für einen type. Reused in sidebar-block + ggf. command-palette.
 * Sollte mit der CommandPalette-icon-convention konsistent bleiben.
 */
export function recentItemTypeIcon(type: RecentItemType): string {
  switch (type) {
    case 'booking':
      return '📋';
    case 'pirep':
      return '✈️';
    case 'route':
      return '🛫';
    case 'pilot':
      return '👤';
    case 'airport':
      return '🏢';
  }
}
