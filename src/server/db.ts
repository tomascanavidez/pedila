import "server-only";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Cliente Prisma único por proceso.
 * - Driver adapter de MariaDB (funciona con MySQL 5.7+/8 y MariaDB 10.4+).
 * - Pool de conexiones chico (DB_POOL_LIMIT, por defecto 5) para no saturar un VPS
 *   de 2 GB: con 2 instancias web + 1 worker se usan como máximo ~15 conexiones.
 * - Para pasar a PostgreSQL: cambiar este adaptador por @prisma/adapter-pg y el
 *   provider del schema (ver comentario en prisma/schema.prisma).
 */
export type Db = PrismaClient;

function buildPoolConfig(url: string, connectionLimit: number) {
  const u = new URL(url);
  const host = u.hostname;
  return {
    host,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit,
    acquireTimeout: 15_000,
    connectTimeout: 10_000,
    // MySQL 8 con caching_sha2_password sin TLS necesita pedir la clave pública al servidor.
    allowPublicKeyRetrieval: u.searchParams.get("allowPublicKeyRetrieval") !== "false",
    ssl: u.searchParams.get("ssl") === "true" ? { rejectUnauthorized: true } : undefined,
    // La sesión trabaja siempre en UTC aunque el servidor MySQL esté en hora argentina.
    initSql: "SET time_zone = '+00:00'",
    prepareCacheLength: 0,
  };
}

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL en el entorno (.env)");
  const limit = Number(process.env.DB_POOL_LIMIT ?? 5) || 5;
  const adapter = new PrismaMariaDb(buildPoolConfig(url, limit));
  return new PrismaClient({
    adapter,
    log: process.env.LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as { __pedilaPrisma?: PrismaClient };

/** Acceso perezoso: no abre conexiones hasta la primera consulta. */
export function getDb(): PrismaClient {
  if (!globalForPrisma.__pedilaPrisma) globalForPrisma.__pedilaPrisma = createClient();
  return globalForPrisma.__pedilaPrisma;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDb();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__pedilaPrisma) {
    await globalForPrisma.__pedilaPrisma.$disconnect();
    globalForPrisma.__pedilaPrisma = undefined;
  }
}
