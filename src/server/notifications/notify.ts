import "server-only";
import { type db } from "../db";
import { getEnv } from "../env";
import { enqueue } from "../jobs/queue";
import type { Tx } from "../tx";
import { renderEmail } from "./templates";

/** Eventos que generan notificación (in-app + email, y WhatsApp cuando se habilite). */
export const NOTIFICATION_TYPES = {
  NUEVO_POOL_EN_ZONA: "NUEVO_POOL_EN_ZONA",
  POOL_80: "POOL_80",
  POOL_COMPLETO: "POOL_COMPLETO",
  LINK_DE_PAGO: "LINK_DE_PAGO",
  PAGO_APROBADO: "PAGO_APROBADO",
  PAGO_VENCIDO: "PAGO_VENCIDO",
  POOL_VENCIDO: "POOL_VENCIDO",
  POOL_EXTENDIDO: "POOL_EXTENDIDO",
  POOL_REABIERTO: "POOL_REABIERTO",
  POOL_CANCELADO: "POOL_CANCELADO",
  POOL_PAGADO: "POOL_PAGADO",
  ENTREGA_PROGRAMADA: "ENTREGA_PROGRAMADA",
  ENTREGADO: "ENTREGADO",
  REINTEGRO: "REINTEGRO",
  PEDIDO_NUEVO: "PEDIDO_NUEVO",
  PEDIDO_ACTUALIZADO: "PEDIDO_ACTUALIZADO",
  CUENTA_APROBADA: "CUENTA_APROBADA",
  CUENTA_RECHAZADA: "CUENTA_RECHAZADA",
  PREVENTISTA_PENDIENTE: "PREVENTISTA_PENDIENTE",
  POOL_PARA_APROBAR: "POOL_PARA_APROBAR",
  POOL_REVISADO: "POOL_REVISADO",
  DISPUTA: "DISPUTA",
  LIQUIDACION: "LIQUIDACION",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export interface NotifyInput {
  userIds: readonly string[];
  type: NotificationType;
  title: string;
  body: string;
  /** Ruta interna (por ejemplo /pools/abc). */
  link?: string;
  ctaLabel?: string;
  /** Enviar también por email (por defecto, sí). */
  email?: boolean;
}

/**
 * Crea las notificaciones in-app y encola los emails en la misma transacción.
 * El worker envía los emails (con reintentos) para no demorar la respuesta al usuario.
 */
export async function notify(client: Tx | typeof db, input: NotifyInput): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return;
  await client.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body,
      link: input.link ?? null,
    })),
  });
  if (input.email === false) return;
  const users = await client.user.findMany({
    where: { id: { in: userIds }, status: "ACTIVO" },
    select: { email: true },
  });
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  const content = renderEmail({
    title: input.title,
    body: input.body,
    ctaLabel: input.ctaLabel ?? (input.link ? "Ver en PEDILA" : undefined),
    ctaUrl: input.link ? `${appUrl}${input.link}` : undefined,
    appUrl,
  });
  for (const u of users) {
    await enqueue(client, "SEND_EMAIL", { to: u.email, ...content });
  }
}

export async function adminUserIds(client: Tx | typeof db): Promise<string[]> {
  const admins = await client.user.findMany({ where: { role: "ADMIN", status: "ACTIVO" }, select: { id: true } });
  return admins.map((a) => a.id);
}
