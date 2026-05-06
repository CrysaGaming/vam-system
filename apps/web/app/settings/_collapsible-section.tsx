'use client';

import { useState } from 'react';

interface Props {
  /** Main heading shown both collapsed and expanded */
  title: string;
  /** Optional right-side summary text — count, status, etc. Always visible */
  badge?: string;
  /** Initial open/closed state. Default false (collapsed). */
  defaultOpen?: boolean;
  /** Body content — only mounted when expanded so heavy forms don't render
   * server-side state for sections the user isn't viewing. */
  children: React.ReactNode;
}

/**
 * A collapsible section wrapper for the long /settings page. Closed
 * state shows a single header line with title + badge; clicking
 * expands to render the children below.
 *
 * Why a custom React component instead of native `<details>`:
 *   - We control the chevron animation and the body padding
 *   - Children only mount when open, so collapsed cards don't render
 *     their full forms (matters: the Aircraft + Route forms each have
 *     21 inputs × N rows; lazy-mount keeps initial render snappy)
 *   - State lives in client React, so user toggles persist across
 *     router.refresh() calls within the session
 *
 * The wrapper does not provide a card-shaped background — children
 * are expected to render their own card styling. This keeps the
 * collapsed state visually distinct (just a header line) from the
 * expanded state (full card with content), and avoids a double-card
 * nesting visual.
 */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between px-6 py-4 text-left transition hover:bg-muted/50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-block text-muted-foreground transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        {badge !== undefined && (
          <span className="text-xs text-muted-foreground">{badge}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border">{children}</div>
      )}
    </div>
  );
}
