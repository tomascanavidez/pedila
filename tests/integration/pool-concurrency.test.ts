import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDomainError } from "@/domain/errors";
import { db, disconnectDb } from "@/server/db";
import type { UserActor } from "@/server/services/actor";
import { changeParticipation, publishPool, savePoolDraft } from "@/server/services/pools";
import { createProduct, createUserWithBusiness, ensureCategory, poolInput, setConfig } from "./factories";

/**
 * Concurrencia: muchos comercios sumándose al mismo tiempo nunca pueden superar el
 * total de unidades del pool (SELECT ... FOR UPDATE sobre la fila del pool).
 */
describe("concurrencia de pools", () => {
  let distributor: UserActor;
  let productId: string;

  beforeAll(async () => {
    await setConfig({ poolApprovalRequired: false, globalCommissionBps: 800 });
    distributor = await createUserWithBusiness("PREVENTISTA");
    const cat = await ensureCategory("Bebidas");
    productId = (await createProduct(distributor, cat.id)).id;
  });

  afterAll(async () => {
    await disconnectDb();
  });

  async function openPool(overrides: Parameters<typeof poolInput>[1]) {
    const pool = await savePoolDraft(distributor, poolInput(productId, overrides));
    await publishPool(distributor, pool.id);
    return pool.id;
  }

  it("40 comercios piden 10 u. a la vez sobre un pool de 100: se venden exactamente 100", async () => {
    const poolId = await openPool({ totalUnits: 100, minUnitsToClose: 100, minPerCommerce: 1, maxPerCommerce: 10 });
    const commerces = await Promise.all(Array.from({ length: 40 }, () => createUserWithBusiness("COMERCIO")));

    const results = await Promise.allSettled(commerces.map((c) => changeParticipation(c, poolId, 10)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(ok).toHaveLength(10);
    for (const f of failed) {
      expect(isDomainError(f.reason)).toBe(true);
      expect(["SIN_UNIDADES", "POOL_NO_DISPONIBLE"]).toContain(f.reason.code);
    }

    const pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    const active = await db.participation.aggregate({
      where: { poolId, status: { in: ["COMPROMETIDA", "PENDIENTE_PAGO", "PAGADA", "ENTREGADA"] } },
      _sum: { quantity: true },
    });
    expect(pool.committedUnits).toBe(100);
    expect(active._sum.quantity).toBe(100);
    // Al llegar al total, el pool se cerró y emitió un pago por participación.
    expect(pool.status).toBe("COMPLETO");
    expect(pool.closedAt).not.toBeNull();
    expect(await db.payment.count({ where: { participation: { poolId } } })).toBe(10);
  });

  it("cantidades distintas en paralelo nunca superan el total", async () => {
    const poolId = await openPool({ totalUnits: 97, minUnitsToClose: 97, minPerCommerce: 1, maxPerCommerce: 30 });
    const commerces = await Promise.all(Array.from({ length: 25 }, () => createUserWithBusiness("COMERCIO")));
    const quantities = commerces.map((_, i) => 1 + ((i * 7) % 30));
    await Promise.allSettled(commerces.map((c, i) => changeParticipation(c, poolId, quantities[i]!)));
    const pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    const active = await db.participation.aggregate({
      where: { poolId, status: { in: ["COMPROMETIDA", "PENDIENTE_PAGO"] } },
      _sum: { quantity: true },
    });
    expect(pool.committedUnits).toBeLessThanOrEqual(97);
    expect(active._sum.quantity ?? 0).toBe(pool.committedUnits);
  });

  it("doble click: el mismo comercio enviando 5 veces la misma cantidad queda con una sola participación", async () => {
    const poolId = await openPool({ totalUnits: 600, minUnitsToClose: 480 });
    const commerce = await createUserWithBusiness("COMERCIO");
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => changeParticipation(commerce, poolId, 20)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.every((r) => r.reason.code === "SIN_CAMBIOS")).toBe(true);
    expect(await db.participation.count({ where: { poolId } })).toBe(1);
    expect((await db.pool.findUniqueOrThrow({ where: { id: poolId } })).committedUnits).toBe(20);
  });

  it("altas y bajas simultáneas mantienen committedUnits consistente", async () => {
    const poolId = await openPool({ totalUnits: 600, minUnitsToClose: 590, minPerCommerce: 1, maxPerCommerce: 50 });
    const commerces = await Promise.all(Array.from({ length: 12 }, () => createUserWithBusiness("COMERCIO")));
    await Promise.all(commerces.map((c) => changeParticipation(c, poolId, 30)));
    // La mitad se retira y la otra mitad sube a 40, todo en paralelo.
    await Promise.all(commerces.map((c, i) => changeParticipation(c, poolId, i % 2 === 0 ? 0 : 40)));
    const pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool.committedUnits).toBe(6 * 40);
    const active = await db.participation.aggregate({ where: { poolId, status: "COMPROMETIDA" }, _sum: { quantity: true } });
    expect(active._sum.quantity).toBe(240);
    expect(await db.participation.count({ where: { poolId, status: "RETIRADA" } })).toBe(6);
  });
});
