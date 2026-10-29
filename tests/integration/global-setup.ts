import { execSync } from "node:child_process";
import "dotenv/config";

/**
 * Prepara la base de TEST (DATABASE_URL_TEST) aplicando las migraciones pendientes con
 * `prisma migrate deploy`, que no borra datos. Los tests crean sus propios datos con
 * identificadores únicos, así que se pueden correr muchas veces sobre la misma base sin
 * resetearla. Nunca se usa la base de desarrollo.
 */
export default function setup(): void {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      "Los tests de integración necesitan DATABASE_URL_TEST (una base MySQL/MariaDB aparte de la de desarrollo). Ver README › Tests.",
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST no puede ser la misma base que DATABASE_URL.");
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
