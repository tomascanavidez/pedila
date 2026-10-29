import "server-only";
import type { PoolStatus } from "@/generated/prisma/enums";
import { toCents } from "@/domain/money";
import { arParts, dayKeyAR, monthKeyAR, parseLocalDateTimeAR, weekKeyAR } from "@/lib/dates";
import { db } from "../db";

export type Granularity = "dia" | "semana" | "mes";

export interface SeriesPoint {
  key: string;
  label: string;
  gmvCents: number;
  commissionCents: number;
  poolsCreated: number;
  poolsPaid: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Genera las claves de período (en hora argentina) desde el más viejo al actual. */
export function periodKeys(granularity: Granularity, points: number, now = new Date()): { key: string; label: string; start: Date }[] {
  const out: { key: string; label: string; start: Date }[] = [];
  const p = arParts(now);
  for (let i = points - 1; i >= 0; i--) {
    if (granularity === "mes") {
      const total = p.year * 12 + (p.month - 1) - i;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      const key = `${y}-${pad(m)}`;
      out.push({ key, label: `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`, start: parseLocalDateTimeAR(`${key}-01`)! });
    } else {
      const step = granularity === "semana" ? 7 : 1;
      const base = granularity === "semana" ? parseLocalDateTimeAR(weekKeyAR(now))! : parseLocalDateTimeAR(dayKeyAR(now))!;
      const start = new Date(base.getTime() - i * step * 86_400_000);
      const key = dayKeyAR(start);
      const [, mm, dd] = key.split("-");
      out.push({ key, label: `${dd}/${mm}`, start });
    }
  }
  return out;
}

function keyFor(granularity: Granularity, d: Date): string {
  if (granularity === "mes") return monthKeyAR(d);
  if (granularity === "semana") return weekKeyAR(d);
  return dayKeyAR(d);
}

/** Serie para los gráficos del admin. Se agrega en JS (independiente del motor de base). */
export async function adminSeries(granularity: Granularity, points: number): Promise<SeriesPoint[]> {
  const keys = periodKeys(granularity, points);
  const from = keys[0]!.start;
  const [payments, created, paid] = await Promise.all([
    db.payment.findMany({ where: { status: "APROBADO", paidAt: { gte: from } }, select: { paidAt: true, amountCents: true, commissionCents: true } }),
    db.pool.findMany({ where: { publishedAt: { gte: from } }, select: { publishedAt: true } }),
    db.pool.findMany({ where: { paidAt: { gte: from } }, select: { paidAt: true } }),
  ]);
  const map = new Map<string, SeriesPoint>(keys.map((k) => [k.key, { key: k.key, label: k.label, gmvCents: 0, commissionCents: 0, poolsCreated: 0, poolsPaid: 0 }]));
  for (const p of payments) {
    const pt = map.get(keyFor(granularity, p.paidAt!));
    if (pt) {
      pt.gmvCents += toCents(p.amountCents);
      pt.commissionCents += toCents(p.commissionCents);
    }
  }
  for (const p of created) {
    const pt = map.get(keyFor(granularity, p.publishedAt!));
    if (pt) pt.poolsCreated++;
  }
  for (const p of paid) {
    const pt = map.get(keyFor(granularity, p.paidAt!));
    if (pt) pt.poolsPaid++;
  }
  return [...map.values()];
}

export async function adminKpis(from: Date, to: Date) {
  const [money, statusGroups, roleGroups, newUsers, pendingDistributors, openDisputes, pendingPools, failedJobs] = await Promise.all([
    db.payment.aggregate({ where: { status: "APROBADO", paidAt: { gte: from, lt: to } }, _sum: { amountCents: true, commissionCents: true }, _count: true }),
    db.pool.groupBy({ by: ["status"], _count: true }),
    db.user.groupBy({ by: ["role"], where: { status: "ACTIVO" }, _count: true }),
    db.user.count({ where: { createdAt: { gte: from, lt: to } } }),
    db.business.count({ where: { distributorStatus: "PENDIENTE" } }),
    db.dispute.count({ where: { status: { in: ["ABIERTA", "EN_REVISION"] } } }),
    db.pool.count({ where: { status: "PENDIENTE_APROBACION" } }),
    db.job.count({ where: { status: "FALLIDO" } }),
  ]);
  const count = (s: PoolStatus[]) => statusGroups.filter((g) => s.includes(g.status)).reduce((a, g) => a + g._count, 0);
  const role = (r: string) => roleGroups.find((g) => g.role === r)?._count ?? 0;
  return {
    gmvCents: toCents(money._sum.amountCents ?? 0n),
    commissionCents: toCents(money._sum.commissionCents ?? 0n),
    paymentsCount: money._count,
    pools: {
      active: count(["ABIERTO", "COMPLETO"]),
      completed: count(["CERRADO_PAGADO", "EN_ENTREGA", "ENTREGADO"]),
      expired: count(["VENCIDO_SIN_COMPLETAR"]),
      cancelled: count(["CANCELADO"]),
      pendingApproval: pendingPools,
    },
    users: { commerces: role("COMERCIO"), distributors: role("PREVENTISTA"), admins: role("ADMIN"), newInPeriod: newUsers },
    alerts: { pendingDistributors, openDisputes, failedJobs },
  };
}

export async function distributorDashboard(distributorId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [statusGroups, sales30, salesAll, pendingNet, recentPools] = await Promise.all([
    db.pool.groupBy({ by: ["status"], where: { distributorId }, _count: true }),
    db.settlement.aggregate({ where: { distributorId, createdAt: { gte: since } }, _sum: { grossCents: true, netCents: true } }),
    db.settlement.aggregate({ where: { distributorId }, _sum: { grossCents: true, netCents: true, commissionCents: true } }),
    db.settlement.aggregate({ where: { distributorId, status: "PENDIENTE" }, _sum: { netCents: true } }),
    db.pool.findMany({
      where: { distributorId, status: { notIn: ["CANCELADO"] } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, status: true, committedUnits: true, minUnitsToClose: true, totalUnits: true, deadlineAt: true, closedAt: true, saleUnit: true },
    }),
  ]);
  const count = (s: PoolStatus[]) => statusGroups.filter((g) => s.includes(g.status)).reduce((a, g) => a + g._count, 0);
  const succeeded = count(["CERRADO_PAGADO", "EN_ENTREGA", "ENTREGADO"]);
  const failed = count(["VENCIDO_SIN_COMPLETAR", "CANCELADO"]);
  return {
    activePools: count(["ABIERTO", "COMPLETO"]),
    toDeliver: count(["CERRADO_PAGADO", "EN_ENTREGA"]),
    completionRate: succeeded + failed > 0 ? Math.round((succeeded * 100) / (succeeded + failed)) : null,
    succeeded,
    failed,
    sales30Cents: toCents(sales30._sum.grossCents ?? 0n),
    salesTotalCents: toCents(salesAll._sum.grossCents ?? 0n),
    commissionTotalCents: toCents(salesAll._sum.commissionCents ?? 0n),
    pendingNetCents: toCents(pendingNet._sum.netCents ?? 0n),
    recentPools,
  };
}
