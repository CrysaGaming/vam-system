'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

/**
 * Client-side provider-stack: TanStack Query + Sonner Toaster.
 *
 * Track 3 #11.2.3 v1: zentrale Stelle für client-state-libs. Wird in
 * app/layout.tsx INNERHALB von <ThemeProvider> gerendert (Theme bleibt
 * eigenes file weil pre-hydration script auf themeInitScript angewiesen
 * ist und VOR der React-hydration laufen muss).
 *
 * QueryClient mit useState statt module-level instance: beim SSR/RSC
 * würde ein module-level Singleton zwischen requests geteilt werden
 * (memory-leak + cache-bleeding zwischen usern). useState garantiert:
 * 1 client pro browser-session, neu für jede SSR-render.
 *
 * Default-options:
 * - staleTime 60s — die meisten unserer queries (live-map, pireps,
 *   bookings) müssen nicht häufiger refetched werden. Pro-query
 *   override für realtime-stuff (z.B. SSE-pushed live-sessions
 *   die manuell invalidieren).
 * - refetchOnWindowFocus false — nervt eher als hilft bei einem
 *   single-tab-app mit OBS overlay/streamer-use-case. Pro-query
 *   opt-in wenn nötig.
 *
 * Toaster: top-right ist konsistent mit shadcn-default + nicht im weg
 * vom AppShell-header (der immer top-fixed ist).
 *
 * Dependencies: shadcn-Migration (#11.2.2 v1). Theme bleibt separat.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
