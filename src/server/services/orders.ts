import "server-only";
import type { Product } from "@/generated/prisma/client";
import { computeLine, computeUnitPricing, type UnitPricing } from "@/domain/commission";
import { DomainError } from "@/domain/errors";
import { formatARS, toCents } from "@/domain/money";
import { isInZone } from "@/domain/zones";
import { addHours, formatLongDateTimeAR } from "@/lib/dates";
import { audit } from "../audit";
import { getPlatformConfig } from "../config";
import { type db } from "../db";
import { activePaymentProvider } from "../env";
import { enqueue } from "../jobs/queue";
import { NOTIFICATION_TYPES, notify } from "../notifications/notify";
import { lockOrder } from "../repos/locks";
import { withTx, type Tx } from "../tx";
import { assertOwnerOrAdmin, requireBusiness, type UserActor } from "./actor";
import { getApplicableCommission } from "./commissions";

const c = toCents;

/**
 * Precio de catálogo que ve el comercio. Si la comisión de catálogo está desactivada
 * (valor por defecto) el comercio paga el precio del preventista y PEDILA no cobra.
 */
export async function catalogPricing(client: Tx | typeof db, product: Pick<Product, "distributorId" | "categoryId" | "priceCents">): Promise<UnitPricing> {
  const config = await getPlatformConfig(client);
  if (!config.catalogCommissionEnabled) {
    return computeUnitPricing(c(product.priceCents), 0, "DESCONTAR_AL_PREVENTISTA");
  }
  const commission = await getApplicableCommission(client, product.distributorId, product.categoryId);
  return computeUnitPricing(c(product.priceCents), commission.bps, commission.mode);
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export async function createOrder(
  actor: UserActor,
  input: { distributorId: string; lines: CartLine[]; notes: string | null },
): Promise<{ orderId: string; paymentId: string }> {
  if (actor.role !== "COMERCIO") throw new DomainError("SIN_PERMISO", "Solo los comercios pueden hacer pedidos.");
  const commerceId = requireBusiness(actor);
  const lines = input.lines.filter((l) => l.quantity > 0);
  if (lines.length === 0) throw new DomainError("CARRITO_VACIO", "Tu carrito está vacío.");
  if (lines.length > 100) throw new DomainError("CARRITO_GRANDE", "Máximo 100 productos por pedido.");
  return withTx(async (tx) => {
    const distributor = await tx.business.findUnique({ where: { id: input.distributorId }, include: { coverage: true, user: true } });
    if (!distributor || distributor.distributorStatus !== "APROBADO" || distributor.user.status !== "ACTIVO") {
      throw new DomainError("NO_DISPONIBLE", "Este preventista no está disponible.");
    }
    const commerce = await tx.business.findUniqueOrThrow({ where: { id: commerceId } });
    if (!isInZone(distributor.coverage, { provinceId: commerce.provinceId, localityId: commerce.localityId })) {
      throw new DomainError("FUERA_DE_ZONA", "Este preventista no reparte en la zona de tu negocio.");
    }
    const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, distributorId: distributor.id, active: true } });
    let subtotal = 0;
    let commission = 0;
    let net = 0;
    const items = [];
    for (const line of lines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) throw new DomainError("PRODUCTO", "Un producto del carrito ya no está disponible.");
      if (!Number.isInteger(line.quantity) || line.quantity < product.minOrderQty || line.quantity > 10_000) {
        throw new DomainError("CANTIDAD", `La cantidad mínima de "${product.name}" es ${product.minOrderQty}.`);
      }
      const pricing = await catalogPricing(tx, product);
      const amounts = computeLine(pricing, line.quantity);
      subtotal += amounts.totalCents;
      commission += amounts.commissionCents;
      net += amounts.netCents;
      items.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        saleUnit: product.saleUnit,
        quantity: line.quantity,
        unitPriceCents: BigInt(pricing.unitPriceCents),
        totalCents: BigInt(amounts.totalCents),
        commissionCents: BigInt(amounts.commissionCents),
        netCents: BigInt(amounts.netCents),
      });
    }
    const effectiveBps = subtotal > 0 ? Math.round((commission * 10_000) / subtotal) : 0;
    const order = await tx.order.create({
      data: {
        commerceId,
        distributorId: distributor.id,
        subtotalCents: BigInt(subtotal),
        commissionCents: BigInt(commission),
        netCents: BigInt(net),
        commissionBps: effectiveBps,
        notes: input.notes?.slice(0, 500) ?? null,
        items: { create: items },
      },
    });
    const config = await getPlatformConfig(tx);
    const dueAt = addHours(new Date(), config.paymentWindowHours);
    const payment = await tx.payment.create({
      data: {
        kind: "PEDIDO",
        commerceId,
        orderId: order.id,
        amountCents: BigInt(subtotal),
        commissionCents: BigInt(commission),
        netCents: BigInt(net),
        provider: activePaymentProvider(),
        dueAt,
      },
    });
    await enqueue(tx, "CREATE_CHECKOUT", { paymentId: payment.id });
    await audit(tx, actor, { action: "pedido.crear", entityType: "ORDER", entityId: order.id, summary: `Pedido #${order.number} por ${formatARS(subtotal)}` });
    await notify(tx, {
      userIds: [distributor.userId],
      type: NOTIFICATION_TYPES.PEDIDO_NUEVO,
      title: `Nuevo pedido #${order.number}`,
      body: `${commerce.tradeName} hizo un pedido por ${formatARS(subtotal)}. Se confirma cuando lo pague.`,
      link: "/preventista/pedidos",
    });
    await notify(tx, {
      userIds: [actor.id],
      type: NOTIFICATION_TYPES.LINK_DE_PAGO,
      title: `Tu pedido #${order.number} está listo para pagar`,
      body: `Total ${formatARS(subtotal)}. Tenés hasta el ${formatLongDateTimeAR(dueAt)} para pagarlo.`,
      link: `/comercio/pagos/${payment.id}`,
      ctaLabel: "Pagar ahora",
    });
    return { orderId: order.id, paymentId: payment.id };
  });
}

export async function cancelOrder(actor: UserActor, orderId: string, reason: string): Promise<void> {
  await withTx(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payments: true, commerce: { select: { userId: true } }, distributor: { select: { userId: true } } },
    });
    if (!order) throw new DomainError("NO_ENCONTRADO", "Pedido inexistente.");
    const isCommerce = actor.businessId === order.commerceId;
    if (!isCommerce) assertOwnerOrAdmin(actor, order.distributorId);
    if (isCommerce && order.status !== "PENDIENTE_PAGO") {
      throw new DomainError("NO_CANCELABLE", "El pedido ya está pagado: pedile la cancelación al preventista o abrí una disputa.");
    }
    if (order.status === "ENTREGADO" || order.status === "CANCELADO") {
      throw new DomainError("NO_CANCELABLE", "Este pedido ya no se puede cancelar.");
    }
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELADO", cancelledAt: new Date(), cancelReason: reason.slice(0, 500) } });
    for (const p of order.payments) {
      if (p.status === "PENDIENTE" || p.status === "EN_PROCESO") await tx.payment.update({ where: { id: p.id }, data: { status: "CANCELADO" } });
      if (p.status === "APROBADO") await enqueue(tx, "REFUND_PAYMENT", { paymentId: p.id, reason: `pedido #${order.number} cancelado` });
    }
    await tx.settlement.deleteMany({ where: { orderId, status: "PENDIENTE" } });
    await audit(tx, actor, { action: "pedido.cancelar", entityType: "ORDER", entityId: orderId, summary: reason });
    await notify(tx, {
      userIds: [isCommerce ? order.distributor.userId : order.commerce.userId],
      type: NOTIFICATION_TYPES.PEDIDO_ACTUALIZADO,
      title: `Pedido #${order.number} cancelado`,
      body: `Motivo: ${reason}`,
      link: isCommerce ? "/preventista/pedidos" : "/comercio/pedidos",
    });
  });
}

export async function scheduleOrderDelivery(actor: UserActor, orderId: string, date: Date): Promise<void> {
  await withTx(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { commerce: { select: { userId: true } } } });
    assertOwnerOrAdmin(actor, order.distributorId);
    if (order.status !== "PAGADO" && order.status !== "EN_ENTREGA") {
      throw new DomainError("NO_PERMITIDO", "Solo se programan entregas de pedidos pagados.");
    }
    await tx.order.update({ where: { id: orderId }, data: { status: "EN_ENTREGA", scheduledDeliveryAt: date } });
    await audit(tx, actor, { action: "pedido.programar", entityType: "ORDER", entityId: orderId, summary: date.toISOString() });
    await notify(tx, {
      userIds: [order.commerce.userId],
      type: NOTIFICATION_TYPES.ENTREGA_PROGRAMADA,
      title: "Entrega programada",
      body: `Tu pedido #${order.number} llega el ${formatLongDateTimeAR(date)}.`,
      link: "/comercio/entregas",
    });
  });
}

export async function markOrderDelivered(actor: UserActor, orderId: string): Promise<void> {
  await withTx(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { commerce: { select: { userId: true } } } });
    assertOwnerOrAdmin(actor, order.distributorId);
    if (order.status === "ENTREGADO") return;
    if (order.status !== "PAGADO" && order.status !== "EN_ENTREGA") {
      throw new DomainError("NO_PERMITIDO", "El pedido no está pagado.");
    }
    await tx.order.update({ where: { id: orderId }, data: { status: "ENTREGADO", deliveredAt: new Date() } });
    await audit(tx, actor, { action: "pedido.entregado", entityType: "ORDER", entityId: orderId, summary: `Pedido #${order.number}` });
    await notify(tx, {
      userIds: [order.commerce.userId],
      type: NOTIFICATION_TYPES.ENTREGADO,
      title: `¡Tu pedido #${order.number} fue entregado!`,
      body: "Contanos cómo te fue calificando al preventista.",
      link: "/comercio/entregas",
      ctaLabel: "Calificar",
    });
  });
}
