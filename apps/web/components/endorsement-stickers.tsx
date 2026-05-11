import type { LicenseType, LicenseStatus } from '@vam/db';
import { licenseDisplayName } from '@vam/db';

/**
 * Track 4 #92 (Section R) — Endorsement-Stickers.
 *
 * Visuelle badge-collection die pilot-achievements zeigt: licenses,
 * type-ratings, hour-milestones, pirep-count-milestones. Pure-render
 * component — keine eigenen queries, alle daten kommen vom parent
 * (der die unterlying data eh schon lädt für skill-tree / pilot-detail).
 *
 * Visuell als compact-grid-badges (~120-140px) mit:
 *   - kategorie-icon
 *   - haupt-label (z.B. "ATPL", "A320", "1000h", "100 Flights")
 *   - sub-label (kategorie oder kontext)
 *   - color-coding pro kategorie (sky=license, emerald=type-rating,
 *     amber=hours, purple=pireps)
 *   - tooltip mit details (kategorie + erwerbsdatum / threshold)
 *
 * Wo es eingesetzt wird:
 *   - /airline/pilots/[id]/skill-tree (top section)
 *   - /airline/pilots/[id] (admin view, top section)
 *
 * Difference zu Skill-Tree: Skill-Tree zeigt prereq-hierarchy mit
 * locked-status ("noch nicht erreicht"). Stickers feiern was DA ist —
 * keine locked-items, keine prereqs, nur achievement-collection.
 *
 * Out-of-scope für v1:
 *   - Special-stickers (längster flug, exotischste destination, etc.)
 *   - Custom-airline-stickers (admin-defined awards)
 *   - Animation/sparkle effects
 *   - Click → drill-down zu detail-page
 */

// ─────────────────────────────────────────────────────────────────────────
// Sticker-definitions
// ─────────────────────────────────────────────────────────────────────────

/**
 * Hour-milestones für sticker-vergabe. Werte gewählt nach üblichen
 * aviation-thresholds. Bewusst weniger granular als HOUR_MILESTONES in
 * skill-tree (das zeigt jeden step), hier nur die "großen" achievements
 * damit die sticker-collection nicht überfüllt wirkt.
 */
const HOUR_STICKERS: { hours: number; emoji: string; label: string }[] = [
  { hours: 100, emoji: '🛫', label: 'First 100' },
  { hours: 500, emoji: '🥉', label: '500 Hours' },
  { hours: 1000, emoji: '🥇', label: 'Veteran' },
  { hours: 1500, emoji: '💎', label: 'ATPL-Eligible' },
  { hours: 5000, emoji: '👑', label: 'Captain-Tier' },
  { hours: 10000, emoji: '⭐', label: 'Legend' },
];

const PIREP_STICKERS: { count: number; emoji: string; label: string }[] = [
  { count: 10, emoji: '📋', label: 'First 10' },
  { count: 50, emoji: '📊', label: '50 Flights' },
  { count: 100, emoji: '💯', label: 'Century' },
  { count: 500, emoji: '🏆', label: '500 Flights' },
  { count: 1000, emoji: '🎖️', label: 'Veteran' },
];

const LICENSE_ICONS: Record<LicenseType, string> = {
  SPL: '🎓',
  PPL: '🛩️',
  NIGHT_RATING: '🌙',
  INSTRUMENT_RATING: '📡',
  MULTI_ENGINE_RATING: '✈️',
  CPL: '💼',
  MCC: '👥',
  ATPL: '✈️',
  TRI: '👨‍🏫',
  TRE: '🎯',
};

// ─────────────────────────────────────────────────────────────────────────
// Component props
// ─────────────────────────────────────────────────────────────────────────

export interface EndorsementStickersProps {
  licenses: Array<{
    type: LicenseType;
    status: LicenseStatus;
    issuedAt: Date;
  }>;
  typeRatings: Array<{
    aircraftType: string;
    obtainedAt: Date;
    expiresAt: Date | null;
  }>;
  totalFlightHours: number;
  totalFlights: number;
  /** Compact-mode: kleinere stickers (für inline-display in profile-headern) */
  compact?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Sticker types (intern)
// ─────────────────────────────────────────────────────────────────────────

interface Sticker {
  /** Unique key für React */
  key: string;
  /** Display-icon (emoji oder svg-character) */
  icon: string;
  /** Haupt-label (1-2 wörter) */
  label: string;
  /** Sub-label (z.B. "License" / "Type-Rating" / "Hours") */
  sublabel: string;
  /** Tooltip-text */
  title: string;
  /** Tailwind-classes für styling (background, border, text) */
  className: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────

export function EndorsementStickers({
  licenses,
  typeRatings,
  totalFlightHours,
  totalFlights,
  compact = false,
}: EndorsementStickersProps) {
  const stickers = buildStickers({
    licenses,
    typeRatings,
    totalFlightHours,
    totalFlights,
  });

  if (stickers.length === 0) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-500 italic">
        Noch keine Endorsements verdient. Lizenzen, Type-Ratings und
        Flugstunden werden hier als Achievement-Sticker angezeigt.
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap ${compact ? 'gap-1.5' : 'gap-2'}`}
      role="list"
      aria-label="Endorsement-Stickers"
    >
      {stickers.map((s) => (
        <div
          key={s.key}
          role="listitem"
          title={s.title}
          className={`${compact ? 'px-2 py-1' : 'px-3 py-1.5'} rounded-full border ${s.className} flex items-center gap-1.5 ${compact ? 'text-xs' : 'text-sm'} font-medium`}
        >
          <span aria-hidden="true" className={compact ? 'text-sm' : 'text-base'}>
            {s.icon}
          </span>
          <span className="font-mono font-bold">{s.label}</span>
          {!compact && (
            <span className="text-[10px] uppercase tracking-wide opacity-60 ml-1">
              {s.sublabel}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sticker-building logic (pure function — testable)
// ─────────────────────────────────────────────────────────────────────────

function buildStickers(props: Omit<EndorsementStickersProps, 'compact'>): Sticker[] {
  const stickers: Sticker[] = [];
  const todayMs = Date.now();

  // ── License-stickers (sky-blue) ─────────────────────────────────────
  // Nur ACTIVE licenses kriegen einen sticker. EXPIRED/SUSPENDED/REVOKED
  // zeigen wir hier NICHT — das wäre semantisch eine warnung, kein
  // achievement. Skill-tree ist der ort wo expired-status sichtbar wird.
  for (const lic of props.licenses) {
    if (lic.status !== 'ACTIVE') continue;
    stickers.push({
      key: `lic-${lic.type}`,
      icon: LICENSE_ICONS[lic.type] ?? '📜',
      label: licenseDisplayName(lic.type),
      sublabel: 'License',
      title: `${licenseDisplayName(lic.type)} — ausgestellt am ${lic.issuedAt.toLocaleDateString('de-DE')}`,
      className:
        'bg-sky-50 dark:bg-sky-500/15 border-sky-300 dark:border-sky-500/40 text-sky-900 dark:text-sky-200',
    });
  }

  // ── Type-Rating-stickers (emerald) ──────────────────────────────────
  // Nur gültige (nicht-expired) ratings. Expired ratings sind im skill-
  // tree side-panel sichtbar mit amber-style; hier feiern wir die
  // current qualifications.
  for (const tr of props.typeRatings) {
    if (tr.expiresAt && tr.expiresAt.getTime() <= todayMs) continue;
    stickers.push({
      key: `tr-${tr.aircraftType}`,
      icon: '🛬',
      label: tr.aircraftType,
      sublabel: 'Type-Rating',
      title: `Type-Rating ${tr.aircraftType} — erworben am ${tr.obtainedAt.toLocaleDateString('de-DE')}${tr.expiresAt ? `, gültig bis ${tr.expiresAt.toLocaleDateString('de-DE')}` : ''}`,
      className:
        'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-900 dark:text-emerald-200',
    });
  }

  // ── Hour-milestone-stickers (amber) ─────────────────────────────────
  // Nur der HÖCHSTE erreichte hour-meilenstein als sticker — sonst hat
  // ein 5000h-pilot 5 redundante stickers (100/500/1000/1500/5000).
  // Top-meilenstein ist der relevanteste, und admin sieht im skill-tree
  // den vollen progression-pfad.
  let highestHourSticker: typeof HOUR_STICKERS[number] | null = null;
  for (const ms of HOUR_STICKERS) {
    if (props.totalFlightHours >= ms.hours) {
      highestHourSticker = ms;
    }
  }
  if (highestHourSticker) {
    stickers.push({
      key: `hours-${highestHourSticker.hours}`,
      icon: highestHourSticker.emoji,
      label: `${highestHourSticker.hours.toLocaleString('de-DE')}h`,
      sublabel: highestHourSticker.label,
      title: `${highestHourSticker.hours.toLocaleString('de-DE')} Flugstunden erreicht — aktuell ${props.totalFlightHours.toFixed(1)} h`,
      className:
        'bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200',
    });
  }

  // ── PIREP-count-stickers (purple) ───────────────────────────────────
  // Selbe logik wie hours: nur der höchste milestone.
  let highestPirepSticker: typeof PIREP_STICKERS[number] | null = null;
  for (const ms of PIREP_STICKERS) {
    if (props.totalFlights >= ms.count) {
      highestPirepSticker = ms;
    }
  }
  if (highestPirepSticker) {
    stickers.push({
      key: `pireps-${highestPirepSticker.count}`,
      icon: highestPirepSticker.emoji,
      label: `${highestPirepSticker.count.toLocaleString('de-DE')}`,
      sublabel: highestPirepSticker.label,
      title: `${highestPirepSticker.count.toLocaleString('de-DE')} Flüge erreicht — aktuell ${props.totalFlights} approved PIREPs`,
      className:
        'bg-purple-50 dark:bg-purple-500/15 border-purple-300 dark:border-purple-500/40 text-purple-900 dark:text-purple-200',
    });
  }

  return stickers;
}
