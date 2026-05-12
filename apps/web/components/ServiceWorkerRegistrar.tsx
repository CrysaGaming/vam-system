'use client';

import { useEffect } from 'react';

/**
 * Track 5 #22 (Section E) — Service Worker Registrar
 *
 * Client-component die /sw.js beim browser registriert. Self-contained,
 * kein prop-drilling, kein UI — pure side-effect-mount.
 *
 * # Production-only gating
 *
 * `process.env.NODE_ENV === 'production'` ist die GATE. Im dev-mode wäre
 * der SW aktiv tödlich:
 *
 *   1. HMR-updates kämen aus dem cache statt dem dev-server → user sieht
 *      stale-code bis er hard-refresh + unregister macht.
 *   2. Tailwind v4 dev-mode hat schon eigene quirks (siehe Memory) — ein
 *      SW-cache obendrauf würde debugging unmöglich machen.
 *   3. cloudflared-tunnel zum dev-server liefert legit live-content; SW
 *      würde es cachen und damit den whole-point des tunnel (= live preview)
 *      defeaten.
 *
 * Bei prod-build ist NODE_ENV='production' automatisch — kein manueller
 * config-switch nötig. Der SW wird also nur in `pnpm build && pnpm start`
 * oder dem deployed-build registriert.
 *
 * # Registration-timing
 *
 * Wir warten auf `load`-event statt sofort beim mount zu registrieren.
 * Grund: SW-registration ist nicht critical-path und nimmt im worst-case
 * 50-200ms (browser holt /sw.js, parsed es, fired install-event). Wenn
 * wir das während der initialen page-load triggern, konkurriert es mit
 * RSC-fetches + hydration. Nach `load` ist die page interactive und der
 * user merkt die zusätzliche network-aktivität nicht.
 *
 * # No update-banner
 *
 * Wir machen KEIN navigator.serviceWorker.addEventListener('controllerchange')
 * + "Update verfügbar" banner. Track 5 #22 ist nur die foundation —
 * update-UX ist separates feature (V2). Aktueller flow: neuer SW wartet,
 * user kriegt updates beim nächsten kompletten browser-session-restart.
 *
 * # Scope
 *
 * Default scope ist der pfad an dem /sw.js gehostet ist (= root '/') —
 * passt für uns weil wir die ganze app cachen wollen. Explicit `scope: '/'`
 * für klarheit + defense against future path-changes.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // Dev-mode: skip registration komplett. process.env.NODE_ENV wird vom
    // bundler statisch ersetzt — diese dead-code-elimination strippt den
    // ganzen rest der useEffect im prod-build raus.
    if (process.env.NODE_ENV !== 'production') return;

    // Feature-detection: alte browsers (safari <11.1, IE) haben kein SW.
    // typeof navigator-check als belt-and-suspenders für SSR-safety, obwohl
    // useEffect eh nur client-side läuft.
    if (typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          // eslint-disable-next-line no-console
          console.log(
            '[SW] Service worker registered, scope:',
            registration.scope,
          );
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[SW] Service worker registration failed:', err);
        });
    };

    // Warte auf `load` damit wir nicht mit critical resources kämpfen.
    // readyState === 'complete' wenn der user re-mountet auf einer page
    // wo load schon gefired hat (z.B. nach client-side-nav) — dann sofort
    // registrieren.
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      // Cleanup: wenn die component unmount-ed bevor load fired, listener
      // entfernen. Selten in der praxis (AppShell ist persistent), aber
      // saubere hooks-disziplin.
      return () => {
        window.removeEventListener('load', register);
      };
    }
  }, []);

  return null;
}
