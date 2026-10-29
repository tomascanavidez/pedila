import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

/**
 * Proxy (antes "middleware") de Next 16. Corre antes de cada página:
 *  1. Protección CSRF para rutas API que modifican datos: exige que el Origin coincida
 *     con el host (las Server Actions ya traen esta verificación incorporada).
 *  2. Control de acceso grueso por rol según el prefijo de la URL. El control fino
 *     (y definitivo) se hace en cada página, acción y endpoint contra la base.
 */
const { auth } = NextAuth(authConfig);

const ROLE_AREAS: { prefix: string; role: "ADMIN" | "PREVENTISTA" | "COMERCIO" }[] = [
  { prefix: "/admin", role: "ADMIN" },
  { prefix: "/preventista", role: "PREVENTISTA" },
  { prefix: "/comercio", role: "COMERCIO" },
];

const LOGGED_IN_ONLY = ["/notificaciones", "/completar-perfil"];

const CSRF_EXEMPT = ["/api/auth/", "/api/webhooks/", "/api/health"];

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function home(role: string | undefined): string {
  if (role === "ADMIN") return "/admin";
  if (role === "PREVENTISTA") return "/preventista";
  if (role === "COMERCIO") return "/comercio";
  return "/";
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const method = req.method.toUpperCase();

  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!CSRF_EXEMPT.some((p) => pathname.startsWith(p)) && !isSameOrigin(req)) {
      return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
    }
    return NextResponse.next();
  }

  const user = req.auth?.user;
  const area = ROLE_AREAS.find((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
  const needsLogin = area || LOGGED_IN_ONLY.some((p) => pathname.startsWith(p));
  if (needsLogin && !user?.id) {
    const url = new URL("/ingresar", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (area && user) {
    if (user.role !== area.role) return NextResponse.redirect(new URL(home(user.role), req.nextUrl.origin));
    if (user.role !== "ADMIN" && !user.profileComplete) {
      return NextResponse.redirect(new URL("/completar-perfil", req.nextUrl.origin));
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|uploads/|icon|favicon|robots.txt|manifest).*)"],
};
