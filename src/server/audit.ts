import "server-only";
import type { Tx } from "./tx";
import { type db } from "./db";

export interface Actor {
  id: string | null;
  role: string | null;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: null, role: "SISTEMA" };

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

function serialize(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
}

/** Registra un evento de auditoría (dentro de la misma transacción del cambio). */
export async function audit(tx: Tx | typeof db, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      actorRole: actor.role,
      ip: actor.ip ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary?.slice(0, 500),
      before: serialize(entry.before),
      after: serialize(entry.after),
    },
  });
}
