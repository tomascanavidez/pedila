import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { SettlementStatus } from "@/generated/prisma/enums";
import { DomainError } from "@/domain/errors";
import { formatARS, toCents } from "@/domain/money";
import { audit } from "../audit";
import { db } from "../db";
import { NOTIFICATION_TYPES, notify } from "../notifications/notify";
import { withTx, type Tx } from "../tx";
import type { UserActor } from "./actor";

/** Crea (o recalcula) la liquidación de un pool pagado con lo efectivamente cobrado. */
export async function upsertPoolSettlement(tx: Tx, poolId: string): Promise<void> {
  const pool = await tx.pool.findUniqueOrThrow({ where: { id: poolId }, select: { distributorId: true } });
  const paid = await tx.participation.findMany({
    where: { poolId, status: { in: ["PAGADA", "ENTREGADA"] } },
    select: { totalCents: true, commissionCents: true, netCents: true },
  });
  const gross = paid.reduce((a, p) => a + p.totalCents, 0n);
  const commission = paid.reduce((a, p) => a + p.commissionCents, 0n);
  const net = paid.reduce((a, p) => a + p.netCents, 0n);
  await tx.settlement.upsert({
    where: { poolId },
    create: {
      distributorId: pool.distributorId,
      sourceType: "POOL",
      poolId,
      grossCents: gross,
      commissionCents: commission,
      netCents: net,
    },
    update: { grossCents: gross, commissionCents: commission, netCents: net },
  });
}

export async function upsertOrderSettlement(tx: Tx, orderId: string): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  await tx.settlement.upsert({
    where: { orderId },
    create: {
      distributorId: order.distributorId,
      sourceType: "PEDIDO",
      orderId,
      grossCents: order.subtotalCents,
      commissionCents: order.commissionCents,
      netCents: order.netCents,
    },
    update: { grossCents: order.subtotalCents, commissionCents: order.commissionCents, netCents: order.netCents },
  });
}

export async function markSettlementPaidOut(
  actor: UserActor,
  settlementId: string,
  input: { reference: string; notes?: string | null },
): Promise<void> {
  await withTx(async (tx) => {
    const s = await tx.settlement.findUnique({
      where: { id: settlementId },
      include: { distributor: { select: { userId: true, tradeName: true } } },
    });
    if (!s) throw new DomainError("NO_ENCONTRADO", "Liquidación inexistente.");
    if (s.status === "LIQUIDADO") throw new DomainError("YA_LIQUIDADO", "Esta liquidación ya figura como liquidada.");
    await tx.settlement.update({
      where: { id: settlementId },
      data: {
        status: "LIQUIDADO",
        paidOutAt: new Date(),
        paidOutById: actor.id,
        reference: input.reference.slice(0, 120),
        notes: input.notes?.slice(0, 500) ?? null,
      },
    });
    await audit(tx, actor, {
      action: "liquidacion.pagada",
      entityType: "SETTLEMENT",
      entityId: settlementId,
      summary: `Liquidado ${formatARS(toCents(s.netCents))} a ${s.distributor.tradeName} (ref. ${input.reference})`,
    });
    await notify(tx, {
      userIds: [s.distributor.userId],
      type: NOTIFICATION_TYPES.LIQUIDACION,
      title: "Te liquidamos una venta",
      body: `Transferimos ${formatARS(toCents(s.netCents))} (referencia ${input.reference}).`,
      link: "/preventista/liquidaciones",
    });
  });
}

export interface SettlementFilter {
  distributorId?: string;
  status?: SettlementStatus;
  from?: Date;
  to?: Date;
}

export function settlementWhere(f: SettlementFilter): Prisma.SettlementWhereInput {
  return {
    ...(f.distributorId ? { distributorId: f.distributorId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
  };
}

export async function listSettlements(f: SettlementFilter, take = 200) {
  const rows = await db.settlement.findMany({
    where: settlementWhere(f),
    orderBy: { createdAt: "desc" },
    take,
    include: {
      distributor: { select: { tradeName: true, cuit: true } },
      pool: { select: { id: true, title: true } },
      order: { select: { id: true, number: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    sourceType: s.sourceType,
    sourceLabel: s.pool ? s.pool.title : s.order ? `Pedido #${s.order.number}` : "-",
    sourceId: s.pool?.id ?? s.order?.id ?? null,
    distributorName: s.distributor.tradeName,
    distributorCuit: s.distributor.cuit,
    grossCents: toCents(s.grossCents),
    commissionCents: toCents(s.commissionCents),
    netCents: toCents(s.netCents),
    status: s.status,
    reference: s.reference,
    createdAt: s.createdAt,
    paidOutAt: s.paidOutAt,
  }));
}

export async function settlementTotals(f: SettlementFilter) {
  const agg = await db.settlement.groupBy({
    by: ["status"],
    where: settlementWhere(f),
    _sum: { grossCents: true, commissionCents: true, netCents: true },
  });
  const pick = (s: SettlementStatus) => agg.find((a) => a.status === s)?._sum;
  return {
    pendingNetCents: toCents(pick("PENDIENTE")?.netCents ?? 0n),
    paidNetCents: toCents(pick("LIQUIDADO")?.netCents ?? 0n),
    grossCents: agg.reduce((a, r) => a + toCents(r._sum.grossCents ?? 0n), 0),
    commissionCents: agg.reduce((a, r) => a + toCents(r._sum.commissionCents ?? 0n), 0),
  };
}
