import { NextResponse } from "next/server";
import type { SettlementStatus } from "@/generated/prisma/enums";
import { formatCuit } from "@/domain/cuit";
import { DomainError } from "@/domain/errors";
import { formatBps, toCents } from "@/domain/money";
import { toCSV, type CsvCell } from "@/lib/csv";
import { dayKeyAR, formatDateTimeAR } from "@/lib/dates";
import { POOL_STATUS_LABEL } from "@/lib/labels";
import { LIMITS } from "@/lib/rate-limit";
import { requireActionUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { jsonError, limited } from "@/server/http";
import { listSettlements } from "@/server/services/settlements";

/**
 * Exportaciones CSV (separador ";" + BOM para Excel en español; montos en pesos con coma decimal).
 *   /api/exportar/liquidaciones   preventista (las suyas) o admin (todas)
 *   /api/exportar/participantes?pool=ID   preventista dueño o admin
 *   /api/exportar/{usuarios|pools|pagos|auditoria|comisiones}   solo admin
 */
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const date = (d: Date | null | undefined) => (d ? formatDateTimeAR(d) : "");

function csvResponse(name: string, rows: CsvCell[][]): NextResponse {
  return new NextResponse(toCSV(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedila-${name}-${dayKeyAR(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request, ctx: RouteContext<"/api/exportar/[tipo]">) {
  try {
    const { tipo } = await ctx.params;
    const url = new URL(req.url);
    const user = await requireActionUser(["ADMIN", "PREVENTISTA"]);
    const blocked = limited(`export:${user.id}`, LIMITS.export);
    if (blocked) return blocked;
    const adminOnly = () => {
      if (user.role !== "ADMIN") throw new DomainError("SIN_PERMISO", "Solo administradores.");
    };

    switch (tipo) {
      case "liquidaciones": {
        const status = url.searchParams.get("estado") as SettlementStatus | null;
        const rows = await listSettlements(
          { distributorId: user.role === "ADMIN" ? (url.searchParams.get("preventista") ?? undefined) : user.businessId!, status: status ?? undefined },
          10_000,
        );
        return csvResponse("liquidaciones", [
          ["Fecha", "Preventista", "CUIT", "Origen", "Detalle", "Bruto", "Comisión PEDILA", "Neto", "Estado", "Referencia", "Liquidado el"],
          ...rows.map((s) => [
            date(s.createdAt),
            s.distributorName,
            formatCuit(s.distributorCuit),
            s.sourceType === "POOL" ? "Pool" : "Pedido",
            s.sourceLabel,
            money(s.grossCents),
            money(s.commissionCents),
            money(s.netCents),
            s.status === "LIQUIDADO" ? "Liquidado" : "Pendiente",
            s.reference ?? "",
            date(s.paidOutAt),
          ]),
        ]);
      }
      case "participantes": {
        const poolId = url.searchParams.get("pool") ?? "";
        const pool = await db.pool.findUnique({ where: { id: poolId } });
        if (!pool || (user.role !== "ADMIN" && pool.distributorId !== user.businessId)) throw new DomainError("NO_ENCONTRADO", "Pool inexistente.");
        const parts = await db.participation.findMany({
          where: { poolId },
          include: { commerce: { include: { locality: true, province: true, user: { select: { email: true } } } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
        });
        return csvResponse("participantes", [
          ["Comercio", "CUIT", "Email", "Teléfono", "Dirección", "Localidad", "Provincia", "Cantidad", "Total", "Comisión", "Neto", "Estado", "Pago"],
          ...parts.map((p) => [
            p.commerce.tradeName,
            formatCuit(p.commerce.cuit),
            p.commerce.user.email,
            p.commerce.phone ?? "",
            `${p.commerce.street} ${p.commerce.streetNumber}`,
            p.commerce.locality.name,
            p.commerce.province.name,
            p.quantity,
            money(toCents(p.totalCents)),
            money(toCents(p.commissionCents)),
            money(toCents(p.netCents)),
            p.status,
            p.payments[0]?.status ?? "",
          ]),
        ]);
      }
      case "usuarios": {
        adminOnly();
        const users = await db.user.findMany({ orderBy: { createdAt: "desc" }, include: { business: { include: { locality: true, province: true } } } });
        return csvResponse("usuarios", [
          ["Alta", "Nombre", "Email", "Rol", "Estado", "Negocio", "CUIT", "Condición IVA", "Localidad", "Provincia", "Estado preventista", "Último ingreso"],
          ...users.map((u) => [
            date(u.createdAt),
            u.name,
            u.email,
            u.role,
            u.status,
            u.business?.tradeName ?? "",
            u.business ? formatCuit(u.business.cuit) : "",
            u.business?.ivaCondition ?? "",
            u.business?.locality.name ?? "",
            u.business?.province.name ?? "",
            u.business?.distributorStatus ?? "",
            date(u.lastLoginAt),
          ]),
        ]);
      }
      case "pools": {
        adminOnly();
        const pools = await db.pool.findMany({ orderBy: { createdAt: "desc" }, include: { distributor: { select: { tradeName: true } }, category: { select: { name: true } } } });
        return csvResponse("pools", [
          ["Creado", "Título", "Preventista", "Categoría", "Estado", "Precio unitario", "Comisión", "Neto unitario", "Total u.", "Mínimo", "Comprometidas", "Pagadas", "Fecha límite"],
          ...pools.map((p) => [
            date(p.createdAt),
            p.title,
            p.distributor.tradeName,
            p.category.name,
            POOL_STATUS_LABEL[p.status],
            money(toCents(p.unitPriceCents)),
            formatBps(p.commissionBps),
            money(toCents(p.netUnitCents)),
            p.totalUnits,
            p.minUnitsToClose,
            p.committedUnits,
            p.paidUnits,
            date(p.deadlineAt),
          ]),
        ]);
      }
      case "pagos": {
        adminOnly();
        const payments = await db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 20_000, include: { commerce: { select: { tradeName: true } } } });
        return csvResponse("pagos", [
          ["Creado", "Comercio", "Tipo", "Proveedor", "Estado", "Monto", "Comisión", "Neto", "ID proveedor", "Vence", "Pagado", "Reintegrado"],
          ...payments.map((p) => [
            date(p.createdAt),
            p.commerce.tradeName,
            p.kind,
            p.provider,
            p.status,
            money(toCents(p.amountCents)),
            money(toCents(p.commissionCents)),
            money(toCents(p.netCents)),
            p.providerPaymentId ?? "",
            date(p.dueAt),
            date(p.paidAt),
            date(p.refundedAt),
          ]),
        ]);
      }
      case "auditoria": {
        adminOnly();
        const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20_000, include: { actor: { select: { email: true } } } });
        return csvResponse("auditoria", [
          ["Fecha", "Usuario", "Rol", "Acción", "Entidad", "ID", "Detalle", "IP"],
          ...logs.map((l) => [date(l.createdAt), l.actor?.email ?? "sistema", l.actorRole ?? "", l.action, l.entityType, l.entityId, l.summary ?? "", l.ip ?? ""]),
        ]);
      }
      case "comisiones": {
        adminOnly();
        const changes = await db.commissionChange.findMany({ orderBy: { createdAt: "desc" }, include: { changedBy: { select: { email: true } } } });
        return csvResponse("historial-comisiones", [
          ["Fecha", "Alcance", "Sobre", "Valor anterior", "Valor nuevo", "Usuario"],
          ...changes.map((c) => [date(c.createdAt), c.scope, c.targetLabel, c.oldValue ?? "", c.newValue ?? "", c.changedBy.email]),
        ]);
      }
      default:
        return NextResponse.json({ error: "Exportación inexistente" }, { status: 404 });
    }
  } catch (err) {
    return jsonError(err);
  }
}
