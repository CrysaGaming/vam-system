/**
 * AirlineBrandingProvider — Track 3 #11.2.4 Phase 4 + #11.2.6 v2.
 *
 * Server-component das pro user die brand-color seiner airline als
 * CSS-variable-override auf :root injiziert. Damit picken alle Tailwind
 * v4 utilities die --primary nutzen (`bg-primary`, `text-primary`,
 * `border-primary`, `ring-primary`, plus opacity-modifier wie
 * `bg-primary/90` via color-mix) automatisch die airline-farbe.
 *
 * # Architektur-entscheidungen
 *
 * **Server-component (kein React-Context)**: docs/vision/platform-
 * layout-redesign.md Section 6.3 skizziert einen Context-Provider, aber
 * für v1 reicht ein server-side <style>-tag im <head>. Vorteile:
 * - Kein FOUC — branding ist da bevor React hydratet
 * - Kein client-bundle-overhead
 * - Funktioniert ohne 'use client' in nested layouts
 *
 * Wenn später dynamisches per-route-rebranding kommt (z.B. /a/[icao]
 * public-pages mit fremder airline-brand), kann ein Context dazukommen
 * der diesen <style>-block überschreibt — die :root-cascade bleibt der
 * fallback.
 *
 * **Override sowohl :root als auch .dark**: Beide modes bekommen die
 * gleiche brand-hex. Ohne den .dark-override würde die globals.css-
 * default-indigo-dark-variante (oklch(0.626 0.213 262.7)) im dark-mode
 * gewinnen und die airline-farbe wäre nur in light-mode sichtbar. Für
 * v1 ist die identische farbe in beiden modes ein bewusster tradeoff —
 * mode-spezifische brand-tones (heller im dark-mode) sind ein v2-thema.
 *
 * **Nur --primary, NICHT --secondary**: Schema hat zwar `secondaryColor`
 * auf Airline, aber in der shadcn-token-konvention ist `--secondary` ein
 * neutraler surface-token (siehe globals.css Z.184: `oklch(0.97 0 0)`),
 * NICHT eine brand-accent-farbe. Den airline-secondaryColor auf
 * --secondary zu mappen würde shadcn-Button variant="secondary" und
 * andere primitives mit brand-farbe füllen statt mit dem neutralen grau
 * — visuell broken. secondaryColor wird stattdessen direkt von public-
 * pages /a/[icao] über inline-styles genutzt (siehe airline-settings-
 * form Z.306 für die UI).
 *
 * **--primary-foreground bleibt default white**: Funktioniert für die
 * meisten brand-farben (indigo, navy, red, green, etc). Pastell-farben
 * würden besseren contrast mit dunklem foreground haben — das ist v2.
 *
 * # Default-Fallback
 *
 * Wenn `primaryColor` null oder empty ist: kein <style>-tag wird
 * gerendert, globals.css :root --primary (Indigo oklch(0.546 0.215
 * 262.4)) bleibt aktiv. Das ist das "Default-VAM-Branding" aus der
 * roadmap — kein extra-handling nötig weil css-cascade es schon macht.
 *
 * # Hex-validierung
 *
 * Schema-comment sagt "#RRGGBB enforced app-layer". Wir validieren hier
 * nochmal defensiv weil ein <style>-tag mit user-input ein potentieller
 * CSS-injection-vektor ist. Strict regex auf #RRGGBB; alles andere wird
 * verworfen (kein style-tag).
 */

const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

interface AirlineBrandingProviderProps {
  primaryColor: string | null | undefined;
}

export function AirlineBrandingProvider({ primaryColor }: AirlineBrandingProviderProps) {
  if (!primaryColor) return null;

  const trimmed = primaryColor.trim();
  if (!HEX_COLOR_REGEX.test(trimmed)) return null;

  const css = `:root,.dark{--primary:${trimmed};}`;

  return (
    <style
      id="airline-branding"
      data-airline-primary={trimmed}
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
