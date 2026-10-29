import "server-only";
import { centsToInput, toCents } from "@/domain/money";
import { addDays, parseLocalDateTimeAR, toLocalInputAR, dayKeyAR } from "@/lib/dates";
import type { PoolFormDefaults, PoolFormProduct } from "@/components/pools/pool-form";
import { db } from "../db";
import { getCommissionMatrix } from "../services/commissions";
import { listGeo } from "./public";

/** Datos que necesita el formulario de pools (productos, comisión aplicable y zonas). */
export async function poolFormData(distributorId: string) {
  const [products, matrix, geo, business] = await Promise.all([
    db.product.findMany({ where: { distributorId, active: true }, orderBy: { name: "asc" } }),
    getCommissionMatrix(distributorId),
    listGeo(),
    db.business.findUniqueOrThrow({ where: { id: distributorId }, include: { coverage: true } }),
  ]);
  const formProducts: PoolFormProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    saleUnit: p.saleUnit,
    unitsPerPack: p.unitsPerPack,
    priceCents: toCents(p.priceCents),
    retailPriceCents: p.retailPriceCents === null ? null : toCents(p.retailPriceCents),
  }));
  return {
    products: formProducts,
    commission: { mode: matrix.mode, byCategory: matrix.byCategory, globalBps: matrix.distributorBps ?? matrix.globalBps },
    geo,
    coverage: business.coverage.map((c) => ({ provinceId: c.provinceId, localityId: c.localityId })),
    canPublish: business.distributorStatus === "APROBADO",
  };
}

/** Valores por defecto de un pool nuevo: cierra en 7 días a las 20 h, entrega 3 días después. */
export function newPoolDefaults(coverage: { provinceId: number; localityId: number | null }[], productId?: string): PoolFormDefaults {
  const deadline = parseLocalDateTimeAR(`${dayKeyAR(addDays(new Date(), 7))}T20:00`)!;
  return {
    productId,
    deadlineAt: toLocalInputAR(deadline),
    estimatedDeliveryAt: toLocalInputAR(addDays(deadline, 3)),
    zones: coverage,
    minPerCommerce: 1,
    closeOnMinimum: true,
  };
}

export async function poolEditDefaults(poolId: string): Promise<PoolFormDefaults | null> {
  const p = await db.pool.findUnique({ where: { id: poolId }, include: { zones: true } });
  if (!p) return null;
  return {
    poolId: p.id,
    productId: p.productId,
    title: p.title,
    description: p.description,
    price: centsToInput(toCents(p.priceInputCents)),
    retailPrice: centsToInput(toCents(p.retailUnitPriceCents)),
    totalUnits: p.totalUnits,
    minUnitsToClose: p.minUnitsToClose,
    minPerCommerce: p.minPerCommerce,
    maxPerCommerce: p.maxPerCommerce,
    closeOnMinimum: p.closeOnMinimum,
    deadlineAt: toLocalInputAR(p.deadlineAt),
    estimatedDeliveryAt: p.estimatedDeliveryAt ? toLocalInputAR(p.estimatedDeliveryAt) : undefined,
    zones: p.zones.map((z) => ({ provinceId: z.provinceId, localityId: z.localityId })),
  };
}
