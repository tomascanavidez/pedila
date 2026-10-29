/**
 * Logger mínimo: en producción escribe una línea JSON por evento (fácil de leer con
 * `pm2 logs` y de rotar con pm2-logrotate); en desarrollo, texto legible.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return ORDER[lvl] ?? ORDER.info;
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return err;
}

function write(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const data = meta
    ? Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, k === "err" ? serializeError(v) : v]))
    : undefined;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  if (process.env.NODE_ENV === "production") {
    out(
      JSON.stringify({ t: new Date().toISOString(), level, msg, ...data }, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
  } else {
    out(`[${level}] ${msg}`, data ?? "");
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};
