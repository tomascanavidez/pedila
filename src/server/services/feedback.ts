import "server-only";
import type { DisputeStatus } from "@/generated/prisma/enums";
import { DomainError } from "@/domain/errors";
import { audit } from "../audit";
import { db } from "../db";
import { adminUserIds, NOTIFICATION_TYPES, notify } from "../notifications/notify";
import { withTx, type Tx } from "../tx";
import { requireBusiness, type UserActor } from "./actor";

/** Calificaciones de preventistas (1 a 5) y disputas. */

async function recomputeRating(tx: Tx, distributorId: string) {
  const agg = await tx.rating.aggregate({ where: { distributorId }, _avg: { stars: true }, _count: true });
  await tx.business.update({
    where: { id: distributorId },
    data: { ratingAvg: agg._avg.stars ?? null, ratingCount: agg._count },
  });
}

export async function rateDelivery(
  actor: UserActor,
  input: { participationId?: string; orderId?: string; stars: number; comment: string | null },
) {
  const commerceId = requireBusiness(actor);
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new DomainError("CALIFICACION", "La calificación va de 1 a 5 estrellas.");
  }
  await withTx(async (tx) => {
    let distributorId: string;
    let poolId: string | null = null;
    if (input.participationId) {
      const p = await tx.participation.findUnique({ where: { id: input.participationId }, include: { pool: true } });
      if (!p || p.commerceId !== commerceId) throw new DomainError("NO_ENCONTRADO", "Participación inexistente.");
      if (p.status !== "ENTREGADA") throw new DomainError("NO_ENTREGADO", "Podés calificar cuando recibas el pedido.");
      distributorId = p.pool.distributorId;
      poolId = p.poolId;
    } else if (input.orderId) {
      const o = await tx.order.findUnique({ where: { id: input.orderId } });
      if (!o || o.commerceId !== commerceId) throw new DomainError("NO_ENCONTRADO", "Pedido inexistente.");
      if (o.status !== "ENTREGADO") throw new DomainError("NO_ENTREGADO", "Podés calificar cuando recibas el pedido.");
      distributorId = o.distributorId;
    } else {
      throw new DomainError("DATOS", "Falta indicar qué entrega calificás.");
    }
    try {
      await tx.rating.create({
        data: {
          commerceId,
          distributorId,
          poolId,
          participationId: input.participationId ?? null,
          orderId: input.orderId ?? null,
          stars: input.stars,
          comment: input.comment?.slice(0, 1000) ?? null,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new DomainError("YA_CALIFICADO", "Ya calificaste esta entrega.");
      throw err;
    }
    await recomputeRating(tx, distributorId);
  });
}

export const DISPUTE_REASONS = {
  NO_ENTREGADO: "No recibí el pedido",
  INCOMPLETO: "Llegó incompleto",
  DANADO: "Llegó dañado o vencido",
  COBRO: "Problema con el cobro",
  OTRO: "Otro motivo",
} as const;

export type DisputeReason = keyof typeof DISPUTE_REASONS;

export async function openDispute(
  actor: UserActor,
  input: { participationId?: string; orderId?: string; reason: DisputeReason; description: string },
) {
  const commerceId = requireBusiness(actor);
  return withTx(async (tx) => {
    let distributorId: string;
    let poolId: string | null = null;
    if (input.participationId) {
      const p = await tx.participation.findUnique({ where: { id: input.participationId }, include: { pool: true } });
      if (!p || p.commerceId !== commerceId) throw new DomainError("NO_ENCONTRADO", "Participación inexistente.");
      distributorId = p.pool.distributorId;
      poolId = p.poolId;
    } else if (input.orderId) {
      const o = await tx.order.findUnique({ where: { id: input.orderId } });
      if (!o || o.commerceId !== commerceId) throw new DomainError("NO_ENCONTRADO", "Pedido inexistente.");
      distributorId = o.distributorId;
    } else {
      throw new DomainError("DATOS", "Indicá el pool o pedido del reclamo.");
    }
    const open = await tx.dispute.count({
      where: {
        commerceId,
        status: { in: ["ABIERTA", "EN_REVISION"] },
        ...(input.participationId ? { participationId: input.participationId } : { orderId: input.orderId }),
      },
    });
    if (open > 0) throw new DomainError("YA_ABIERTA", "Ya tenés un reclamo abierto por esta compra.");
    const dispute = await tx.dispute.create({
      data: {
        openedById: actor.id,
        commerceId,
        distributorId,
        poolId,
        participationId: input.participationId ?? null,
        orderId: input.orderId ?? null,
        reason: input.reason,
        description: input.description.slice(0, 5000),
      },
    });
    const distributor = await tx.business.findUniqueOrThrow({ where: { id: distributorId }, select: { userId: true } });
    await notify(tx, {
      userIds: [...(await adminUserIds(tx)), distributor.userId],
      type: NOTIFICATION_TYPES.DISPUTA,
      title: "Nuevo reclamo de un comercio",
      body: `${DISPUTE_REASONS[input.reason]}: ${input.description.slice(0, 200)}`,
      link: "/admin/disputas",
    });
    await audit(tx, actor, { action: "disputa.abrir", entityType: "DISPUTE", entityId: dispute.id, summary: input.reason });
    return dispute;
  });
}

export async function respondDispute(actor: UserActor, disputeId: string, response: string) {
  const d = await db.dispute.findUnique({ where: { id: disputeId } });
  if (!d || d.distributorId !== actor.businessId) throw new DomainError("NO_ENCONTRADO", "Reclamo inexistente.");
  await db.dispute.update({
    where: { id: disputeId },
    data: { distributorResponse: response.slice(0, 5000), status: d.status === "ABIERTA" ? "EN_REVISION" : d.status },
  });
  await audit(db, actor, { action: "disputa.responder", entityType: "DISPUTE", entityId: disputeId });
}

export async function resolveDispute(actor: UserActor, disputeId: string, status: DisputeStatus, resolution: string) {
  if (actor.role !== "ADMIN") throw new DomainError("SIN_PERMISO", "Solo un administrador resuelve reclamos.");
  await withTx(async (tx) => {
    const d = await tx.dispute.findUnique({
      where: { id: disputeId },
      include: { commerce: { select: { userId: true } }, distributor: { select: { userId: true } } },
    });
    if (!d) throw new DomainError("NO_ENCONTRADO", "Reclamo inexistente.");
    const final = status === "RESUELTA" || status === "RECHAZADA";
    await tx.dispute.update({
      where: { id: disputeId },
      data: { status, resolution: resolution.slice(0, 5000), ...(final ? { resolvedAt: new Date(), resolvedById: actor.id } : {}) },
    });
    await audit(tx, actor, { action: "disputa.estado", entityType: "DISPUTE", entityId: disputeId, summary: `${d.status} → ${status}` });
    if (final) {
      await notify(tx, {
        userIds: [d.commerce.userId, d.distributor.userId],
        type: NOTIFICATION_TYPES.DISPUTA,
        title: status === "RESUELTA" ? "Se resolvió un reclamo" : "Se cerró un reclamo",
        body: resolution.slice(0, 500),
        link: "/notificaciones",
      });
    }
  });
}
