import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { DomainError } from "@/domain/errors";
import type { Actor } from "../audit";

/** Usuario que ejecuta una operación (lo arma la capa de auth a partir de la sesión). */
export interface UserActor extends Actor {
  id: string;
  role: Role;
  businessId: string | null;
}

export function requireBusiness(actor: UserActor): string {
  if (!actor.businessId) {
    throw new DomainError("PERFIL_INCOMPLETO", "Completá los datos de tu negocio para continuar.");
  }
  return actor.businessId;
}

export function assertOwnerOrAdmin(actor: UserActor, ownerBusinessId: string): void {
  if (actor.role === "ADMIN") return;
  if (actor.businessId !== ownerBusinessId) {
    throw new DomainError("SIN_PERMISO", "No tenés permiso para hacer esto.");
  }
}
