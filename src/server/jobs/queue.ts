import "server-only";
import os from "node:os";
import type { Job } from "@/generated/prisma/client";
import { db } from "../db";
import type { Tx } from "../tx";

/**
 * Cola de tareas en la base de datos ("outbox"). Se escribe en la misma transacción
 * que el cambio de negocio, así nunca se pierde un email o un link de pago aunque el
 * proceso se caiga justo después. El worker la procesa cada pocos segundos.
 */
export type JobType =
  | "SEND_EMAIL"
  | "SEND_WHATSAPP"
  | "CREATE_CHECKOUT"
  | "FANOUT_NEW_POOL"
  | "REFUND_PAYMENT";

export interface JobPayloads {
  SEND_EMAIL: { to: string; subject: string; html: string; text: string };
  SEND_WHATSAPP: { to: string; text: string };
  CREATE_CHECKOUT: { paymentId: string };
  FANOUT_NEW_POOL: { poolId: string };
  REFUND_PAYMENT: { paymentId: string; reason: string };
}

export async function enqueue<T extends JobType>(
  client: Tx | typeof db,
  type: T,
  payload: JobPayloads[T],
  opts: { runAt?: Date; maxAttempts?: number } = {},
): Promise<void> {
  await client.job.create({
    data: {
      type,
      payload: JSON.stringify(payload),
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    },
  });
}

export function workerId(): string {
  return process.env.WORKER_ID ?? `${os.hostname()}-${process.pid}`;
}

/** Toma hasta `limit` tareas vencidas marcándolas como PROCESANDO (atómico). */
export async function claimJobs(limit = 10): Promise<Job[]> {
  const me = workerId();
  const now = new Date();
  // Libera tareas trabadas (por ejemplo, si el worker se reinició en medio de una).
  await db.job.updateMany({
    where: { status: "PROCESANDO", lockedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: "PENDIENTE", lockedAt: null, lockedBy: null },
  });
  const candidates = await db.job.findMany({
    where: { status: "PENDIENTE", runAt: { lte: now } },
    orderBy: { runAt: "asc" },
    take: limit,
    select: { id: true },
  });
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  await db.job.updateMany({
    where: { id: { in: ids }, status: "PENDIENTE" },
    data: { status: "PROCESANDO", lockedAt: now, lockedBy: me },
  });
  return db.job.findMany({ where: { id: { in: ids }, status: "PROCESANDO", lockedBy: me } });
}

export async function completeJob(id: string): Promise<void> {
  await db.job.update({ where: { id }, data: { status: "COMPLETADO", completedAt: new Date(), lockedAt: null } });
}

/** Reintento con espera exponencial: 1, 4, 9, 16... minutos. */
export async function failJob(job: Job, error: unknown): Promise<void> {
  const attempts = job.attempts + 1;
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = attempts >= job.maxAttempts;
  await db.job.update({
    where: { id: job.id },
    data: {
      attempts,
      lastError: message.slice(0, 4000),
      status: exhausted ? "FALLIDO" : "PENDIENTE",
      runAt: exhausted ? job.runAt : new Date(Date.now() + attempts * attempts * 60_000),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export function parsePayload<T extends JobType>(job: Job): JobPayloads[T] {
  return JSON.parse(job.payload) as JobPayloads[T];
}
