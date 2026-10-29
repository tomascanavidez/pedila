/**
 * Esquemas Zod compartidos entre cliente (validación inmediata en formularios) y
 * servidor (validación definitiva en cada acción). Los valores llegan como texto
 * desde FormData, por eso se transforman acá a números, centavos y fechas.
 */
import { z } from "zod";
import { isValidCuit, normalizeCuit } from "@/domain/cuit";
import { parseARS, parsePercentToBps } from "@/domain/money";
import { parseLocalDateTimeAR } from "./dates";

/** Quita caracteres de control y espacios sobrantes (texto de una línea). */
export function cleanLine(s: string): string {
   
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/** Texto multilínea: conserva saltos de línea, quita otros caracteres de control. */
export function cleanMultiline(s: string): string {
   
  return s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

const line = (min: number, max: number, label: string) =>
  z
    .string(`Completá ${label}.`)
    .transform(cleanLine)
    .pipe(z.string().min(min, `Completá ${label}.`).max(max, `${label[0]?.toUpperCase()}${label.slice(1)} es demasiado largo.`));

const optionalLine = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? cleanLine(v) : ""))
    .pipe(z.string().max(max, "Es demasiado largo."))
    .transform((v) => (v === "" ? null : v));

const optionalMultiline = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? cleanMultiline(v) : ""))
    .pipe(z.string().max(max, "Es demasiado largo."))
    .transform((v) => (v === "" ? null : v));

const intField = (label: string, min: number, max: number) =>
  z.coerce
    .number(`Ingresá ${label}.`)
    .int(`${label[0]?.toUpperCase()}${label.slice(1)} tiene que ser un número entero.`)
    .min(min, `${label[0]?.toUpperCase()}${label.slice(1)} tiene que ser al menos ${min}.`)
    .max(max, `${label[0]?.toUpperCase()}${label.slice(1)} no puede superar ${max}.`);

export const moneyField = (label: string) =>
  z
    .string(`Ingresá ${label}.`)
    .transform((v, ctx) => {
      const cents = parseARS(v);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: "custom", message: `Ingresá ${label} válido (por ejemplo 1.234,50).` });
        return z.NEVER;
      }
      return cents;
    });

const optionalMoney = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || v.trim() === "") return null;
    const cents = parseARS(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Ingresá un precio válido (por ejemplo 1.234,50)." });
      return z.NEVER;
    }
    return cents;
  });

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("1"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

export const localDateTime = (label: string) =>
  z.string(`Elegí ${label}.`).transform((v, ctx) => {
    const d = parseLocalDateTimeAR(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: `Elegí ${label} válida.` });
      return z.NEVER;
    }
    return d;
  });

const optionalLocalDateTime = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = parseLocalDateTimeAR(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Fecha inválida." });
      return z.NEVER;
    }
    return d;
  });

/** Zonas como "provinciaId:localidadId" o "provinciaId:*" (toda la provincia). */
export const zonesField = z
  .array(z.string())
  .default([])
  .transform((arr, ctx) => {
    const zones = [];
    for (const raw of arr) {
      const m = /^(\d{1,3}):(\d{1,7}|\*)$/.exec(raw);
      if (!m) {
        ctx.addIssue({ code: "custom", message: "Zona inválida." });
        return z.NEVER;
      }
      zones.push({ provinceId: Number(m[1]), localityId: m[2] === "*" ? null : Number(m[2]) });
    }
    return zones;
  });

export const emailField = z
  .string("Ingresá tu email.")
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email("Ingresá un email válido.").max(191));

export const passwordField = z
  .string("Ingresá una contraseña.")
  .min(8, "La contraseña tiene que tener al menos 8 caracteres.")
  .max(72, "La contraseña puede tener hasta 72 caracteres.")
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), "Usá al menos una letra y un número.");

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Ingresá tu contraseña.").max(200),
  callbackUrl: z.string().optional(),
});

export const IVA_OPTIONS = {
  RESPONSABLE_INSCRIPTO: "Responsable inscripto",
  MONOTRIBUTO: "Monotributo",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor final",
} as const;

export const businessSchema = z.object({
  legalName: line(2, 160, "la razón social"),
  tradeName: line(2, 160, "el nombre de tu negocio"),
  cuit: z
    .string("Ingresá el CUIT.")
    .transform(normalizeCuit)
    .refine(isValidCuit, "El CUIT no es válido (revisá los 11 números)."),
  ivaCondition: z.enum(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO", "CONSUMIDOR_FINAL"], "Elegí la condición frente al IVA."),
  street: line(2, 160, "la calle"),
  streetNumber: line(1, 20, "la altura"),
  floorApt: optionalLine(40),
  postalCode: optionalLine(10).refine((v) => v === null || /^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/.test(v), "Código postal inválido (ej. 1414 o C1414ABC)."),
  provinceId: intField("la provincia", 1, 999),
  localityId: intField("la localidad", 1, 9_999_999),
  phone: optionalLine(40),
  description: optionalMultiline(2000),
  coverage: zonesField,
});

export const registerSchema = z
  .object({
    role: z.enum(["COMERCIO", "PREVENTISTA"], "Elegí si sos comercio o preventista."),
    name: line(2, 120, "tu nombre"),
    email: emailField,
    password: passwordField,
    passwordConfirm: z.string(),
    phone: optionalLine(40),
    terms: checkbox.refine((v) => v, "Tenés que aceptar las condiciones de uso."),
  })
  .and(businessSchema)
  .refine((d) => d.password === d.passwordConfirm, { message: "Las contraseñas no coinciden.", path: ["passwordConfirm"] });

export const completeProfileSchema = z
  .object({
    role: z.enum(["COMERCIO", "PREVENTISTA"], "Elegí si sos comercio o preventista."),
    phone: optionalLine(40),
  })
  .and(businessSchema);

export const profileSchema = businessSchema.omit({ cuit: true }).extend({ name: line(2, 120, "tu nombre") });

export const resetRequestSchema = z.object({ email: emailField });
export const resetPasswordSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordField, passwordConfirm: z.string() })
  .refine((d) => d.password === d.passwordConfirm, { message: "Las contraseñas no coinciden.", path: ["passwordConfirm"] });

export const productSchema = z.object({
  name: line(2, 160, "el nombre"),
  brand: optionalLine(80),
  description: optionalMultiline(2000),
  sku: z
    .string("Ingresá el SKU.")
    .transform((v) => v.trim())
    .pipe(z.string().regex(/^[A-Za-z0-9._-]{1,60}$/, "El SKU admite letras, números, punto, guion y guion bajo (hasta 60).")),
  ean: optionalLine(14).refine((v) => v === null || /^\d{8,14}$/.test(v), "El EAN tiene 8 a 14 números."),
  categoryId: z.string().min(1, "Elegí una categoría."),
  saleUnit: z.enum(["UNIDAD", "BULTO"]),
  unitsPerPack: intField("las unidades por bulto", 1, 10_000),
  price: moneyField("un precio"),
  retailPrice: optionalMoney,
  minOrderQty: intField("el pedido mínimo", 1, 10_000),
  active: checkbox,
});

export const poolSchema = z.object({
  productId: z.string().min(1, "Elegí un producto."),
  title: line(4, 160, "el título"),
  description: optionalMultiline(3000),
  price: moneyField("el precio por unidad"),
  retailPrice: moneyField("el precio minorista de referencia"),
  totalUnits: intField("el total de unidades", 1, 1_000_000),
  minUnitsToClose: intField("el mínimo para cerrar", 1, 1_000_000),
  minPerCommerce: intField("el mínimo por comercio", 1, 1_000_000),
  maxPerCommerce: intField("el máximo por comercio", 1, 1_000_000),
  closeOnMinimum: checkbox,
  deadlineAt: localDateTime("la fecha límite"),
  estimatedDeliveryAt: optionalLocalDateTime,
  zones: zonesField.refine((z) => z.length > 0, "Elegí al menos una zona de entrega."),
});

export const joinSchema = z.object({
  poolId: z.string().min(1).max(40),
  quantity: z.coerce.number().int("La cantidad tiene que ser un número entero.").min(0).max(1_000_000),
});

export const percentField = z.string().transform((v, ctx) => {
  const bps = parsePercentToBps(v);
  if (bps === null || bps > 5_000) {
    ctx.addIssue({ code: "custom", message: "Ingresá un porcentaje entre 0 y 50, con hasta 2 decimales (ej. 8,5)." });
    return z.NEVER;
  }
  return bps;
});

export const optionalPercentField = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || v.trim() === "") return null;
    const bps = parsePercentToBps(v);
    if (bps === null || bps > 5_000) {
      ctx.addIssue({ code: "custom", message: "Porcentaje inválido (0 a 50, hasta 2 decimales)." });
      return z.NEVER;
    }
    return bps;
  });

export const commissionSettingsSchema = z.object({
  globalPercent: percentField,
  mode: z.enum(["DESCONTAR_AL_PREVENTISTA", "SUMAR_AL_COMERCIO"]),
  catalogCommissionEnabled: checkbox,
});

export const operationalSettingsSchema = z.object({
  paymentWindowHours: intField("el plazo de pago", 1, 240),
  unpaidRule: z.enum(["REABRIR", "CERRAR_CON_PAGADO"]),
  reopenExtensionHours: intField("la extensión al reabrir", 1, 720),
  expiredDecisionHours: intField("la ventana de decisión", 1, 720),
  poolApprovalRequired: checkbox,
});

/** Convierte FormData en objeto; las claves terminadas en [] se agrupan en arrays. */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value !== "string") continue;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      const arr = (out[k] as string[] | undefined) ?? [];
      arr.push(value);
      out[k] = arr;
    } else if (!key.startsWith("$ACTION")) {
      out[key] = value;
    }
  }
  return out;
}

/** Errores de Zod → { campo: mensaje } (primer error de cada campo). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    fields[key] ??= issue.message;
  }
  return fields;
}
