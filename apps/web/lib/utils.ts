import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn `cn` — composes Tailwind classes with clsx + tailwind-merge.
 *
 * Used everywhere for conditional className composition. Replaces the
 * Tremor `cx` from earlier iterations (Tremor entfernt in Phase 3).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
