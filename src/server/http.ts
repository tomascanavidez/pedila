import "server-only";
import { NextResponse } from "next/server";
import { DomainError } from "@/domain/errors";
import { rateLimiter } from "@/lib/rate-limit";
import { logger } from "./logger";

/** Utilidades para rutas API (Route Handlers). */
export function ipOf(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

export function limited(key: string, limit: { limit: number; windowMs: number }): NextResponse | null {
  const r = rateLimiter.hit(key, limit.limit, limit.windowMs);
  if (r.ok) return null;
  return NextResponse.json(
    { error: "Demasiadas solicitudes. Probá en un momento." },
    { status: 429, headers: { "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
  );
}

export function jsonError(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    const status = err.code === "SIN_SESION" ? 401 : err.code === "SIN_PERMISO" ? 403 : err.code === "NO_ENCONTRADO" ? 404 : 400;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  logger.error("Error en ruta API", { err });
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export function noStore(body: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}
