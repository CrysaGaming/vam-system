/**
 * Layout für /overlay/[token]
 *
 * Wichtig: dieses Layout überschreibt das Root-Layout, damit:
 *   - Hintergrund transparent ist (für OBS-Compositing)
 *   - Keine Header/Navigation gerendert wird
 *   - Body keine Tailwind-bg-Class erbt
 *
 * Alle Style-Properties inline, weil OBS keine CSS-Files nachlädt
 * wenn als Browser-Source.
 */

export const metadata = {
  title: 'VAM Overlay',
  robots: 'noindex, nofollow',
};

export default function OverlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'transparent',
        minHeight: '100vh',
        margin: 0,
        padding: 0,
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html, body {
              background: transparent !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }
            * {
              user-select: none;
            }
          `,
        }}
      />
      {children}
    </div>
  );
}
