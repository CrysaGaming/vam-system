import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Track 4 #52 (Section J) — Reusable Empty-State component.
 *
 * Vorher: jede listing-page hat ihren eigenen empty-state inline gebaut
 * (irgendein div mit "Keine X gefunden"-text). Inkonsistent in spacing,
 * icon-presence, und CTA-styling. Diese reusable component vereinheitlicht
 * das pattern.
 *
 * # Variants
 *
 *   - `default` — neutral grau, für "noch nichts da" cases
 *   - `info` — leicht blue-tinted, für search-no-results cases
 *
 * # Slots
 *
 *   - `icon` — string (emoji) oder ReactNode. Optional, default 📭.
 *   - `title` — pflicht, zentriert in mid-grey
 *   - `description` — optional, längerer subtext
 *   - `primaryAction` / `secondaryAction` — optional CTA-buttons mit
 *     {label, href} oder {label, onClick}
 *
 * # Beispiele
 *
 * ```tsx
 * // No-results-after-search
 * <EmptyState
 *   variant="info"
 *   icon="🔍"
 *   title={`Keine Airlines mit "${query}" gefunden`}
 *   description="Versuch's mit anderen Suchbegriffen oder ICAO-Codes."
 * />
 *
 * // Empty-list mit primary-CTA
 * <EmptyState
 *   icon="📋"
 *   title="Du hast noch keine Bookings"
 *   description="Erstelle eine Buchung um einen flight zu reservieren."
 *   primaryAction={{ label: 'Neue Buchung', href: '/bookings/new' }}
 * />
 * ```
 *
 * # Why server-component
 *
 * Reines layout, keine state. Wenn ein consumer interactive actions
 * braucht (onClick), kann der die action mit `'use client'`-wrapper
 * übergeben — die component selber bleibt server-friendly.
 */

type ActionLink = { label: string; href: string; onClick?: never };
type ActionButton = { label: string; onClick: () => void; href?: never };
type EmptyStateAction = ActionLink | ActionButton;

interface EmptyStateProps {
  variant?: 'default' | 'info';
  icon?: React.ReactNode;
  title: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  variant = 'default',
  icon = '📭',
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  const variantBg =
    variant === 'info'
      ? 'bg-blue-50/30 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/30'
      : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-12 rounded-lg border border-dashed',
        variantBg,
        className,
      )}
    >
      <div className="text-5xl mb-4" aria-hidden="true">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6">
          {description}
        </p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="flex gap-2 mt-2">
          {primaryAction && <EmptyStateActionEl action={primaryAction} primary />}
          {secondaryAction && <EmptyStateActionEl action={secondaryAction} />}
        </div>
      )}
    </div>
  );
}

function EmptyStateActionEl({
  action,
  primary = false,
}: {
  action: EmptyStateAction;
  primary?: boolean;
}) {
  const classes = primary
    ? 'px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded text-sm transition'
    : 'px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition';

  if (action.href) {
    return (
      <Link href={action.href} className={classes}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={classes}>
      {action.label}
    </button>
  );
}
