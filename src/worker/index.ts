/**
 * Worker de PEDILA (proceso aparte: `pedila-worker` en PM2).
 *
 * Tareas programadas (node-cron, hora argentina, sin superposición):
 *   cada 15 s   procesar la cola de tareas (emails, links de pago, avisos, reintegros)
 *   cada 1 min  vencer o cerrar pools cuya fecha límite pasó
 *   cada 1 min  vencer pagos fuera de plazo y aplicar la regla configurada
 *   cada 5 min  finalizar pools vencidos sin decisión del preventista
 *   cada 1 min  latido (lo informa /api/health y el panel admin)
 *   04:00       limpieza de registros viejos
 *
 * Uso:  node dist/worker.mjs          (producción, lo arranca PM2)
 *       npm run dev:worker            (desarrollo, con recarga)
 *       node dist/worker.mjs --once   (corre todo una vez y termina; útil para cron del sistema)
 */
import cron from "node-cron";
import { isDomainError } from "@/domain/errors";
import { db, disconnectDb } from "@/server/db";
import { claimJobs, completeJob, failJob, parsePayload, workerId } from "@/server/jobs/queue";
import { logger } from "@/server/logger";
import { smtpEmailChannel, whatsAppChannel } from "@/server/notifications/channels";
import { ensureCheckout, refundPayment, runPaymentExpiry } from "@/server/services/payments";
import { fanoutNewPool, runExpiredFinalization, runPoolDeadlines } from "@/server/services/pools";
import type { Job } from "@/generated/prisma/client";

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile?.(".env");
  } catch {
    /* sin .env: se usan las variables del entorno */
  }
}

const TZ = "America/Argentina/Buenos_Aires";

async function handle(job: Job): Promise<void> {
  switch (job.type) {
    case "SEND_EMAIL": {
      const p = parsePayload<"SEND_EMAIL">(job);
      const r = await smtpEmailChannel.send(p);
      logger.debug("Email procesado", { to: p.to, info: r.info });
      return;
    }
    case "SEND_WHATSAPP": {
      const p = parsePayload<"SEND_WHATSAPP">(job);
      if (whatsAppChannel.enabled) await whatsAppChannel.send(p.to, p.text);
      return;
    }
    case "CREATE_CHECKOUT": {
      const p = parsePayload<"CREATE_CHECKOUT">(job);
      try {
        await ensureCheckout(p.paymentId);
      } catch (err) {
        // Si el pago ya no se puede abonar (pagado, vencido) no hay nada que reintentar.
        if (isDomainError(err)) return;
        throw err;
      }
      return;
    }
    case "FANOUT_NEW_POOL": {
      const p = parsePayload<"FANOUT_NEW_POOL">(job);
      const n = await fanoutNewPool(p.poolId);
      logger.info("Aviso de nuevo pool enviado", { poolId: p.poolId, comercios: n });
      return;
    }
    case "REFUND_PAYMENT": {
      const p = parsePayload<"REFUND_PAYMENT">(job);
      await refundPayment(p.paymentId, p.reason);
      return;
    }
    default:
      throw new Error(`Tipo de tarea desconocido: ${job.type}`);
  }
}

export async function processQueue(maxBatches = 20): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxBatches; i++) {
    const jobs = await claimJobs(10);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      try {
        await handle(job);
        await completeJob(job.id);
      } catch (err) {
        logger.error("Falló una tarea", { jobId: job.id, type: job.type, err });
        await failJob(job, err);
      }
      processed++;
    }
  }
  return processed;
}

async function heartbeat(): Promise<void> {
  const value = JSON.stringify({ worker: workerId(), pid: process.pid, memoryMb: Math.round(process.memoryUsage().rss / 1_048_576) });
  await db.systemStatus.upsert({ where: { key: "worker.heartbeat" }, create: { key: "worker.heartbeat", value }, update: { value } });
}

async function cleanup(): Promise<void> {
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);
  const [jobs, hooks, tokens, notes] = await Promise.all([
    db.job.deleteMany({ where: { status: "COMPLETADO", completedAt: { lt: days(30) } } }),
    db.webhookEvent.deleteMany({ where: { createdAt: { lt: days(90) } } }),
    db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: days(1) } } }),
    db.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: days(180) } } }),
  ]);
  logger.info("Limpieza diaria", { jobs: jobs.count, webhooks: hooks.count, tokens: tokens.count, notificaciones: notes.count });
}

/** Envuelve una tarea para que un error no tumbe el proceso y quede en el log. */
function safe(name: string, fn: () => Promise<unknown>) {
  return async () => {
    const started = Date.now();
    try {
      const result = await fn();
      if (result && typeof result === "object" && Object.values(result).some((v) => typeof v === "number" && v > 0)) {
        logger.info(`Tarea ${name}`, { result, ms: Date.now() - started });
      } else if (typeof result === "number" && result > 0) {
        logger.info(`Tarea ${name}`, { result, ms: Date.now() - started });
      }
    } catch (err) {
      logger.error(`Error en la tarea ${name}`, { err });
    }
  };
}

const TASKS = {
  queue: safe("cola", () => processQueue()),
  deadlines: safe("vencimiento-pools", () => runPoolDeadlines()),
  payments: safe("vencimiento-pagos", () => runPaymentExpiry()),
  finalize: safe("finalizar-vencidos", () => runExpiredFinalization()),
  heartbeat: safe("latido", () => heartbeat()),
  cleanup: safe("limpieza", () => cleanup()),
};

async function runOnce(): Promise<void> {
  await TASKS.heartbeat();
  await TASKS.deadlines();
  await TASKS.payments();
  await TASKS.finalize();
  await TASKS.queue();
}

async function main(): Promise<void> {
  if (process.argv.includes("--once")) {
    await runOnce();
    await disconnectDb();
    return;
  }
  logger.info("Worker de PEDILA iniciado", { worker: workerId(), tz: TZ });
  const opts = (name: string) => ({ timezone: TZ, name, noOverlap: true });
  cron.schedule("*/15 * * * * *", TASKS.queue, opts("cola"));
  cron.schedule("* * * * *", TASKS.deadlines, opts("vencimiento-pools"));
  cron.schedule("* * * * *", TASKS.payments, opts("vencimiento-pagos"));
  cron.schedule("*/5 * * * *", TASKS.finalize, opts("finalizar-vencidos"));
  cron.schedule("* * * * *", TASKS.heartbeat, opts("latido"));
  cron.schedule("0 4 * * *", TASKS.cleanup, opts("limpieza"));
  await runOnce();

  const shutdown = async (signal: string) => {
    logger.info("Deteniendo el worker", { signal });
    for (const task of cron.getTasks().values()) await task.stop();
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (err) => {
  logger.error("El worker se detuvo por un error", { err });
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
