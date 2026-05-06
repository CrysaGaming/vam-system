import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Erlaubt Dev-Resources (HMR, etc.) von Cloudflare Tunnel-Hosts
  // Wildcard *.trycloudflare.com damit URL-Wechsel keine Config-Änderung braucht
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "vam.kevindrack.de",
  ],

  // React Compiler (stabil seit Next.js 16) — automatische memoization aller
  // JSX-/Hook-files via Babel-pass. Next.js pre-filtert via SWC, sodass nur
  // relevante files den Compiler durchlaufen → minimaler Build-overhead.
  // Reduziert un-nötige re-renders in interaktiven UIs (live-map, overlay-client,
  // events admin) ohne manuelle useMemo/useCallback. Benötigt
  // babel-plugin-react-compiler (devDependency, ^1.0.0).
  reactCompiler: true,

  experimental: {
    // Turbopack persistent Filesystem-Cache: speichert Compile-Artifacts in
    // .next/ zwischen dev-restarts. Massive Verbesserung des Cold-Start
    // (besonders nach Server-restart bei DB-migrations) — Vercel berichtet
    // von Minuten → Sekunden bei großen Projekten. Trade-off: minimal mehr
    // disk-usage in .next/. In neueren Next.js 16 docs als default-on
    // dokumentiert, aber wir setzen explizit für Konsistenz und um vor
    // potential default-drift in zukünftigen versions geschützt zu sein.
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;