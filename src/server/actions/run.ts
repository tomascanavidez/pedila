import "server-only";
import { revalidateTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ZodError, type ZodType } from "zod";
import { DomainError, FieldErrors } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { rateLimiter } from "@/lib/rate-limit";
import { formDataToObject, zodFieldErrors } from "@/lib/validation";
import { logger } from "../logger";

/**
 * Ejecuta una acción de servidor y traduce los errores a un estado de formulario.
 * Los redirect()/notFound() de Next se relanzan para que funcionen normalmente.
 */
export async function runAction(fn: () => Promise<ActionState | void>, successMessage = "Listo."): Promise<ActionState> {
  try {
    const result = await fn();
    return result ?? { ok: true, message: successMessage };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof FieldErrors) return { ok: false, message: err.message, fields: err.fields };
    if (err instanceof DomainError) return { ok: false, message: err.message };
    if (err instanceof ZodError) return { ok: false, message: "Revisá los datos marcados.", fields: zodFieldErrors(err) };
    logger.error("Error inesperado en una acción", { err });
    return { ok: false, message: "Ocurrió un error inesperado. Probá de nuevo en unos minutos." };
  }
}

export function parseForm<T>(schema: ZodType<T>, fd: FormData): T {
  const result = schema.safeParse(formDataToObject(fd));
  if (!result.success) throw result.error;
  return result.data;
}

export function enforceLimit(key: string, limit: { limit: number; windowMs: number }): void {
  if (!rateLimiter.hit(key, limit.limit, limit.windowMs).ok) {
    throw new DomainError("RATE_LIMIT", "Hiciste demasiados intentos seguidos. Esperá un momento y probá de nuevo.");
  }
}

/** Invalida los datos públicos cacheados (inmediato). */
export function refreshPublic(...tags: string[]): void {
  for (const t of tags) revalidateTag(t, { expire: 0 });
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
