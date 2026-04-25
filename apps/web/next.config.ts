import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Erlaubt Dev-Resources (HMR, etc.) von Cloudflare Tunnel-Hosts
  // Wildcard *.trycloudflare.com damit URL-Wechsel keine Config-Änderung braucht
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "vam.kevindrack.de",
  ],
};

export default nextConfig;