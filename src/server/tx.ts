import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { logger } from "./logger";

export type Tx = Prisma.TransactionClient;

function isRetryable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; meta?: { code?: string } } | undefined;
  if (!e) return false;
  if (e.code === "P2034") return true; // conflicto de escritura / deadlock
  const msg = String(e.message ?? "");
  return /deadlock|lock wait timeout|1213|1205|try restarting transaction/i.test(msg);
}

/**
 * Transacción interactiva con READ COMMITTED y reintentos ante deadlocks.
 * Todas las mutaciones de pools pasan por acá.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts: { retries?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  let attempt = 0;
  for (;;) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: "ReadCommitted",
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (err) {
      attempt++;
      if (attempt > retries || !isRetryable(err)) throw err;
      logger.warn("Reintentando transacción por conflicto de bloqueo", { attempt });
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.floor(Math.random() * 50)));
    }
  }
}
