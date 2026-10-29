import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db, disconnectDb } from "@/server/db";
import type { UserActor } from "@/server/services/actor";
import { applyProviderUpdate, processMercadoPagoWebhook, runPaymentExpiry } from "@/server/services/payments";
import { changeParticipation, publishPool, savePoolDraft } from "@/server/services/pools";
import { createProduct, createUserWithBusiness, ensureCategory, poolInput, setConfig } from "./factories";

const SECRET = "secreto-de-prueba";
// La base de test no se resetea entre corridas: todos los ids externos son únicos por corrida.
const RUN = Date.now().toString(36);
const MP_ID = String(Date.now());
const n = (name: string) => `${name}-${RUN}`;

function signedRequest(
  resourceId: string,
  notificationId: string,
  opts: { badSignature?: boolean; type?: string } = {},
) {
  const type = opts.type ?? "payment";
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = `req-${notificationId}`;
  const manifest = `id:${resourceId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", opts.badSignature ? "otro-secreto" : SECRET).update(manifest).digest("hex");
  const url = new URL(`http://localhost:3000/api/webhooks/mercadopago?data.id=${resourceId}&type=${type}`);
  const headers = new Headers({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId });
  const rawBody = JSON.stringify({ id: notificationId, type, action: `${type}.updated`, data: { id: resourceId } });
  return { url, headers, rawBody };
}

describe("pagos y webhooks", () => {
  let paymentId: string;
  let amount: number;
  let commerce: UserActor;

  beforeAll(async () => {
    await setConfig({ poolApprovalRequired: false, globalCommissionBps: 800, unpaidRule: "REABRIR" });
    const distributor = await createUserWithBusiness("PREVENTISTA");
    const cat = await ensureCategory("Golosinas");
    const product = await createProduct(distributor, cat.id);
    const draft = await savePoolDraft(distributor, poolInput(product.id, { totalUnits: 50, minUnitsToClose: 20, minPerCommerce: 10, maxPerCommerce: 30 }));
    await publishPool(distributor, draft.id);
    commerce = await createUserWithBusiness("COMERCIO");
    await changeParticipation(commerce, draft.id, 20);
    const payment = await db.payment.findFirstOrThrow({ where: { participation: { poolId: draft.id } } });
    paymentId = payment.id;
    amount = Number(payment.amountCents);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  it("el mismo webhook dos veces se procesa una sola vez (idempotencia por evento)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: Number(MP_ID), status: "approved", status_detail: "accredited", external_reference: paymentId, transaction_amount: amount / 100, currency_id: "ARS", date_approved: new Date().toISOString() }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await processMercadoPagoWebhook(signedRequest(MP_ID, n("notif-1")));
    expect(first).toEqual({ status: 200, result: "aplicado" });
    const second = await processMercadoPagoWebhook(signedRequest(MP_ID, n("notif-1")));
    expect(second).toEqual({ status: 200, result: "duplicado" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Otra notificación (otro id) del mismo pago: consulta la API pero no duplica efectos.
    const third = await processMercadoPagoWebhook(signedRequest(MP_ID, n("notif-2")));
    expect(third).toEqual({ status: 200, result: "duplicado" });

    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { participation: true } });
    expect(payment.status).toBe("APROBADO");
    expect(payment.providerPaymentId).toBe(MP_ID);
    expect(payment.participation?.status).toBe("PAGADA");
    expect(await db.notification.count({ where: { userId: commerce.id, type: "PAGO_APROBADO" } })).toBe(1);
    expect(await db.webhookEvent.count({ where: { eventKey: { in: [`n:${n("notif-1")}`, `n:${n("notif-2")}`] } } })).toBe(2);
  });

  it("rechaza firmas inválidas sin tocar la base", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await processMercadoPagoWebhook(signedRequest("111", n("notif-x"), { badSignature: true }));
    expect(res.status).toBe(401);
    expect(await db.webhookEvent.count({ where: { eventKey: `n:${n("notif-x")}` } })).toBe(0);
  });

  it("ignora tópicos sin acción (merchant_order) respondiendo 200 y sin consultar la API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await processMercadoPagoWebhook(signedRequest("55", n("notif-mo"), { type: "merchant_order" }));
    expect(res).toEqual({ status: 200, result: "ignorado" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una notificación sin firma se rechaza cuando hay secreto configurado", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const url = new URL("http://localhost:3000/api/webhooks/mercadopago?data.id=77&type=payment");
    const res = await processMercadoPagoWebhook({ url, headers: new Headers(), rawBody: "{}" });
    expect(res).toEqual({ status: 401, result: "firma inválida" });
  });

  it("si la API de MP falla, responde 500 y el reintento vuelve a procesarlo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status: 502 })));
    const res = await processMercadoPagoWebhook(signedRequest("222", n("notif-err")));
    expect(res.status).toBe(500);
    expect(await db.webhookEvent.count({ where: { eventKey: `n:${n("notif-err")}` } })).toBe(0);
  });

  it("un monto distinto al esperado no aprueba el pago", async () => {
    const other = await db.payment.create({
      data: { kind: "POOL", commerceId: commerce.businessId!, amountCents: 1_000n, commissionCents: 80n, netCents: 920n, provider: "simulado" },
    });
    const outcome = await applyProviderUpdate(other.id, {
      providerPaymentId: n("X1"),
      state: "APPROVED",
      providerStatus: "approved",
      externalReference: other.id,
      amountCents: 999,
      currency: "ARS",
      paidAt: new Date(),
    });
    expect(outcome).toBe("monto_inconsistente");
    expect((await db.payment.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("PENDIENTE");
  });

  it("un pago aprobado después de vencer se reintegra automáticamente", async () => {
    const late = await db.payment.create({
      data: {
        kind: "POOL",
        commerceId: commerce.businessId!,
        amountCents: 1_000n,
        commissionCents: 80n,
        netCents: 920n,
        provider: "simulado",
        dueAt: new Date(Date.now() - 1_000),
      },
    });
    await runPaymentExpiry();
    expect((await db.payment.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("VENCIDO");
    const outcome = await applyProviderUpdate(late.id, {
      providerPaymentId: n("LATE-1"),
      state: "APPROVED",
      providerStatus: "approved",
      externalReference: late.id,
      amountCents: 1_000,
      currency: "ARS",
      paidAt: new Date(),
    });
    expect(outcome).toBe("reintegro");
    expect(await db.job.count({ where: { type: "REFUND_PAYMENT", payload: { contains: late.id } } })).toBe(1);
  });
});
