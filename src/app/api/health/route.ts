import { db } from "@/server/db";
import { noStore } from "@/server/http";

/**
 * Chequeo de salud para el monitoreo y para deploy.sh:
 *  - 200 si la app responde y la base de datos contesta.
 *  - 503 si la base no responde.
 * Informa además el último latido del worker de tareas programadas.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let dbOk = false;
  let worker: { ok: boolean; lastBeat: string | null } = { ok: false, lastBeat: null };
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
    const beat = await db.systemStatus.findUnique({ where: { key: "worker.heartbeat" } });
    if (beat) worker = { ok: Date.now() - beat.updatedAt.getTime() < 3 * 60_000, lastBeat: beat.updatedAt.toISOString() };
  } catch {
    dbOk = false;
  }
  const body = {
    status: dbOk ? "ok" : "error",
    db: dbOk ? "ok" : "error",
    worker,
    version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "dev",
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    responseMs: Date.now() - started,
    time: new Date().toISOString(),
  };
  return noStore(body, { status: dbOk ? 200 : 503 });
}
