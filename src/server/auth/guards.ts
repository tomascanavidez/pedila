import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { auth } from "@/auth";
import { DomainError } from "@/domain/errors";
import { db } from "../db";
import type { UserActor } from "../services/actor";

export interface CurrentUser extends UserActor {
  name: string;
  email: string;
  distributorStatus: "PENDIENTE" | "APROBADO" | "RECHAZADO" | null;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? null)?.trim() ?? null;
}

/**
 * Usuario actual verificado contra la base en cada request (no alcanza con el JWT:
 * así una suspensión o un cambio de rol se aplican de inmediato).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const u = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, status: true, business: { select: { id: true, distributorStatus: true } } },
  });
  if (!u || u.status !== "ACTIVO") return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    businessId: u.business?.id ?? null,
    distributorStatus: u.business?.distributorStatus ?? null,
    ip: await clientIp(),
  };
});

/** Para páginas: redirige al login o al panel que corresponde. */
export async function requirePageUser(roles: readonly Role[] | null, returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/ingresar?callbackUrl=${encodeURIComponent(returnTo)}`);
  if (user.role !== "ADMIN" && !user.businessId) redirect("/completar-perfil");
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** Para acciones de servidor y rutas API: lanza un error si no hay permiso. */
export async function requireActionUser(roles: readonly Role[] | null): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new DomainError("SIN_SESION", "Tu sesión venció. Ingresá de nuevo.");
  if (roles && !roles.includes(user.role)) throw new DomainError("SIN_PERMISO", "No tenés permiso para hacer esto.");
  return user;
}

export function homeFor(role: Role): string {
  if (role === "ADMIN") return "/admin";
  if (role === "PREVENTISTA") return "/preventista";
  return "/comercio";
}

/** Solo rutas internas relativas (evita redirecciones abiertas a otros dominios). */
export function safeCallbackUrl(url: string | null | undefined, fallback = "/"): string {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return fallback;
  return url;
}
