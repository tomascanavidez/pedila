import "server-only";
import type { Pool, Prisma } from "@/generated/prisma/client";
import type { ParticipationStatus, PoolStatus } from "@/generated/prisma/enums";
import { computeLine, computeUnitPricing } from "@/domain/commission";
import { DomainError, FieldErrors } from "@/domain/errors";
import { formatARS, toCents } from "@/domain/money";
import {
  ACTIVE_PARTICIPATION_STATUSES,
  assertParticipationTransition,
  assertPoolTransition,
  assertValidExtension,
  canAcceptBelowMinimum,
  canExtendDeadline,
  decideAfterCommit,
  decideAfterPayments,
  decideOnDeadline,
  reopenDeadline,
  validateParticipationChange,
  validatePoolDefinition,
  type PoolSnapshot,
} from "@/domain/pool-rules";
import { isInZone, normalizeZones, type ZoneRef } from "@/domain/zones";
import { addHours, formatDateTimeAR, formatLongDateTimeAR } from "@/lib/dates";
import { audit, SYSTEM_ACTOR, type Actor } from "../audit";
import { getPlatformConfig } from "../config";
import { db } from "../db";
import { activePaymentProvider } from "../env";
import { enqueue } from "../jobs/queue";
import { logger } from "../logger";
import { adminUserIds, NOTIFICATION_TYPES, notify } from "../notifications/notify";
import { lockPool } from "../repos/locks";
import { withTx, type Tx } from "../tx";
import { assertOwnerOrAdmin, requireBusiness, type UserActor } from "./actor";
import { getApplicableCommission } from "./commissions";
import { upsertPoolSettlement } from "./settlements";

const c = toCents;

export function toSnapshot(pool: Pool): PoolSnapshot {
  return {
    status: pool.status,
    totalUnits: pool.totalUnits,
    minUnitsToClose: pool.minUnitsToClose,
    minPerCommerce: pool.minPerCommerce,
    maxPerCommerce: pool.maxPerCommerce,
    committedUnits: pool.committedUnits,
    closeOnMinimum: pool.closeOnMinimum,
    deadlineAt: pool.deadlineAt,
    closedAt: pool.closedAt,
    notified80: pool.notified80,
  };
}

/** Bloquea el pool y lo devuelve actualizado. Debe ser lo primero dentro de la transacción. */
async function lockAndLoad(tx: Tx, poolId: string): Promise<Pool> {
  const found = await lockPool(tx, poolId);
  if (!found) throw new DomainError("NO_ENCONTRADO", "El pool no existe.");
  return tx.pool.findUniqueOrThrow({ where: { id: poolId } });
}

/** Cambia el estado validando la máquina de estados y deja registro en la auditoría. */
async function transition(
  tx: Tx,
  pool: Pool,
  to: PoolStatus,
  actor: Actor,
  data: Prisma.PoolUpdateInput,
  reason: string,
): Promise<Pool> {
  assertPoolTransition(pool.status, to);
  const updated = await tx.pool.update({ where: { id: pool.id }, data: { ...data, status: to } });
  await audit(tx, actor, {
    action: "pool.estado",
    entityType: "POOL",
    entityId: pool.id,
    summary: `${pool.status} → ${to}: ${reason}`,
    before: { status: pool.status, committedUnits: pool.committedUnits },
    after: { status: to, committedUnits: updated.committedUnits },
  });
  return updated;
}

async function participantUserIds(
  tx: Tx,
  poolId: string,
  statuses: readonly ParticipationStatus[] = ACTIVE_PARTICIPATION_STATUSES,
): Promise<string[]> {
  const parts = await tx.participation.findMany({
    where: { poolId, status: { in: [...statuses] } },
    select: { commerce: { select: { userId: true } } },
  });
  return parts.map((p) => p.commerce.userId);
}

async function distributorUserId(tx: Tx, distributorId: string): Promise<string> {
  const b = await tx.business.findUniqueOrThrow({ where: { id: distributorId }, select: { userId: true } });
  return b.userId;
}

const poolLink = (id: string) => `/pools/${id}`;
const managerLink = (id: string) => `/preventista/pools/${id}`;

// -----------------------------------------------------------------------------
// Alta y edición (BORRADOR)
// -----------------------------------------------------------------------------

export interface PoolFormInput {
  productId: string;
  title: string;
  description: string | null;
  priceInputCents: number;
  retailUnitPriceCents: number;
  totalUnits: number;
  minUnitsToClose: number;
  minPerCommerce: number;
  maxPerCommerce: number;
  closeOnMinimum: boolean;
  deadlineAt: Date;
  estimatedDeliveryAt: Date | null;
  zones: ZoneRef[];
}

async function validateZones(tx: Tx, zones: ZoneRef[]): Promise<ZoneRef[]> {
  const normalized = normalizeZones(zones);
  if (normalized.length === 0) throw new FieldErrors({ zones: "Elegí al menos una zona de entrega." });
  const localityIds = normalized.map((z) => z.localityId).filter((id): id is number => id !== null);
  const localities = await tx.locality.findMany({ where: { id: { in: localityIds } } });
  for (const z of normalized) {
    if (z.localityId === null) continue;
    const loc = localities.find((l) => l.id === z.localityId);
    if (!loc || loc.provinceId !== z.provinceId) throw new FieldErrors({ zones: "Hay una localidad que no corresponde a su provincia." });
  }
  const provinces = await tx.province.count({ where: { id: { in: [...new Set(normalized.map((z) => z.provinceId))] } } });
  if (provinces !== new Set(normalized.map((z) => z.provinceId)).size) throw new FieldErrors({ zones: "Provincia inválida." });
  return normalized;
}

export async function savePoolDraft(actor: UserActor, input: PoolFormInput, poolId?: string): Promise<Pool> {
  const distributorId = requireBusiness(actor);
  return withTx(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: input.productId, distributorId } });
    if (!product) throw new FieldErrors({ productId: "Elegí un producto de tu catálogo." });
    if (!product.active) throw new FieldErrors({ productId: "El producto está inactivo." });

    const commission = await getApplicableCommission(tx, distributorId, product.categoryId);
    const pricing = computeUnitPricing(input.priceInputCents, commission.bps, commission.mode);
    const errors = validatePoolDefinition(
      { ...input, unitPriceCents: pricing.unitPriceCents },
      new Date(),
    );
    if (Object.keys(errors).length) throw new FieldErrors(errors);
    const zones = await validateZones(tx, input.zones);
    const config = await getPlatformConfig(tx);

    const data = {
      productId: product.id,
      categoryId: product.categoryId,
      saleUnit: product.saleUnit,
      title: input.title,
      description: input.description,
      priceInputCents: BigInt(pricing.inputCents),
      unitPriceCents: BigInt(pricing.unitPriceCents),
      commissionUnitCents: BigInt(pricing.commissionUnitCents),
      netUnitCents: BigInt(pricing.netUnitCents),
      retailUnitPriceCents: BigInt(input.retailUnitPriceCents),
      commissionBps: commission.bps,
      commissionMode: commission.mode,
      commissionSource: commission.source,
      totalUnits: input.totalUnits,
      minUnitsToClose: input.minUnitsToClose,
      minPerCommerce: input.minPerCommerce,
      maxPerCommerce: input.maxPerCommerce,
      closeOnMinimum: input.closeOnMinimum,
      deadlineAt: input.deadlineAt,
      estimatedDeliveryAt: input.estimatedDeliveryAt,
      paymentWindowHours: config.paymentWindowHours,
      unpaidRule: config.unpaidRule,
    };

    if (poolId) {
      const existing = await lockAndLoad(tx, poolId);
      assertOwnerOrAdmin(actor, existing.distributorId);
      if (existing.status !== "BORRADOR") {
        throw new DomainError("NO_EDITABLE", "Solo se pueden editar pools en borrador.");
      }
      await tx.poolZone.deleteMany({ where: { poolId } });
      const updated = await tx.pool.update({
        where: { id: poolId },
        data: { ...data, zones: { create: zones } },
      });
      await audit(tx, actor, { action: "pool.editar", entityType: "POOL", entityId: poolId, summary: input.title });
      return updated;
    }
    const created = await tx.pool.create({
      data: { ...data, distributorId, status: "BORRADOR", zones: { create: zones } },
    });
    await audit(tx, actor, { action: "pool.crear", entityType: "POOL", entityId: created.id, summary: input.title });
    return created;
  });
}

// -----------------------------------------------------------------------------
// Publicación (congela la comisión) y aprobación del admin
// -----------------------------------------------------------------------------

export interface PublishResult {
  status: PoolStatus;
  commissionBps: number;
  commissionChanged: boolean;
}

export async function publishPool(actor: UserActor, poolId: string): Promise<PublishResult> {
  return withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    assertOwnerOrAdmin(actor, pool.distributorId);
    if (pool.status !== "BORRADOR") throw new DomainError("NO_PUBLICABLE", "Este pool ya fue publicado.");
    const distributor = await tx.business.findUniqueOrThrow({ where: { id: pool.distributorId } });
    if (distributor.distributorStatus !== "APROBADO") {
      throw new DomainError("NO_APROBADO", "Tu cuenta de preventista todavía no fue aprobada por PEDILA.");
    }
    const product = await tx.product.findUniqueOrThrow({ where: { id: pool.productId } });
    if (!product.active) throw new DomainError("PRODUCTO_INACTIVO", "El producto del pool está inactivo.");

    const config = await getPlatformConfig(tx);
    const commission = await getApplicableCommission(tx, pool.distributorId, pool.categoryId);
    const pricing = computeUnitPricing(c(pool.priceInputCents), commission.bps, commission.mode);
    const now = new Date();
    const errors = validatePoolDefinition(
      {
        totalUnits: pool.totalUnits,
        minUnitsToClose: pool.minUnitsToClose,
        minPerCommerce: pool.minPerCommerce,
        maxPerCommerce: pool.maxPerCommerce,
        deadlineAt: pool.deadlineAt,
        estimatedDeliveryAt: pool.estimatedDeliveryAt,
        unitPriceCents: pricing.unitPriceCents,
        retailUnitPriceCents: c(pool.retailUnitPriceCents),
      },
      now,
    );
    if (Object.keys(errors).length) throw new FieldErrors(errors, "Actualizá el pool antes de publicarlo.");

    const target: PoolStatus = config.poolApprovalRequired ? "PENDIENTE_APROBACION" : "ABIERTO";
    await transition(
      tx,
      pool,
      target,
      actor,
      {
        unitPriceCents: BigInt(pricing.unitPriceCents),
        commissionUnitCents: BigInt(pricing.commissionUnitCents),
        netUnitCents: BigInt(pricing.netUnitCents),
        commissionBps: commission.bps,
        commissionMode: commission.mode,
        commissionSource: commission.source,
        commissionFrozenAt: now,
        paymentWindowHours: config.paymentWindowHours,
        unpaidRule: config.unpaidRule,
        publishedAt: target === "ABIERTO" ? now : null,
        originalDeadlineAt: pool.deadlineAt,
      },
      `publicado con comisión ${commission.bps} bps (${commission.source}) congelada`,
    );
    if (target === "ABIERTO") {
      await enqueue(tx, "FANOUT_NEW_POOL", { poolId });
    } else {
      await notify(tx, {
        userIds: await adminUserIds(tx),
        type: NOTIFICATION_TYPES.POOL_PARA_APROBAR,
        title: "Hay un pool para aprobar",
        body: `${distributor.tradeName} publicó "${pool.title}".`,
        link: "/admin/pools?estado=PENDIENTE_APROBACION",
      });
    }
    return { status: target, commissionBps: commission.bps, commissionChanged: commission.bps !== pool.commissionBps };
  });
}

export async function reviewPool(actor: UserActor, poolId: string, approve: boolean, note: string | null): Promise<void> {
  if (actor.role !== "ADMIN") throw new DomainError("SIN_PERMISO", "Solo un administrador puede revisar pools.");
  await withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    if (pool.status !== "PENDIENTE_APROBACION") throw new DomainError("NO_PENDIENTE", "El pool no está pendiente de aprobación.");
    const owner = await distributorUserId(tx, pool.distributorId);
    if (approve) {
      if (pool.deadlineAt.getTime() < Date.now() + 3_600_000) {
        throw new DomainError("FECHA_VENCIDA", "La fecha límite está demasiado cerca: rechazalo para que el preventista la actualice.");
      }
      await transition(tx, pool, "ABIERTO", actor, { publishedAt: new Date(), reviewNote: note }, "aprobado por admin");
      await enqueue(tx, "FANOUT_NEW_POOL", { poolId });
    } else {
      await transition(tx, pool, "BORRADOR", actor, { reviewNote: note, commissionFrozenAt: null }, `rechazado: ${note ?? ""}`);
    }
    await notify(tx, {
      userIds: [owner],
      type: NOTIFICATION_TYPES.POOL_REVISADO,
      title: approve ? "¡Tu pool fue aprobado y ya está abierto!" : "Tu pool necesita cambios",
      body: approve ? `"${pool.title}" ya está visible para los comercios.` : `"${pool.title}" volvió a borrador. ${note ?? ""}`.trim(),
      link: managerLink(pool.id),
    });
  });
}

// -----------------------------------------------------------------------------
// Participaciones (sumarse, modificar, retirarse) — con SELECT ... FOR UPDATE
// -----------------------------------------------------------------------------

export interface ParticipationResult {
  participationId: string;
  quantity: number;
  status: PoolStatus;
  committedUnits: number;
  closed: boolean;
}

export async function changeParticipation(actor: UserActor, poolId: string, newQty: number): Promise<ParticipationResult> {
  if (actor.role !== "COMERCIO") throw new DomainError("SIN_PERMISO", "Solo los comercios pueden sumarse a un pool.");
  const commerceId = requireBusiness(actor);
  return withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    const commerce = await tx.business.findUniqueOrThrow({ where: { id: commerceId } });
    const zones = await tx.poolZone.findMany({ where: { poolId } });
    if (!isInZone(zones, { provinceId: commerce.provinceId, localityId: commerce.localityId })) {
      throw new DomainError("FUERA_DE_ZONA", "Este pool no entrega en la zona de tu negocio.");
    }

    const existing = await tx.participation.findUnique({ where: { poolId_commerceId: { poolId, commerceId } } });
    if (existing && ["PENDIENTE_PAGO", "PAGADA", "ENTREGADA"].includes(existing.status)) {
      throw new DomainError("YA_CONFIRMADA", "Tu participación ya está en etapa de pago y no se puede modificar.");
    }
    if (existing?.status === "CANCELADA") {
      throw new DomainError("CANCELADA", "Tu participación en este pool fue cancelada.");
    }
    const currentQty = existing?.status === "COMPROMETIDA" ? existing.quantity : 0;
    const now = new Date();
    const delta = validateParticipationChange(toSnapshot(pool), { currentQty, newQty, now });
    const newCommitted = pool.committedUnits + delta;

    const line = computeLine(
      { unitPriceCents: c(pool.unitPriceCents), commissionUnitCents: c(pool.commissionUnitCents), netUnitCents: c(pool.netUnitCents) },
      newQty,
    );
    const amounts = {
      quantity: newQty === 0 ? currentQty : newQty,
      unitPriceCents: pool.unitPriceCents,
      totalCents: BigInt(newQty === 0 ? 0 : line.totalCents),
      commissionCents: BigInt(newQty === 0 ? 0 : line.commissionCents),
      netCents: BigInt(newQty === 0 ? 0 : line.netCents),
    };

    let participationId: string;
    let action: string;
    if (!existing) {
      const created = await tx.participation.create({ data: { poolId, commerceId, status: "COMPROMETIDA", ...amounts } });
      participationId = created.id;
      action = "participacion.alta";
    } else if (newQty === 0) {
      assertParticipationTransition(existing.status, "RETIRADA");
      await tx.participation.update({ where: { id: existing.id }, data: { ...amounts, status: "RETIRADA", withdrawnAt: now } });
      participationId = existing.id;
      action = "participacion.baja";
    } else {
      if (existing.status !== "COMPROMETIDA") assertParticipationTransition(existing.status, "COMPROMETIDA");
      await tx.participation.update({
        where: { id: existing.id },
        data: { ...amounts, status: "COMPROMETIDA", withdrawnAt: null, releasedAt: null },
      });
      participationId = existing.id;
      action = existing.status === "COMPROMETIDA" ? "participacion.modificacion" : "participacion.alta";
    }

    const decision = decideAfterCommit(toSnapshot(pool), newCommitted);
    let updated = await tx.pool.update({
      where: { id: poolId },
      data: { committedUnits: newCommitted, ...(decision.crossed80 ? { notified80: true } : {}) },
    });
    await audit(tx, actor, {
      action,
      entityType: "POOL",
      entityId: poolId,
      summary: `${commerce.tradeName}: ${currentQty} → ${newQty} u. (comprometidas ${pool.committedUnits} → ${newCommitted})`,
    });

    const owner = await distributorUserId(tx, pool.distributorId);
    if (decision.crossed80) {
      await notify(tx, {
        userIds: [...(await participantUserIds(tx, poolId)), owner],
        type: NOTIFICATION_TYPES.POOL_80,
        title: `¡"${pool.title}" ya está al 80 %!`,
        body: `Faltan ${pool.minUnitsToClose - newCommitted} unidades para llegar al mínimo. Compartilo con otros comercios de tu zona.`,
        link: poolLink(poolId),
      });
    }
    if (decision.reachedMinimum) {
      updated = await transition(tx, updated, "COMPLETO", actor, { completedAt: now }, "se alcanzó el mínimo para cerrar");
      await notify(tx, {
        userIds: [...(await participantUserIds(tx, poolId)), owner],
        type: NOTIFICATION_TYPES.POOL_COMPLETO,
        title: `¡Se completó el pool "${pool.title}"!`,
        body: decision.shouldClose
          ? "Se alcanzó el mínimo y el pool se cerró. Te mandamos el link de pago."
          : `Se alcanzó el mínimo. El pool sigue sumando unidades hasta el ${formatDateTimeAR(pool.deadlineAt)} o hasta completar el total.`,
        link: poolLink(poolId),
      });
    }
    if (decision.shouldClose) {
      await closePoolInTx(tx, poolId, actor);
      updated = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
    }
    return {
      participationId,
      quantity: newQty,
      status: updated.status,
      committedUnits: updated.committedUnits,
      closed: updated.closedAt !== null,
    };
  });
}

// -----------------------------------------------------------------------------
// Cierre: genera los pagos de cada participación comprometida
// -----------------------------------------------------------------------------

/** Cierra un pool COMPLETO y emite los pagos. El pool debe estar bloqueado por el llamador. */
export async function closePoolInTx(tx: Tx, poolId: string, actor: Actor): Promise<void> {
  const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
  if (pool.status !== "COMPLETO" || pool.closedAt) return;
  const now = new Date();
  await tx.pool.update({ where: { id: poolId }, data: { closedAt: now } });
  await audit(tx, actor, {
    action: "pool.cierre",
    entityType: "POOL",
    entityId: poolId,
    summary: `Cerrado con ${pool.committedUnits} u. comprometidas; plazo de pago ${pool.paymentWindowHours} h`,
  });
  const toCharge = await tx.participation.findMany({
    where: { poolId, status: "COMPROMETIDA" },
    include: { commerce: { select: { userId: true } } },
  });
  const dueAt = addHours(now, pool.paymentWindowHours);
  const provider = activePaymentProvider();
  for (const p of toCharge) {
    await tx.participation.update({ where: { id: p.id }, data: { status: "PENDIENTE_PAGO" } });
    const payment = await tx.payment.create({
      data: {
        kind: "POOL",
        commerceId: p.commerceId,
        participationId: p.id,
        amountCents: p.totalCents,
        commissionCents: p.commissionCents,
        netCents: p.netCents,
        provider,
        status: "PENDIENTE",
        dueAt,
      },
    });
    await enqueue(tx, "CREATE_CHECKOUT", { paymentId: payment.id });
    await notify(tx, {
      userIds: [p.commerce.userId],
      type: NOTIFICATION_TYPES.LINK_DE_PAGO,
      title: "¡Se cerró el pool! Ya podés pagar",
      body: `El pool "${pool.title}" se cerró. Tenés tiempo hasta el ${formatLongDateTimeAR(dueAt)} para pagar ${formatARS(c(p.totalCents))} (${p.quantity} u.). Si no pagás a tiempo, tus unidades se liberan.`,
      link: `/comercio/pagos/${payment.id}`,
      ctaLabel: "Pagar ahora",
    });
  }
  await notify(tx, {
    userIds: [await distributorUserId(tx, pool.distributorId)],
    type: NOTIFICATION_TYPES.POOL_COMPLETO,
    title: `Tu pool "${pool.title}" se cerró`,
    body: `Se emitieron ${toCharge.length} pagos. Los comercios tienen ${pool.paymentWindowHours} h para pagar.`,
    link: managerLink(poolId),
  });
  if (toCharge.length === 0) await evaluateClosedPoolInTx(tx, poolId, actor);
}

// -----------------------------------------------------------------------------
// Evaluación luego de pagos (aprobado / vencido)
// -----------------------------------------------------------------------------

export async function evaluateClosedPoolInTx(tx: Tx, poolId: string, actor: Actor): Promise<PoolStatus> {
  const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
  if (pool.status !== "COMPLETO" || !pool.closedAt) return pool.status;
  const groups = await tx.participation.groupBy({ by: ["status"], where: { poolId }, _sum: { quantity: true } });
  const sum = (s: ParticipationStatus[]) =>
    groups.filter((g) => s.includes(g.status)).reduce((a, g) => a + (g._sum.quantity ?? 0), 0);
  const paidUnits = sum(["PAGADA", "ENTREGADA"]);
  const pendingUnits = sum(["PENDIENTE_PAGO"]);
  const committedOnly = sum(["COMPROMETIDA"]);
  const decision = decideAfterPayments({
    unpaidRule: pool.unpaidRule,
    acceptedBelowMinimum: pool.acceptedBelowMinimum,
    minUnitsToClose: pool.minUnitsToClose,
    paidUnits,
    pendingPaymentUnits: pendingUnits,
  });
  const now = new Date();
  const owner = await distributorUserId(tx, pool.distributorId);
  switch (decision) {
    case "WAIT":
      await tx.pool.update({ where: { id: poolId }, data: { paidUnits } });
      return pool.status;
    case "MARK_PAID": {
      await transition(tx, pool, "CERRADO_PAGADO", actor, { paidAt: now, paidUnits, committedUnits: paidUnits }, `pagado: ${paidUnits} u.`);
      await upsertPoolSettlement(tx, poolId);
      await notify(tx, {
        userIds: await participantUserIds(tx, poolId, ["PAGADA"]),
        type: NOTIFICATION_TYPES.POOL_PAGADO,
        title: `Compra confirmada: "${pool.title}"`,
        body: "Todos los pagos están listos. El preventista va a programar la entrega y te avisamos la fecha.",
        link: "/comercio/pools",
      });
      await notify(tx, {
        userIds: [owner],
        type: NOTIFICATION_TYPES.POOL_PAGADO,
        title: `¡Pool pagado! Prepará la entrega de "${pool.title}"`,
        body: `Se cobraron ${paidUnits} unidades. Programá la entrega y armá la hoja de reparto.`,
        link: managerLink(poolId),
      });
      return "CERRADO_PAGADO";
    }
    case "REOPEN": {
      const config = await getPlatformConfig(tx);
      const deadlineAt = reopenDeadline(pool.deadlineAt, now, config.reopenExtensionHours);
      await transition(
        tx,
        pool,
        "ABIERTO",
        actor,
        { closedAt: null, completedAt: null, paidUnits, committedUnits: paidUnits + committedOnly, deadlineAt },
        `reabierto por falta de pago (pagadas ${paidUnits} de ${pool.minUnitsToClose} mínimas)`,
      );
      await notify(tx, {
        userIds: [...(await participantUserIds(tx, poolId)), owner],
        type: NOTIFICATION_TYPES.POOL_REABIERTO,
        title: `El pool "${pool.title}" se reabrió`,
        body: `Algunos comercios no pagaron a tiempo y se liberaron unidades. El pool sigue abierto hasta el ${formatDateTimeAR(deadlineAt)}. Si ya pagaste, tu lugar está asegurado.`,
        link: poolLink(poolId),
      });
      return "ABIERTO";
    }
    case "CANCEL": {
      await transition(
        tx,
        pool,
        "CANCELADO",
        actor,
        { cancelledAt: now, cancelReason: "Ningún comercio completó el pago", committedUnits: 0, paidUnits: 0 },
        "nadie pagó",
      );
      await notify(tx, {
        userIds: [owner],
        type: NOTIFICATION_TYPES.POOL_CANCELADO,
        title: `Se canceló el pool "${pool.title}"`,
        body: "Ningún comercio completó el pago dentro del plazo.",
        link: managerLink(poolId),
      });
      return "CANCELADO";
    }
  }
}

/** Libera la participación de un pago vencido. El pool debe estar bloqueado. */
export async function releaseUnpaidParticipationInTx(tx: Tx, participationId: string, actor: Actor): Promise<void> {
  const p = await tx.participation.findUniqueOrThrow({
    where: { id: participationId },
    include: { pool: true, commerce: { select: { userId: true, tradeName: true } } },
  });
  if (p.status !== "PENDIENTE_PAGO") return;
  assertParticipationTransition(p.status, "LIBERADA");
  await tx.participation.update({ where: { id: p.id }, data: { status: "LIBERADA", releasedAt: new Date() } });
  await tx.pool.update({ where: { id: p.poolId }, data: { committedUnits: { decrement: p.quantity } } });
  await audit(tx, actor, {
    action: "participacion.liberada",
    entityType: "POOL",
    entityId: p.poolId,
    summary: `${p.commerce.tradeName} no pagó a tiempo: se liberan ${p.quantity} u.`,
  });
  await notify(tx, {
    userIds: [p.commerce.userId],
    type: NOTIFICATION_TYPES.PAGO_VENCIDO,
    title: "Se venció el plazo de pago",
    body: `No registramos tu pago del pool "${p.pool.title}" y tus ${p.quantity} unidades se liberaron.`,
    link: poolLink(p.poolId),
  });
}

// -----------------------------------------------------------------------------
// Vencimiento, extensión, cierre por debajo del mínimo y finalización
// -----------------------------------------------------------------------------

async function expirePoolInTx(tx: Tx, pool: Pool, actor: Actor): Promise<void> {
  const config = await getPlatformConfig(tx);
  const now = new Date();
  const decisionDeadlineAt = addHours(now, config.expiredDecisionHours);
  await transition(
    tx,
    pool,
    "VENCIDO_SIN_COMPLETAR",
    actor,
    { expiredAt: now, decisionDeadlineAt },
    `venció con ${pool.committedUnits} de ${pool.minUnitsToClose} u.`,
  );
  await notify(tx, {
    userIds: await participantUserIds(tx, pool.id),
    type: NOTIFICATION_TYPES.POOL_VENCIDO,
    title: `El pool "${pool.title}" venció sin completarse`,
    body: `Se llegó a ${pool.committedUnits} de ${pool.minUnitsToClose} unidades. No se te cobra nada. El preventista puede extender la fecha o cerrar igual hasta el ${formatDateTimeAR(decisionDeadlineAt)}; te avisamos lo que decida.`,
    link: poolLink(pool.id),
  });
  await notify(tx, {
    userIds: [await distributorUserId(tx, pool.distributorId)],
    type: NOTIFICATION_TYPES.POOL_VENCIDO,
    title: `Tu pool "${pool.title}" venció`,
    body: `Llegó a ${pool.committedUnits} de ${pool.minUnitsToClose} unidades. Podés extender la fecha una vez o aceptar cerrar con lo alcanzado hasta el ${formatDateTimeAR(decisionDeadlineAt)}.`,
    link: managerLink(pool.id),
  });
}

export async function extendPoolDeadline(actor: UserActor, poolId: string, newDeadline: Date): Promise<void> {
  await withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    assertOwnerOrAdmin(actor, pool.distributorId);
    const now = new Date();
    if (!canExtendDeadline(pool, now)) {
      throw new DomainError("NO_EXTENSIBLE", pool.extendedOnce ? "La fecha ya se extendió una vez." : "Este pool no se puede extender.");
    }
    assertValidExtension(newDeadline, now);
    await transition(
      tx,
      pool,
      "ABIERTO",
      actor,
      {
        deadlineAt: newDeadline,
        originalDeadlineAt: pool.originalDeadlineAt ?? pool.deadlineAt,
        extendedOnce: true,
        expiredAt: null,
        decisionDeadlineAt: null,
      },
      `fecha extendida hasta ${newDeadline.toISOString()}`,
    );
    await notify(tx, {
      userIds: await participantUserIds(tx, poolId),
      type: NOTIFICATION_TYPES.POOL_EXTENDIDO,
      title: `Se extendió el pool "${pool.title}"`,
      body: `El preventista extendió la fecha límite hasta el ${formatDateTimeAR(newDeadline)}. Tu participación sigue vigente; podés modificarla o retirarte mientras esté abierto.`,
      link: poolLink(poolId),
    });
  });
}

export async function acceptCloseBelowMinimum(actor: UserActor, poolId: string): Promise<void> {
  await withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    assertOwnerOrAdmin(actor, pool.distributorId);
    if (!canAcceptBelowMinimum(pool, new Date())) {
      throw new DomainError("NO_PERMITIDO", "No se puede cerrar este pool con lo alcanzado.");
    }
    await transition(
      tx,
      pool,
      "COMPLETO",
      actor,
      { acceptedBelowMinimum: true, completedAt: new Date(), decisionDeadlineAt: null },
      `el preventista acepta cerrar con ${pool.committedUnits} u.`,
    );
    await closePoolInTx(tx, poolId, actor);
  });
}

async function cancelParticipationsInTx(tx: Tx, poolId: string, actor: Actor, reason: string): Promise<string[]> {
  const parts = await tx.participation.findMany({
    where: { poolId, status: { in: [...ACTIVE_PARTICIPATION_STATUSES] } },
    include: { payments: true, commerce: { select: { userId: true } } },
  });
  for (const p of parts) {
    if (p.status === "ENTREGADA") continue;
    await tx.participation.update({ where: { id: p.id }, data: { status: "CANCELADA" } });
    for (const pay of p.payments) {
      if (pay.status === "PENDIENTE" || pay.status === "EN_PROCESO") {
        await tx.payment.update({ where: { id: pay.id }, data: { status: "CANCELADO" } });
      } else if (pay.status === "APROBADO") {
        await enqueue(tx, "REFUND_PAYMENT", { paymentId: pay.id, reason });
      }
    }
  }
  await audit(tx, actor, { action: "participaciones.canceladas", entityType: "POOL", entityId: poolId, summary: `${parts.length} participaciones: ${reason}` });
  return parts.map((p) => p.commerce.userId);
}

/** Pasada la ventana de decisión sin acción del preventista, el pool vencido queda cerrado y se reintegra lo pagado. */
async function finalizeExpiredPoolInTx(tx: Tx, pool: Pool, actor: Actor): Promise<void> {
  const users = await cancelParticipationsInTx(tx, pool.id, actor, "pool vencido sin completar");
  await tx.pool.update({ where: { id: pool.id }, data: { finalizedAt: new Date(), committedUnits: 0, paidUnits: 0 } });
  await audit(tx, actor, { action: "pool.finalizado", entityType: "POOL", entityId: pool.id, summary: "Vencido sin decisión del preventista" });
  await notify(tx, {
    userIds: users,
    type: NOTIFICATION_TYPES.POOL_VENCIDO,
    title: `El pool "${pool.title}" quedó sin efecto`,
    body: "El pool venció sin completarse y el preventista no lo extendió. No se te cobra nada y, si habías pagado, te reintegramos el dinero.",
    link: poolLink(pool.id),
  });
}

export async function cancelPool(actor: UserActor, poolId: string, reason: string): Promise<void> {
  await withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    assertOwnerOrAdmin(actor, pool.distributorId);
    const distributorAllowed: PoolStatus[] = ["BORRADOR", "PENDIENTE_APROBACION", "ABIERTO", "COMPLETO", "VENCIDO_SIN_COMPLETAR"];
    if (actor.role !== "ADMIN" && !distributorAllowed.includes(pool.status)) {
      throw new DomainError("NO_CANCELABLE", "Un pool ya pagado solo lo puede cancelar el equipo de PEDILA.");
    }
    await transition(tx, pool, "CANCELADO", actor, { cancelledAt: new Date(), cancelReason: reason.slice(0, 500), committedUnits: 0 }, reason);
    const users = await cancelParticipationsInTx(tx, poolId, actor, `pool cancelado: ${reason}`);
    await notify(tx, {
      userIds: users,
      type: NOTIFICATION_TYPES.POOL_CANCELADO,
      title: `Se canceló el pool "${pool.title}"`,
      body: `Motivo: ${reason}. No se te cobra nada y, si habías pagado, te reintegramos el dinero.`,
      link: poolLink(poolId),
    });
  });
}

// -----------------------------------------------------------------------------
// Entregas
// -----------------------------------------------------------------------------

export async function schedulePoolDelivery(actor: UserActor, poolId: string, date: Date): Promise<void> {
  await withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    assertOwnerOrAdmin(actor, pool.distributorId);
    if (date.getTime() < Date.now() - 3_600_000) throw new DomainError("FECHA_INVALIDA", "La fecha de entrega no puede ser pasada.");
    if (pool.status === "CERRADO_PAGADO") {
      await transition(tx, pool, "EN_ENTREGA", actor, { scheduledDeliveryAt: date }, "entrega programada");
    } else if (pool.status === "EN_ENTREGA") {
      await tx.pool.update({ where: { id: poolId }, data: { scheduledDeliveryAt: date } });
      await audit(tx, actor, { action: "pool.reprogramar", entityType: "POOL", entityId: poolId, summary: date.toISOString() });
    } else {
      throw new DomainError("NO_PERMITIDO", "Solo se programan entregas de pools pagados.");
    }
    await notify(tx, {
      userIds: await participantUserIds(tx, poolId, ["PAGADA"]),
      type: NOTIFICATION_TYPES.ENTREGA_PROGRAMADA,
      title: "Entrega programada",
      body: `Tu pedido del pool "${pool.title}" llega el ${formatLongDateTimeAR(date)}.`,
      link: "/comercio/entregas",
    });
  });
}

async function completeDeliveryIfDoneInTx(tx: Tx, poolId: string, actor: Actor): Promise<void> {
  const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId } });
  if (pool.status !== "CERRADO_PAGADO" && pool.status !== "EN_ENTREGA") return;
  const pending = await tx.participation.count({ where: { poolId, status: "PAGADA" } });
  if (pending === 0) {
    await transition(tx, pool, "ENTREGADO", actor, { deliveredAt: new Date() }, "todas las entregas realizadas");
  }
}

export async function markParticipationDelivered(actor: UserActor, participationId: string): Promise<void> {
  const part = await db.participation.findUnique({ where: { id: participationId }, select: { poolId: true } });
  if (!part) throw new DomainError("NO_ENCONTRADO", "Participación inexistente.");
  await withTx(async (tx) => {
    const pool = await lockAndLoad(tx, part.poolId);
    assertOwnerOrAdmin(actor, pool.distributorId);
    const p = await tx.participation.findUniqueOrThrow({
      where: { id: participationId },
      include: { commerce: { select: { userId: true, tradeName: true } } },
    });
    if (p.status === "ENTREGADA") return;
    assertParticipationTransition(p.status, "ENTREGADA");
    await tx.participation.update({ where: { id: p.id }, data: { status: "ENTREGADA", deliveredAt: new Date() } });
    await audit(tx, actor, { action: "entrega.realizada", entityType: "POOL", entityId: pool.id, summary: `Entregado a ${p.commerce.tradeName}` });
    await notify(tx, {
      userIds: [p.commerce.userId],
      type: NOTIFICATION_TYPES.ENTREGADO,
      title: "¡Tu pedido fue entregado!",
      body: `Recibiste ${p.quantity} u. del pool "${pool.title}". Contanos cómo te fue calificando al preventista.`,
      link: "/comercio/entregas",
      ctaLabel: "Calificar",
    });
    await completeDeliveryIfDoneInTx(tx, pool.id, actor);
  });
}

export async function markPoolDelivered(actor: UserActor, poolId: string): Promise<void> {
  const pending = await db.participation.findMany({ where: { poolId, status: "PAGADA" }, select: { id: true } });
  for (const p of pending) await markParticipationDelivered(actor, p.id);
  await withTx(async (tx) => {
    const pool = await lockAndLoad(tx, poolId);
    assertOwnerOrAdmin(actor, pool.distributorId);
    await completeDeliveryIfDoneInTx(tx, poolId, actor);
  });
}

// -----------------------------------------------------------------------------
// Jobs programados
// -----------------------------------------------------------------------------

/** Vence o cierra los pools cuya fecha límite ya pasó. */
export async function runPoolDeadlines(now = new Date()): Promise<{ expired: number; closed: number }> {
  const due = await db.pool.findMany({
    where: { status: { in: ["ABIERTO", "COMPLETO"] }, closedAt: null, deadlineAt: { lte: now } },
    select: { id: true },
    take: 200,
  });
  let expired = 0;
  let closed = 0;
  for (const { id } of due) {
    try {
      await withTx(async (tx) => {
        const pool = await lockAndLoad(tx, id);
        const decision = decideOnDeadline(pool, now);
        if (decision === "EXPIRE") {
          await expirePoolInTx(tx, pool, SYSTEM_ACTOR);
          expired++;
        } else if (decision === "CLOSE") {
          await closePoolInTx(tx, id, SYSTEM_ACTOR);
          closed++;
        }
      });
    } catch (err) {
      logger.error("Error procesando vencimiento de pool", { poolId: id, err });
    }
  }
  return { expired, closed };
}

/** Finaliza los pools vencidos cuya ventana de decisión terminó. */
export async function runExpiredFinalization(now = new Date()): Promise<number> {
  const due = await db.pool.findMany({
    where: { status: "VENCIDO_SIN_COMPLETAR", finalizedAt: null, decisionDeadlineAt: { lte: now } },
    select: { id: true },
    take: 200,
  });
  let n = 0;
  for (const { id } of due) {
    try {
      await withTx(async (tx) => {
        const pool = await lockAndLoad(tx, id);
        if (pool.status !== "VENCIDO_SIN_COMPLETAR" || pool.finalizedAt) return;
        if (!pool.decisionDeadlineAt || pool.decisionDeadlineAt > now) return;
        await finalizeExpiredPoolInTx(tx, pool, SYSTEM_ACTOR);
        n++;
      });
    } catch (err) {
      logger.error("Error finalizando pool vencido", { poolId: id, err });
    }
  }
  return n;
}

/** Notifica "nuevo pool en tu zona" a los comercios alcanzados (en lotes). */
export async function fanoutNewPool(poolId: string): Promise<number> {
  const pool = await db.pool.findUnique({ where: { id: poolId }, include: { zones: true, distributor: { select: { tradeName: true } } } });
  if (!pool || pool.status !== "ABIERTO") return 0;
  const zoneFilter: Prisma.BusinessWhereInput[] = pool.zones.map((z) =>
    z.localityId === null ? { provinceId: z.provinceId } : { provinceId: z.provinceId, localityId: z.localityId },
  );
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const batch = await db.business.findMany({
      where: { OR: zoneFilter, user: { role: "COMERCIO", status: "ACTIVO" } },
      select: { id: true, userId: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    await notify(db, {
      userIds: batch.map((b) => b.userId),
      type: NOTIFICATION_TYPES.NUEVO_POOL_EN_ZONA,
      title: `Nuevo pool en tu zona: ${pool.title}`,
      body: `${pool.distributor.tradeName} abrió un pool a ${formatARS(c(pool.unitPriceCents))} por unidad. Cierra el ${formatDateTimeAR(pool.deadlineAt)}. ¡Sumate!`,
      link: poolLink(pool.id),
      ctaLabel: "Ver pool",
    });
    total += batch.length;
    cursor = batch[batch.length - 1]!.id;
    if (batch.length < 200) break;
  }
  return total;
}
