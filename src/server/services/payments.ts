import "server-only";
import type { Payment } from "@/generated/prisma/client";
import { DomainError } from "@/domain/errors";
import { formatARS, toCents } from "@/domain/money";
import { audit, SYSTEM_ACTOR, type Actor } from "../audit";
import { db } from "../db";
import { getEnv } from "../env";
import { enqueue } from "../jobs/queue";
import { logger } from "../logger";
import { adminUserIds, NOTIFICATION_TYPES, notify } from "../notifications/notify";
import { getProvider } from "../payments";
import type { ProviderName, ProviderPaymentInfo, WebhookRequest } from "../payments/provider";
import { lockOrder, lockPayment, lockPool } from "../repos/locks";
import { withTx, type Tx } from "../tx";
import { evaluateClosedPoolInTx, releaseUnpaidParticipationInTx } from "./pools";
import { upsertOrderSettlement } from "./settlements";

const c = toCents;

function appUrl(): string {
  return getEnv().APP_URL.replace(/\/$/, "");
}

/** Crea (si hace falta) la preferencia de pago en el proveedor y devuelve la URL de checkout. */
export async function ensureCheckout(paymentId: string): Promise<string> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      commerce: { include: { user: { select: { email: true, name: true } } } },
      participation: { include: { pool: { select: { title: true } } } },
      order: { select: { number: true } },
    },
  });
  if (!payment) throw new DomainError("NO_ENCONTRADO", "Pago inexistente.");
  if (payment.status !== "PENDIENTE" && payment.status !== "EN_PROCESO") {
    throw new DomainError("NO_PAGABLE", "Este pago ya no se puede abonar.");
  }
  if (payment.dueAt && payment.dueAt.getTime() <= Date.now()) {
    throw new DomainError("VENCIDO", "El plazo para pagar ya venció.");
  }
  if (payment.checkoutUrl) return payment.checkoutUrl;
  const provider = getProvider(payment.provider as ProviderName);
  const title = payment.participation
    ? `PEDILA · Pool: ${payment.participation.pool.title} (${payment.participation.quantity} u.)`
    : `PEDILA · Pedido #${payment.order?.number ?? ""}`;
  const result = await provider.createCheckout({
    paymentId: payment.id,
    title,
    description: title,
    amountCents: c(payment.amountCents),
    payerEmail: payment.commerce.user.email,
    payerName: payment.commerce.user.name,
    dueAt: payment.dueAt,
    returnUrl: `${appUrl()}/comercio/pagos/${payment.id}`,
    // source_news=webhooks: MP envía solo notificaciones en formato Webhooks (firmadas).
    notificationUrl: `${appUrl()}/api/webhooks/mercadopago?source_news=webhooks`,
  });
  await db.payment.update({
    where: { id: payment.id },
    data: { providerPreferenceId: result.providerPreferenceId, checkoutUrl: result.checkoutUrl },
  });
  return result.checkoutUrl;
}

export type ApplyOutcome = "aplicado" | "duplicado" | "ignorado" | "reintegro" | "monto_inconsistente";

/** Bloquea en orden (pool/pedido → pago) para no generar deadlocks con las altas de participación. */
async function lockForPayment(tx: Tx, paymentId: string): Promise<Payment | null> {
  const head = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { participation: { select: { poolId: true } }, orderId: true },
  });
  if (!head) return null;
  if (head.participation) await lockPool(tx, head.participation.poolId);
  if (head.orderId) await lockOrder(tx, head.orderId);
  await lockPayment(tx, paymentId);
  return tx.payment.findUnique({ where: { id: paymentId } });
}

/**
 * Aplica una novedad del proveedor sobre un pago de PEDILA. Es idempotente: se puede
 * llamar varias veces con el mismo dato (los webhooks se reintentan) sin efectos dobles.
 */
export async function applyProviderUpdate(
  paymentId: string,
  info: ProviderPaymentInfo,
  actor: Actor = SYSTEM_ACTOR,
): Promise<ApplyOutcome> {
  return withTx(async (tx) => {
    const payment = await lockForPayment(tx, paymentId);
    if (!payment) return "ignorado";

    if (info.state === "APPROVED") {
      if (payment.status === "APROBADO" || payment.status === "REINTEGRADO") return "duplicado";
      if (info.amountCents !== null && info.amountCents !== c(payment.amountCents)) {
        await tx.payment.update({ where: { id: payment.id }, data: { providerStatus: "monto_inconsistente" } });
        await audit(tx, actor, {
          action: "pago.monto_inconsistente",
          entityType: "PAYMENT",
          entityId: payment.id,
          summary: `Esperado ${c(payment.amountCents)}, recibido ${info.amountCents}`,
        });
        await notify(tx, {
          userIds: await adminUserIds(tx),
          type: NOTIFICATION_TYPES.DISPUTA,
          title: "Pago con monto inconsistente",
          body: `El pago ${payment.id} llegó con un monto distinto al esperado. Revisalo en Mercado Pago.`,
          link: "/admin/auditoria",
        });
        return "monto_inconsistente";
      }
      const late = payment.status === "VENCIDO" || payment.status === "CANCELADO";
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "APROBADO",
          paidAt: info.paidAt ?? new Date(),
          providerPaymentId: info.providerPaymentId,
          providerStatus: info.providerStatus,
        },
      });
      await audit(tx, actor, {
        action: "pago.aprobado",
        entityType: "PAYMENT",
        entityId: payment.id,
        summary: `${formatARS(c(payment.amountCents))} vía ${payment.provider}${late ? " (fuera de plazo)" : ""}`,
      });
      if (late) {
        // Llegó después de vencer: las unidades ya se liberaron, se devuelve el dinero.
        await enqueue(tx, "REFUND_PAYMENT", { paymentId: payment.id, reason: "pago recibido fuera de plazo" });
        return "reintegro";
      }
      if (payment.participationId) await onPoolPaymentApproved(tx, payment, actor);
      if (payment.orderId) await onOrderPaymentApproved(tx, payment, actor);
      return "aplicado";
    }

    if (info.state === "PENDING") {
      if (payment.status !== "PENDIENTE") return "duplicado";
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "EN_PROCESO", providerPaymentId: info.providerPaymentId, providerStatus: info.providerStatus },
      });
      return "aplicado";
    }

    if (info.state === "REJECTED" || info.state === "CANCELLED") {
      // Un intento rechazado no cierra el pago: el comercio puede reintentar con otro medio.
      if (payment.status !== "PENDIENTE" && payment.status !== "EN_PROCESO") return "ignorado";
      if (payment.providerStatus === info.providerStatus && payment.status === "PENDIENTE") return "duplicado";
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "PENDIENTE", providerStatus: info.providerStatus },
      });
      const commerce = await tx.business.findUniqueOrThrow({ where: { id: payment.commerceId }, select: { userId: true } });
      await notify(tx, {
        userIds: [commerce.userId],
        type: NOTIFICATION_TYPES.LINK_DE_PAGO,
        title: "Tu pago no se pudo acreditar",
        body: "El intento de pago fue rechazado. Podés volver a intentarlo con otro medio antes de que venza el plazo.",
        link: `/comercio/pagos/${payment.id}`,
        ctaLabel: "Reintentar pago",
      });
      return "aplicado";
    }

    // REFUNDED desde el proveedor (por ejemplo, contracargo o devolución manual en MP).
    if (payment.status === "REINTEGRADO") return "duplicado";
    await tx.payment.update({ where: { id: payment.id }, data: { status: "REINTEGRADO", refundedAt: new Date(), providerStatus: info.providerStatus } });
    await audit(tx, actor, { action: "pago.reintegrado_externo", entityType: "PAYMENT", entityId: payment.id, summary: info.providerStatus });
    await notify(tx, {
      userIds: await adminUserIds(tx),
      type: NOTIFICATION_TYPES.DISPUTA,
      title: "Reintegro informado por el proveedor",
      body: `El pago ${payment.id} figura como devuelto en ${payment.provider}. Revisá el pool o pedido asociado.`,
      link: "/admin/auditoria",
    });
    return "aplicado";
  });
}

async function onPoolPaymentApproved(tx: Tx, payment: Payment, actor: Actor): Promise<void> {
  const part = await tx.participation.findUniqueOrThrow({
    where: { id: payment.participationId! },
    include: { pool: { select: { id: true, title: true } }, commerce: { select: { userId: true } } },
  });
  if (part.status === "PENDIENTE_PAGO") {
    await tx.participation.update({ where: { id: part.id }, data: { status: "PAGADA", paidAt: new Date() } });
  } else if (part.status !== "PAGADA") {
    // Participación liberada o cancelada mientras se pagaba: se reintegra.
    await enqueue(tx, "REFUND_PAYMENT", { paymentId: payment.id, reason: `participación en estado ${part.status}` });
    return;
  }
  await notify(tx, {
    userIds: [part.commerce.userId],
    type: NOTIFICATION_TYPES.PAGO_APROBADO,
    title: "¡Recibimos tu pago!",
    body: `Pagaste ${formatARS(c(payment.amountCents))} del pool "${part.pool.title}". Te avisamos cuando se programe la entrega.`,
    link: "/comercio/pools",
  });
  await evaluateClosedPoolInTx(tx, part.poolId, actor);
}

async function onOrderPaymentApproved(tx: Tx, payment: Payment, actor: Actor): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: payment.orderId! },
    include: { distributor: { select: { userId: true } }, commerce: { select: { userId: true, tradeName: true } } },
  });
  if (order.status !== "PENDIENTE_PAGO") {
    await enqueue(tx, "REFUND_PAYMENT", { paymentId: payment.id, reason: `pedido en estado ${order.status}` });
    return;
  }
  await tx.order.update({ where: { id: order.id }, data: { status: "PAGADO", paidAt: new Date() } });
  await upsertOrderSettlement(tx, order.id);
  await audit(tx, actor, { action: "pedido.pagado", entityType: "ORDER", entityId: order.id, summary: `Pedido #${order.number}` });
  await notify(tx, {
    userIds: [order.distributor.userId],
    type: NOTIFICATION_TYPES.PEDIDO_ACTUALIZADO,
    title: `Pedido #${order.number} pagado`,
    body: `${order.commerce.tradeName} pagó su pedido. Programá la entrega.`,
    link: `/preventista/pedidos`,
  });
  await notify(tx, {
    userIds: [order.commerce.userId],
    type: NOTIFICATION_TYPES.PAGO_APROBADO,
    title: "¡Recibimos tu pago!",
    body: `Tu pedido #${order.number} quedó confirmado.`,
    link: `/comercio/pedidos`,
  });
}

/** Procesa un webhook de Mercado Pago con deduplicación por evento. */
export async function processMercadoPagoWebhook(req: WebhookRequest): Promise<{ status: number; result: string }> {
  const provider = getProvider("mercadopago");
  const parsed = provider.parseWebhook(req);
  if (parsed.signatureValid === false) {
    logger.warn("Webhook de Mercado Pago con firma inválida", { eventKey: parsed.eventKey });
    return { status: 401, result: "firma inválida" };
  }
  // Idempotencia a nivel evento: si ya se procesó, se responde 200 sin hacer nada.
  try {
    await db.webhookEvent.create({
      data: {
        provider: "mercadopago",
        eventKey: parsed.eventKey,
        topic: parsed.topic,
        resourceId: parsed.resourceId,
        payload: req.rawBody.slice(0, 20_000),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { status: 200, result: "duplicado" };
    throw err;
  }
  if (parsed.topic !== "payment" || !parsed.resourceId) {
    await db.webhookEvent.update({
      where: { provider_eventKey: { provider: "mercadopago", eventKey: parsed.eventKey } },
      data: { processedAt: new Date(), result: "ignorado (tópico sin acción)" },
    });
    return { status: 200, result: "ignorado" };
  }
  try {
    // Nunca se confía en el cuerpo del webhook: el estado se consulta a la API de MP.
    const info = await provider.getPayment(parsed.resourceId);
    let outcome: ApplyOutcome = "ignorado";
    if (info.externalReference) outcome = await applyProviderUpdate(info.externalReference, info);
    await db.webhookEvent.update({
      where: { provider_eventKey: { provider: "mercadopago", eventKey: parsed.eventKey } },
      data: { processedAt: new Date(), result: `${info.state} → ${outcome}` },
    });
    return { status: 200, result: outcome };
  } catch (err) {
    // Se borra el registro para que el reintento de MP vuelva a procesarlo.
    await db.webhookEvent
      .delete({ where: { provider_eventKey: { provider: "mercadopago", eventKey: parsed.eventKey } } })
      .catch(() => undefined);
    logger.error("Error procesando webhook de Mercado Pago", { err });
    return { status: 500, result: "error" };
  }
}

/** Ejecuta el reintegro en el proveedor (lo llama el worker). */
export async function refundPayment(paymentId: string, reason: string): Promise<void> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { commerce: { select: { userId: true } } } });
  if (!payment || payment.status === "REINTEGRADO") return;
  if (payment.status !== "APROBADO") return;
  if (payment.providerPaymentId) {
    const res = await getProvider(payment.provider as ProviderName).refund(payment.providerPaymentId, `refund-${payment.id}`);
    if (!res.ok) throw new Error(`El proveedor rechazó el reintegro: ${res.info}`);
  }
  await withTx(async (tx) => {
    const locked = await lockForPayment(tx, paymentId);
    if (!locked || locked.status !== "APROBADO") return;
    await tx.payment.update({ where: { id: paymentId }, data: { status: "REINTEGRADO", refundedAt: new Date() } });
    await audit(tx, SYSTEM_ACTOR, {
      action: "pago.reintegro",
      entityType: "PAYMENT",
      entityId: paymentId,
      summary: `${formatARS(c(payment.amountCents))}: ${reason}`,
    });
    await notify(tx, {
      userIds: [payment.commerce.userId],
      type: NOTIFICATION_TYPES.REINTEGRO,
      title: "Te reintegramos un pago",
      body: `Devolvimos ${formatARS(c(payment.amountCents))} (${reason}). Puede tardar unos días en verse según el medio de pago.`,
      link: "/comercio/pagos",
    });
  });
}

/** Job: vence los pagos fuera de plazo, libera unidades y aplica la regla configurada. */
export async function runPaymentExpiry(now = new Date()): Promise<number> {
  const graceMs = 24 * 3_600_000; // un pago "en proceso" (ej. efectivo en Rapipago) tiene 24 h extra
  const overdue = await db.payment.findMany({
    where: {
      OR: [
        { status: "PENDIENTE", dueAt: { lte: now } },
        { status: "EN_PROCESO", dueAt: { lte: new Date(now.getTime() - graceMs) } },
      ],
    },
    select: { id: true },
    take: 300,
  });
  let n = 0;
  for (const { id } of overdue) {
    try {
      await withTx(async (tx) => {
        const payment = await lockForPayment(tx, id);
        if (!payment || (payment.status !== "PENDIENTE" && payment.status !== "EN_PROCESO")) return;
        await tx.payment.update({ where: { id }, data: { status: "VENCIDO" } });
        await audit(tx, SYSTEM_ACTOR, { action: "pago.vencido", entityType: "PAYMENT", entityId: id, summary: "Plazo de pago vencido" });
        if (payment.participationId) {
          const part = await tx.participation.findUniqueOrThrow({ where: { id: payment.participationId }, select: { poolId: true } });
          await releaseUnpaidParticipationInTx(tx, payment.participationId, SYSTEM_ACTOR);
          await evaluateClosedPoolInTx(tx, part.poolId, SYSTEM_ACTOR);
        }
        if (payment.orderId) {
          const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: { commerce: { select: { userId: true } } } });
          if (order.status === "PENDIENTE_PAGO") {
            await tx.order.update({ where: { id: order.id }, data: { status: "CANCELADO", cancelledAt: now, cancelReason: "Pago vencido" } });
            await notify(tx, {
              userIds: [order.commerce.userId],
              type: NOTIFICATION_TYPES.PAGO_VENCIDO,
              title: `Se venció el pago del pedido #${order.number}`,
              body: "El pedido se canceló porque no registramos el pago a tiempo.",
              link: "/comercio/pedidos",
            });
          }
        }
        n++;
      });
    } catch (err) {
      logger.error("Error venciendo pago", { paymentId: id, err });
    }
  }
  return n;
}
