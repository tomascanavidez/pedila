import { z } from "zod";

/**
 * Variables de entorno tipadas. Se leen en forma diferida (getEnv) para que
 * `next build` no falle si el build se hace en una máquina sin base de datos.
 * Ver .env.example para la descripción de cada una.
 */
const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1" || v === "yes"));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "Falta DATABASE_URL"),
  DB_POOL_LIMIT: z.coerce.number().int().min(1).max(50).default(5),
  APP_URL: z.string().url().default("http://localhost:3000"),

  PAYMENTS_PROVIDER: z.enum(["mercadopago", "simulado"]).optional(),
  ALLOW_SIMULATED_PAYMENTS: bool(false),
  MP_ACCESS_TOKEN: optionalString,
  MP_WEBHOOK_SECRET: optionalString,
  MP_USE_SANDBOX: bool(true),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: bool(true),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: z.string().default("PEDILA <no-responder@pedila.com.ar>"),
  ADMIN_ALERT_EMAIL: optionalString,

  UPLOAD_DIR: z.string().default("./uploads"),
  UPLOAD_MAX_MB: z.coerce.number().min(1).max(20).default(5),

  WHATSAPP_ENABLED: bool(false),
  WORKER_ID: optionalString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida (.env): ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Proveedor de pagos activo: Mercado Pago si hay token; si no, el simulado (solo desarrollo). */
export function activePaymentProvider(): "mercadopago" | "simulado" {
  const env = getEnv();
  if (env.PAYMENTS_PROVIDER) return env.PAYMENTS_PROVIDER;
  return env.MP_ACCESS_TOKEN ? "mercadopago" : "simulado";
}

export function simulatedPaymentsAllowed(): boolean {
  const env = getEnv();
  return env.NODE_ENV !== "production" || env.ALLOW_SIMULATED_PAYMENTS;
}
