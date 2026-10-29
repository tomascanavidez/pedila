// Servidor para los tests E2E: el build standalone apuntando a la base de E2E,
// con pagos simulados habilitados (nunca usar esta configuración en producción).
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import "dotenv/config";

if (!existsSync(".next/standalone/server.js")) {
  console.error("Falta el build: corré `npm run build` antes de `npm run test:e2e`.");
  process.exit(1);
}
const url = process.env.DATABASE_URL_E2E;
if (!url) {
  console.error("Falta DATABASE_URL_E2E en .env (una base aparte para los tests E2E).");
  process.exit(1);
}
if (url === process.env.DATABASE_URL) {
  console.error("DATABASE_URL_E2E tiene que ser una base distinta de DATABASE_URL.");
  process.exit(1);
}
// Prepara la base sin borrar nada: migraciones pendientes + seed demo si está vacía.
execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
execSync("npx prisma db seed", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });

const port = process.env.E2E_PORT ?? "3200";
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: url,
    PORT: port,
    HOSTNAME: "127.0.0.1",
    APP_URL: `http://127.0.0.1:${port}`,
    AUTH_URL: `http://127.0.0.1:${port}`,
    AUTH_TRUST_HOST: "true",
    PAYMENTS_PROVIDER: "simulado",
    ALLOW_SIMULATED_PAYMENTS: "true",
    SMTP_HOST: "",
    LOG_LEVEL: "warn",
  },
});
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
