/**
 * View Transitions API helper für Next.js App-Router-navigation.
 *
 * # Track 3 #11.2.7 — View Transitions API für Page-Changes
 *
 * Kontext: React 19.2.4 (stable) exportiert KEIN `<ViewTransition>`-component
 * (das ist canary-only). Next.js 16's `experimental.viewTransition: true` in
 * next.config.ts ist auch canary-only und würde unseren stable-build
 * blockieren. Stattdessen nutzen wir die browser-native View-Transitions-API
 * via `document.startViewTransition()`.
 *
 * ## Was die browser-API macht
 *
 * `document.startViewTransition(callback)` macht folgendes:
 *   1. Browser captured einen pixel-snapshot des aktuellen DOM-state
 *      ("old" snapshot)
 *   2. Callback läuft, kann DOM-mutations triggern (oder einen client-side
 *      navigation auslösen)
 *   3. Browser captured einen zweiten snapshot nach dem die mutations
 *      committed sind ("new" snapshot)
 *   4. Default-animation: cross-fade zwischen old + new (1s ease)
 *   5. Customizable via CSS `::view-transition-old(*)` /
 *      `::view-transition-new(*)` pseudo-elements und `view-transition-
 *      name` properties auf elementen die persistieren sollen (header,
 *      sidebar, etc.)
 *
 * ## Warum ein wrapper statt direkten aufruf
 *
 * Drei gründe:
 *
 * 1. **Browser-support-detection.** Firefox 121+ hat support, Safari 18+,
 *    aber ältere browsers nicht. Wir wollen graceful-fallback (normaler
 *    push ohne transition) statt einen runtime-error.
 *
 * 2. **Async timing**: `router.push()` ist async (next.js scheduled die
 *    route-resolution im background), aber `startViewTransition`'s
 *    callback ist sync. Das risk ist dass der "new"-snapshot vor dem
 *    React-commit captured wird → empty/half-rendered transition.
 *    Workaround: callback returnt eine promise die auf ein
 *    requestAnimationFrame-frame wartet, gibt React zeit zu committen.
 *
 * 3. **DRY**: jeder navigation-callsite (NavLink, BrandLink,
 *    UserDropdown-menu, etc.) braucht das selbe pattern. Eine helper-fn
 *    macht das DRY.
 *
 * ## Edge-cases die der wrapper handled
 *
 * - **SSR/no-document**: `typeof document === 'undefined'` → fallback zu
 *   plain push. Wichtig für RSC-rendering wo dieser code nie laufen
 *   sollte aber defensive guard schadet nicht.
 *
 * - **Browser ohne support**: `'startViewTransition' in document` check.
 *   Firefox <121, alle WebViews, etc. fallen automatisch zu plain push.
 *
 * - **Reduced-motion preference**: User mit `prefers-reduced-motion: reduce`
 *   bekommen automatisch keine transitions weil unser CSS in globals.css
 *   den `::view-transition-*` styles ein `@media (prefers-reduced-motion)`-
 *   override gibt. JavaScript-side machen wir nichts speziell hier — CSS
 *   handled das eleganter.
 *
 * ## Integration mit Next.js
 *
 * Next.js' app-router macht client-side soft-navigation: kein full
 * document-reload, sondern eine partial-RSC-fetch + React-rerender. Das
 * ist EXAKT der use-case für `startViewTransition` (same-document mode).
 * Cross-document navigation (full page-reload) würde stattdessen via
 * `@view-transition { navigation: auto; }` CSS-rule funktionieren —
 * brauchen wir hier nicht weil App-Router immer soft-navigated.
 */

import type { useRouter } from 'next/navigation';

// Type für `useRouter()` return — extrahiert aus der hook-typesignature
// statt direktem AppRouterInstance-import (der ist in next/dist/* internal
// und nicht stable). Wir brauchen nur die push-method, also reicht ein
// minimaler structural-type. Falls Next.js die router-API später erweitert,
// kommt das automatisch hier durch.
type RouterLike = ReturnType<typeof useRouter>;

/**
 * Navigiert mit view-transition wenn der browser sie unterstützt.
 * Fallback zu plain `router.push()` sonst.
 *
 * Usage:
 *   const router = useRouter();
 *   const onClick = (e) => {
 *     if (e.metaKey || e.ctrlKey) return; // user wants new tab
 *     e.preventDefault();
 *     navigateWithTransition(router, '/dashboard');
 *   };
 *
 * @param router  Result von next/navigation `useRouter()`
 * @param href    Ziel-pfad (relative path wie '/dashboard' oder absolute URL)
 */
export function navigateWithTransition(router: RouterLike, href: string): void {
  // SSR-guard: dieser code wird nur in client-components benutzt, aber
  // ein doppelter check kostet nix und hält den function-body safe für
  // edge-cases (z.B. tests die das module evaluieren).
  if (typeof document === 'undefined') {
    router.push(href);
    return;
  }

  // Feature-detection: in nicht-supported browsers (Firefox <121, alte
  // WebViews, etc.) ist die method nicht da → plain navigation.
  if (!('startViewTransition' in document)) {
    router.push(href);
    return;
  }

  // startViewTransition's callback kann eine promise returnen — der
  // browser wartet bis die promise resolved bevor er den "new"-snapshot
  // captured. Für Next.js' async-router-push reicht es zu warten dass
  // ein requestAnimationFrame-frame durchgegangen ist; das gibt React
  // zeit zu committen und stellt sicher dass die transition den echten
  // post-navigation-DOM captured.
  //
  // TypeScript: startViewTransition existiert in lib.dom seit TS 5.4 als
  // Document.prototype.startViewTransition. Wir casten defensiv falls die
  // user-tsconfig ein älteres lib-target nutzt.
  //
  // # Tab-visibility-fallback
  //
  // Wenn das tab im hintergrund ist (visibilityState === 'hidden'), wirft
  // chromium IMMER einen InvalidStateError mit der irreführenden message
  // "Transition was aborted because of invalid state" (siehe react bug
  // #34098). In dem fall macht eine view-transition eh keinen sinn — es
  // gibt keinen sichtbaren paint — also skippen wir komplett.
  if (document.visibilityState === 'hidden') {
    router.push(href);
    return;
  }

  // Typ-cast: ViewTransition ist seit TS 5.4 in lib.dom verfügbar, aber
  // hier minimal getypt damit wir nicht auf das genaue lib-target
  // angewiesen sind.
  type ViewTransitionLike = {
    readonly ready: Promise<void>;
    readonly finished: Promise<void>;
    readonly updateCallbackDone: Promise<void>;
    skipTransition(): void;
  };
  const doc = document as Document & {
    startViewTransition: (
      cb: () => Promise<void> | void,
    ) => ViewTransitionLike;
  };

  const transition = doc.startViewTransition(async () => {
    router.push(href);
    // Ein RAF-frame wartet auf den nächsten paint-cycle = react hat
    // commit-chance gehabt. Zwei frames würden noch sicherer sein
    // aber 1 frame reicht in 99% der fälle und hält die transition
    // schnell.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });

  // # Promise-rejection-handling (CRITICAL)
  //
  // Die spec sagt explizit: "The ready promise and update callback done
  // promise are immediately created, so rejections will cause unhandled-
  // rejections unless they're handled, even if the getters such as
  // updateCallbackDone are not accessed."
  // (https://drafts.csswg.org/css-view-transitions-1/)
  //
  // Diese rejections sind in unserem fall HARMLOS — sie passieren wenn:
  //
  //   - InvalidStateError: user klickt mehrmals schnell hintereinander,
  //     oder tab wird grade in den hintergrund verschoben während die
  //     transition läuft (chromium nutzt die selbe message für beide
  //     fälle, siehe react bug #34098). Die navigation läuft trotzdem
  //     normal durch.
  //   - TimeoutError: DOM-update braucht zu lange (z.B. langsame RSC-
  //     fetch). Die transition wird abgebrochen, aber die navigation
  //     committed normal (siehe react bug #35015).
  //   - AbortError: eine neue startViewTransition() wurde aufgerufen
  //     während die alte noch lief — die alte wird gecancelt.
  //
  // Vorher: diese rejections wurden NIRGENDS gecatched → tauchen als
  // unhandled exceptions im console auf (auf jeder navigation potentiell
  // ein bis vier errors). Jetzt: `.catch(() => {})` markiert die promises
  // als handled, ohne weitere aktion — der browser hat schon das richtige
  // gemacht (transition skippen, navigation läuft normal).
  //
  // Wichtig: wir catchen BEIDE promises (`.ready` UND `.finished`) weil
  // beide unabhängig rejecten können. `.finished` für TimeoutError + post-
  // animation cleanup, `.ready` für InvalidStateError im snapshot-capture.
  // updateCallbackDone catchen wir nicht weil das den router.push-error
  // verstecken würde wenn next.js mal hart failed.
  transition.ready.catch(() => {
    // Intentionally empty — view-transition harmlos abgebrochen.
  });
  transition.finished.catch(() => {
    // Intentionally empty — view-transition harmlos abgebrochen.
  });
}
