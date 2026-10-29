import "server-only";
import type { PlatformConfig } from "@/generated/prisma/client";
import { db } from "./db";
import type { Tx } from "./tx";

/** Configuración operativa (fila única id = 1). Se crea con valores por defecto si no existe. */
export async function getPlatformConfig(tx?: Tx | typeof db): Promise<PlatformConfig> {
  const client = tx ?? db;
  const existing = await client.platformConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return client.platformConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}
