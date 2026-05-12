import type { Metadata } from 'next';
import { OfflineContent } from './offline-content';

/**
 * Track 5 #23 (Section E) — Offline Fallback Page
 *
 * Wird vom Service Worker (Track 5 #22) als fallback gerendert wenn eine
 * navigation-request fehlschlägt UND kein cache vorhanden ist. Auch direkt
 * unter /offline aufrufbar für users die die seite explizit sehen wollen.
 *
 * # Architektur split
 *
 * Server-component (diese datei) trägt nur die metadata + import. Die
 * interaktive logik (online-detection, retry-handler) sitzt in einem
 * separaten client-component damit:
 *
 *   1. Next.js metadata-API (export const metadata) braucht server-component
 *   2. Die client-bundle bleibt minimal — keine server-side imports nötig
 *   3. Bei SW-serving fließt der gesamte client-code aus dem cache; kein
 *      RSC-payload-fetch nötig (würde offline ja fehlschlagen)
 *
 * # No-auth, no-shell
 *
 * Diese page ist in AppShell.isPublicPath() registriert — kein <Header>,
 * keine <Sidebar>, kein layout-shell. Komplett standalone damit:
 *
 *   - Keine auth() roundtrip die offline fehlschlagen könnte
 *   - Keine DB-queries für user-data die offline nichts liefern
 *   - Minimale dependencies → robust gegen partial-cache-zustände
 */
export const metadata: Metadata = {
  title: 'Offline · VAM System',
  description:
    'Du bist offline. Sobald du wieder verbunden bist, kannst du fortfahren.',
  // robots: noindex damit die seite nicht in suchergebnissen auftaucht —
  // das wäre verwirrend für user die auf "offline" klicken obwohl sie
  // tatsächlich online sind.
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return <OfflineContent />;
}
