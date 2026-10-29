import os from "node:os";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// En desarrollo, permitir abrir la app desde otro dispositivo de la misma red (por ejemplo,
// el celular por wifi en http://192.168.x.x:3000). Next bloquea por defecto los recursos
// de desarrollo pedidos desde un host distinto de localhost. Se agregan solas las IPs
// locales de esta máquina; DEV_ALLOWED_ORIGINS suma otros hosts (separados por coma).
const devOrigins = isDev
  ? [
      ...Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === "IPv4" && !i.internal)
        .map((i) => i!.address),
      ...(process.env.DEV_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
    ]
  : [];

// CSP sin nonces para que las páginas públicas se puedan cachear (ISR). Next necesita
// 'unsafe-inline' para sus scripts de hidratación; no se usa dangerouslySetInnerHTML
// con contenido de usuarios.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // Build liviano para el VPS: .next/standalone trae solo lo necesario para correr.
  output: "standalone",
  poweredByHeader: false,
  // No generar AGENTS.md: la documentación del proyecto vive en un único README.md.
  agentRules: false,
  allowedDevOrigins: devOrigins,
  reactStrictMode: true,
  // Identificador de la versión desplegada (lo define deploy.sh / CI). Con él, durante un
  // `pm2 reload` los navegadores con la versión anterior recargan en lugar de fallar.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
  // Las imágenes ya se guardan optimizadas en WebP (sharp al subir): no hace falta
  // gastar CPU del servidor re-optimizándolas en cada pedido.
  images: { unoptimized: true },
  serverExternalPackages: ["sharp", "mariadb", "@prisma/adapter-mariadb", "pdf-lib", "nodemailer", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/uploads/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=2592000, immutable" }] },
    ];
  },
};

export default nextConfig;
