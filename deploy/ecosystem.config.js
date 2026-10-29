/**
 * PM2 — procesos de PEDILA en producción.
 *
 *   pedila-web     servidor Next.js (build standalone) en 127.0.0.1:3000, modo cluster
 *                  para que `pm2 reload` no corte el servicio.
 *   pedila-worker  tareas programadas (node-cron) y cola de emails / pagos.
 *
 * Estructura esperada en el servidor (la crea deploy/setup-servidor.sh):
 *   ~/pedila/current   -> enlace a la release activa (releases/AAAAMMDD-HHMMSS)
 *   ~/pedila/shared/.env, shared/uploads, shared/logs, shared/backups
 *
 * Uso:  pm2 startOrReload ~/pedila/current/deploy/ecosystem.config.js --update-env
 *       pm2 save            (para que arranque solo al reiniciar el servidor)
 *
 * Memoria pensada para un VPS de 2 GB: 2 instancias web (~250 MB c/u) + worker
 * (~100 MB) + MySQL. Con 1 GB de RAM usá WEB_INSTANCES=1 en shared/.env.
 */
const fs = require("node:fs");
const path = require("node:path");

const APP_HOME = process.env.PEDILA_HOME || path.join(process.env.HOME || "/home/pedila", "pedila");
const CURRENT = path.join(APP_HOME, "current");
const LOGS = path.join(APP_HOME, "shared", "logs");

/** Lee shared/.env (KEY=VALUE, admite comillas y comentarios). */
function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

const fileEnv = loadEnv(path.join(APP_HOME, "shared", ".env"));
let release = "desconocida";
try {
  release = fs.readFileSync(path.join(CURRENT, "RELEASE"), "utf8").trim();
} catch {
  /* primera instalación */
}

const env = {
  NODE_ENV: "production",
  PORT: "3000",
  HOSTNAME: "127.0.0.1", // solo escucha local: el acceso público pasa por el proxy inverso
  UPLOAD_DIR: path.join(APP_HOME, "shared", "uploads"),
  APP_VERSION: release,
  ...fileEnv,
};

module.exports = {
  apps: [
    {
      name: "pedila-web",
      cwd: CURRENT,
      script: ".next/standalone/server.js",
      exec_mode: "cluster",
      instances: Number(env.WEB_INSTANCES || 2),
      node_args: `--max-old-space-size=${env.WEB_MAX_OLD_SPACE_MB || 384}`,
      max_memory_restart: env.WEB_MAX_MEMORY || "480M",
      env,
      autorestart: true,
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      listen_timeout: 20000,
      time: true,
      merge_logs: true,
      out_file: path.join(LOGS, "web.out.log"),
      error_file: path.join(LOGS, "web.err.log"),
    },
    {
      name: "pedila-worker",
      cwd: CURRENT,
      script: "dist/worker.mjs",
      exec_mode: "fork",
      instances: 1,
      node_args: `--max-old-space-size=${env.WORKER_MAX_OLD_SPACE_MB || 192}`,
      max_memory_restart: env.WORKER_MAX_MEMORY || "260M",
      env: { ...env, DB_POOL_LIMIT: env.WORKER_DB_POOL_LIMIT || "3" },
      autorestart: true,
      exp_backoff_restart_delay: 500,
      kill_timeout: 15000,
      time: true,
      out_file: path.join(LOGS, "worker.out.log"),
      error_file: path.join(LOGS, "worker.err.log"),
    },
  ],
};
