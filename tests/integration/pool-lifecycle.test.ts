import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/server/db";
import type { UserActor } from "@/server/services/actor";
import { setCategoryCommission, setDistributorCommission, updateCommissionSettings } from "@/server/services/commissions";
import { applyProviderUpdate, runPaymentExpiry } from "@/server/services/payments";
import {
  acceptCloseBelowMinimum,
  cancelPool,
  changeParticipation,
  extendPoolDeadline,
  markParticipationDelivered,
  publishPool,
  reviewPool,
  runExpiredFinalization,
  runPoolDeadlines,
  savePoolDraft,
  schedulePoolDelivery,
} from "@/server/services/pools";
import { createProduct, createUserWithBusiness, ensureCategory, poolInput, setConfig } from "./factories";

const approved = (paymentId: string, amountCents: number | null = null) =>
  ({
    providerPaymentId: `SIM-${paymentId}`,
    state: "APPROVED" as const,
    providerStatus: "simulado:approved",
    externalReference: paymentId,
    amountCents,
    currency: "ARS",
    paidAt: new Date(),
  });

describe("ciclo de vida de un pool", () => {
  let admin: UserActor;
  let distributor: UserActor;
  let categoryId: string;
  let productId: string;

  beforeAll(async () => {
    admin = await createUserWithBusiness("ADMIN");
    distributor = await createUserWithBusiness("PREVENTISTA");
    categoryId = (await ensureCategory("Almacén")).id;
    productId = (await createProduct(distributor, categoryId)).id;
  });

  beforeEach(async () => {
    await setConfig({
      poolApprovalRequired: false,
      globalCommissionBps: 800,
      commissionMode: "DESCONTAR_AL_PREVENTISTA",
      unpaidRule: "REABRIR",
      paymentWindowHours: 48,
    });
    await db.category.update({ where: { id: categoryId }, data: { commissionBps: null } });
    await db.business.update({ where: { id: distributor.businessId! }, data: { commissionBps: null } });
  });

  afterAll(async () => {
    await disconnectDb();
  });

  async function newOpenPool(overrides: Parameters<typeof poolInput>[1] = {}) {
    const draft = await savePoolDraft(distributor, poolInput(productId, overrides));
    await publishPool(distributor, draft.id);
    return draft.id;
  }

  async function commerces(n: number) {
    return Promise.all(Array.from({ length: n }, () => createUserWithBusiness("COMERCIO")));
  }

  async function backdateDeadline(poolId: string) {
    await db.pool.update({ where: { id: poolId }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
  }

  describe("comisiones", () => {
    it("congela el % al publicar: un cambio posterior de configuración no afecta al pool abierto", async () => {
      const poolId = await newOpenPool();
      const before = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
      expect(before.commissionBps).toBe(800);
      expect(before.commissionSource).toBe("GLOBAL");
      expect(before.commissionFrozenAt).not.toBeNull();
      expect(Number(before.netUnitCents)).toBe(138_000);

      await updateCommissionSettings(admin, { globalBps: 1_000, mode: "DESCONTAR_AL_PREVENTISTA", catalogCommissionEnabled: false });
      const after = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
      expect(after.commissionBps).toBe(800);
      expect(Number(after.netUnitCents)).toBe(138_000);

      const newer = await db.pool.findUniqueOrThrow({ where: { id: await newOpenPool() } });
      expect(newer.commissionBps).toBe(1_000);
      expect(Number(newer.netUnitCents)).toBe(135_000);

      const history = await db.commissionChange.findFirst({ where: { scope: "GLOBAL", changedById: admin.id }, orderBy: { createdAt: "desc" } });
      expect(history).toMatchObject({ oldValue: "8 %", newValue: "10 %" });
    });

    it("prioridad preventista > categoría > global, y modo 'sumar al comercio'", async () => {
      await setCategoryCommission(admin, categoryId, 600);
      const byCategory = await db.pool.findUniqueOrThrow({ where: { id: await newOpenPool() } });
      expect(byCategory).toMatchObject({ commissionBps: 600, commissionSource: "CATEGORIA" });

      await setDistributorCommission(admin, distributor.businessId!, 750);
      const byDistributor = await db.pool.findUniqueOrThrow({ where: { id: await newOpenPool() } });
      expect(byDistributor).toMatchObject({ commissionBps: 750, commissionSource: "PREVENTISTA" });

      await setConfig({ commissionMode: "SUMAR_AL_COMERCIO" });
      const added = await db.pool.findUniqueOrThrow({ where: { id: await newOpenPool() } });
      expect(Number(added.unitPriceCents)).toBe(150_000 + 11_250);
      expect(Number(added.netUnitCents)).toBe(150_000);
      expect(await db.commissionChange.count({ where: { scope: { in: ["CATEGORIA", "PREVENTISTA"] }, changedById: admin.id } })).toBeGreaterThanOrEqual(2);
    });
  });

  it("con aprobación obligatoria pasa por PENDIENTE_APROBACION y el admin lo abre", async () => {
    await setConfig({ poolApprovalRequired: true });
    const draft = await savePoolDraft(distributor, poolInput(productId));
    const res = await publishPool(distributor, draft.id);
    expect(res.status).toBe("PENDIENTE_APROBACION");
    await reviewPool(admin, draft.id, true, "OK");
    const pool = await db.pool.findUniqueOrThrow({ where: { id: draft.id } });
    expect(pool.status).toBe("ABIERTO");
    expect(pool.publishedAt).not.toBeNull();
  });

  it("un preventista no aprobado no puede publicar", async () => {
    const pending = await createUserWithBusiness("PREVENTISTA", { approved: false });
    const p = await createProduct(pending, categoryId);
    const draft = await savePoolDraft(pending, poolInput(p.id));
    await expect(publishPool(pending, draft.id)).rejects.toMatchObject({ code: "NO_APROBADO" });
  });

  it("camino feliz: completo → pagos → cerrado y pagado → en entrega → entregado, con liquidación", async () => {
    const poolId = await newOpenPool({ totalUnits: 100, minUnitsToClose: 60, minPerCommerce: 10, maxPerCommerce: 40 });
    const [a, b] = await commerces(2);
    await changeParticipation(a!, poolId, 30);
    const res = await changeParticipation(b!, poolId, 30);
    expect(res.status).toBe("COMPLETO");
    expect(res.closed).toBe(true);

    const payments = await db.payment.findMany({ where: { participation: { poolId } } });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.status === "PENDIENTE" && p.dueAt !== null)).toBe(true);
    expect(await db.job.count({ where: { type: "CREATE_CHECKOUT", payload: { contains: payments[0]!.id } } })).toBe(1);

    for (const p of payments) await applyProviderUpdate(p.id, approved(p.id, Number(p.amountCents)));
    const paid = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(paid.status).toBe("CERRADO_PAGADO");
    expect(paid.paidUnits).toBe(60);

    const settlement = await db.settlement.findUniqueOrThrow({ where: { poolId } });
    expect(Number(settlement.grossCents)).toBe(60 * 150_000);
    expect(Number(settlement.commissionCents)).toBe(60 * 12_000);
    expect(Number(settlement.netCents)).toBe(60 * 138_000);

    await schedulePoolDelivery(distributor, poolId, new Date(Date.now() + 86_400_000));
    expect((await db.pool.findUniqueOrThrow({ where: { id: poolId } })).status).toBe("EN_ENTREGA");
    const parts = await db.participation.findMany({ where: { poolId } });
    for (const p of parts) await markParticipationDelivered(distributor, p.id);
    expect((await db.pool.findUniqueOrThrow({ where: { id: poolId } })).status).toBe("ENTREGADO");

    const transitions = await db.auditLog.findMany({ where: { entityType: "POOL", entityId: poolId, action: "pool.estado" }, orderBy: { createdAt: "asc" } });
    expect(transitions.map((t) => t.summary?.split(":")[0])).toEqual([
      "BORRADOR → ABIERTO",
      "ABIERTO → COMPLETO",
      "COMPLETO → CERRADO_PAGADO",
      "CERRADO_PAGADO → EN_ENTREGA",
      "EN_ENTREGA → ENTREGADO",
    ]);
  });

  it("sin cerrar al mínimo: sigue sumando, no permite bajas y el job lo cierra al vencer", async () => {
    const poolId = await newOpenPool({ totalUnits: 200, minUnitsToClose: 50, closeOnMinimum: false, minPerCommerce: 10, maxPerCommerce: 100 });
    const [a, b] = await commerces(2);
    const r1 = await changeParticipation(a!, poolId, 50);
    expect(r1).toMatchObject({ status: "COMPLETO", closed: false });
    await changeParticipation(b!, poolId, 20);
    await expect(changeParticipation(a!, poolId, 0)).rejects.toMatchObject({ code: "POOL_COMPLETO" });
    await backdateDeadline(poolId);
    const res = await runPoolDeadlines();
    expect(res.closed).toBeGreaterThanOrEqual(1);
    const pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool.closedAt).not.toBeNull();
    expect(await db.payment.count({ where: { participation: { poolId } } })).toBe(2);
  });

  it("vence sin el mínimo: nadie paga, se extiende una sola vez y se puede cerrar igual", async () => {
    const poolId = await newOpenPool({ totalUnits: 100, minUnitsToClose: 80, minPerCommerce: 10, maxPerCommerce: 50 });
    const [a] = await commerces(1);
    await changeParticipation(a!, poolId, 20);
    await backdateDeadline(poolId);
    await runPoolDeadlines();
    let pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool.status).toBe("VENCIDO_SIN_COMPLETAR");
    expect(pool.decisionDeadlineAt).not.toBeNull();
    expect(await db.payment.count({ where: { participation: { poolId } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: a!.id, type: "POOL_VENCIDO" } })).toBe(1);

    await extendPoolDeadline(distributor, poolId, new Date(Date.now() + 2 * 86_400_000));
    pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool).toMatchObject({ status: "ABIERTO", extendedOnce: true });

    await backdateDeadline(poolId);
    await runPoolDeadlines();
    await expect(extendPoolDeadline(distributor, poolId, new Date(Date.now() + 86_400_000))).rejects.toMatchObject({ code: "NO_EXTENSIBLE" });

    await acceptCloseBelowMinimum(distributor, poolId);
    pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool).toMatchObject({ status: "COMPLETO", acceptedBelowMinimum: true });
    const [payment] = await db.payment.findMany({ where: { participation: { poolId } } });
    await applyProviderUpdate(payment!.id, approved(payment!.id));
    expect((await db.pool.findUniqueOrThrow({ where: { id: poolId } })).status).toBe("CERRADO_PAGADO");
  });

  it("vencido sin decisión del preventista: se finaliza y se cancelan las participaciones", async () => {
    const poolId = await newOpenPool({ totalUnits: 100, minUnitsToClose: 80, minPerCommerce: 10, maxPerCommerce: 50 });
    const [a] = await commerces(1);
    await changeParticipation(a!, poolId, 20);
    await backdateDeadline(poolId);
    await runPoolDeadlines();
    await db.pool.update({ where: { id: poolId }, data: { decisionDeadlineAt: new Date(Date.now() - 1_000) } });
    expect(await runExpiredFinalization()).toBeGreaterThanOrEqual(1);
    const pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool.finalizedAt).not.toBeNull();
    expect(pool.committedUnits).toBe(0);
    expect((await db.participation.findFirstOrThrow({ where: { poolId } })).status).toBe("CANCELADA");
  });

  it("regla REABRIR: si alguien no paga y no se llega al mínimo, se liberan sus unidades y el pool vuelve a ABIERTO", async () => {
    const poolId = await newOpenPool({ totalUnits: 100, minUnitsToClose: 60, minPerCommerce: 10, maxPerCommerce: 40 });
    const [a, b] = await commerces(2);
    await changeParticipation(a!, poolId, 30);
    await changeParticipation(b!, poolId, 30);
    const payA = await db.payment.findFirstOrThrow({ where: { participation: { poolId, commerceId: a!.businessId! } } });
    const payB = await db.payment.findFirstOrThrow({ where: { participation: { poolId, commerceId: b!.businessId! } } });
    await applyProviderUpdate(payA.id, approved(payA.id));
    await db.payment.update({ where: { id: payB.id }, data: { dueAt: new Date(Date.now() - 1_000) } });
    expect(await runPaymentExpiry()).toBeGreaterThanOrEqual(1);

    const pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool.status).toBe("ABIERTO");
    expect(pool.closedAt).toBeNull();
    expect(pool.committedUnits).toBe(30);
    expect(pool.deadlineAt.getTime()).toBeGreaterThan(Date.now());
    expect((await db.payment.findUniqueOrThrow({ where: { id: payB.id } })).status).toBe("VENCIDO");
    expect((await db.participation.findFirstOrThrow({ where: { poolId, commerceId: b!.businessId! } })).status).toBe("LIBERADA");
    expect(await db.notification.count({ where: { userId: b!.id, type: "PAGO_VENCIDO" } })).toBe(1);

    // El comercio que ya pagó no puede modificar; uno nuevo completa y solo él recibe un pago nuevo.
    await expect(changeParticipation(a!, poolId, 40)).rejects.toMatchObject({ code: "YA_CONFIRMADA" });
    const [c] = await commerces(1);
    await changeParticipation(c!, poolId, 30);
    const payC = await db.payment.findFirstOrThrow({ where: { participation: { poolId, commerceId: c!.businessId! } } });
    await applyProviderUpdate(payC.id, approved(payC.id));
    expect((await db.pool.findUniqueOrThrow({ where: { id: poolId } })).status).toBe("CERRADO_PAGADO");
  });

  it("regla CERRAR_CON_PAGADO: cierra con lo pagado; si nadie paga, se cancela", async () => {
    await setConfig({ unpaidRule: "CERRAR_CON_PAGADO" });
    const poolId = await newOpenPool({ totalUnits: 100, minUnitsToClose: 60, minPerCommerce: 10, maxPerCommerce: 40 });
    const [a, b] = await commerces(2);
    await changeParticipation(a!, poolId, 30);
    await changeParticipation(b!, poolId, 30);
    const payA = await db.payment.findFirstOrThrow({ where: { participation: { poolId, commerceId: a!.businessId! } } });
    await applyProviderUpdate(payA.id, approved(payA.id));
    await db.payment.updateMany({ where: { participation: { poolId }, status: "PENDIENTE" }, data: { dueAt: new Date(Date.now() - 1_000) } });
    await runPaymentExpiry();
    const pool = await db.pool.findUniqueOrThrow({ where: { id: poolId } });
    expect(pool).toMatchObject({ status: "CERRADO_PAGADO", paidUnits: 30 });

    const nobody = await newOpenPool({ totalUnits: 100, minUnitsToClose: 20, minPerCommerce: 10, maxPerCommerce: 40 });
    const [d] = await commerces(1);
    await changeParticipation(d!, nobody, 20);
    await db.payment.updateMany({ where: { participation: { poolId: nobody } }, data: { dueAt: new Date(Date.now() - 1_000) } });
    await runPaymentExpiry();
    expect((await db.pool.findUniqueOrThrow({ where: { id: nobody } })).status).toBe("CANCELADO");
  });

  it("cancelar un pool cancela las participaciones y reintegra lo pagado", async () => {
    const poolId = await newOpenPool({ totalUnits: 100, minUnitsToClose: 20, closeOnMinimum: true, minPerCommerce: 10, maxPerCommerce: 40 });
    const [a] = await commerces(1);
    await changeParticipation(a!, poolId, 20);
    const pay = await db.payment.findFirstOrThrow({ where: { participation: { poolId } } });
    await applyProviderUpdate(pay.id, approved(pay.id));
    // Ya está CERRADO_PAGADO: el preventista no puede cancelarlo, el admin sí.
    await expect(cancelPool(distributor, poolId, "sin stock")).rejects.toMatchObject({ code: "NO_CANCELABLE" });
    await cancelPool(admin, poolId, "sin stock");
    expect((await db.pool.findUniqueOrThrow({ where: { id: poolId } })).status).toBe("CANCELADO");
    expect(await db.job.count({ where: { type: "REFUND_PAYMENT", payload: { contains: pay.id } } })).toBe(1);
  });

  it("un comercio fuera de la zona no puede sumarse", async () => {
    const poolId = await newOpenPool();
    const outside = await createUserWithBusiness("COMERCIO", { provinceId: 14, localityId: (await db.locality.findFirstOrThrow({ where: { provinceId: 14 } })).id });
    await expect(changeParticipation(outside, poolId, 10)).rejects.toMatchObject({ code: "FUERA_DE_ZONA" });
  });
});
