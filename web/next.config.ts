import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

export function buildContentSecurityPolicy(isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "font-src 'self' data:",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  async headers() {
    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value: buildContentSecurityPolicy(process.env.NODE_ENV !== "production"),
      },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), geolocation=(), microphone=()",
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
    ];

    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
