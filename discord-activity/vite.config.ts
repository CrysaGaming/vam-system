import { defineConfig } from 'vite';

/**
 * Welle N / N5 — Discord Activity build config.
 *
 * Discord serves activity static files from a CDN registered in the
 * Developer Portal (URL Mappings). For local-dev we just serve from
 * Vite's default; the Discord client tunnels via their mobile/desktop
 * runtime. See README for the dev-tunnel setup.
 */
export default defineConfig({
  server: {
    port: 5173,
    // Discord activities run in an iframe with cross-origin policies —
    // dev-server must allow whatever origin Discord proxies through.
    // The Developer-Portal URL-mappings handle prod; for dev, '*' is
    // fine and gets locked down at deploy-time.
    cors: true,
    headers: {
      // Discord's embed iframe expects CSP that allows their domain to
      // host this content. Permissive in dev; tighten in prod via the
      // CDN response-headers.
      'Access-Control-Allow-Origin': '*',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
