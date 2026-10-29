import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CheckoutRequest,
  CheckoutResult,
  ParsedWebhook,
  PaymentProvider,
  ProviderPaymentInfo,
  ProviderPaymentState,
  WebhookRequest,
} from "./provider";

const API = "https://api.mercadopago.com";

/** Mapea los estados de Mercado Pago a los estados normalizados de PEDILA. */
export function mapMercadoPagoStatus(status: string): ProviderPaymentState {
  switch (status) {
    case "approved":
      return "APPROVED";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELLED";
    default:
      // pending, in_process, authorized, in_mediation
      return "PENDING";
  }
}

/**
 * Verificación de la firma x-signature de los webhooks de Mercado Pago:
 *   manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};"
 *   v1 = HMAC-SHA256(manifest, clave secreta) en hexadecimal.
 * Si falta alguno de los valores, se omite esa parte del manifest (según la doc de MP).
 */
export function verifyMercadoPagoSignature(params: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
  secret: string;
}): boolean {
  const { signatureHeader, requestId, secret } = params;
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k?.trim() ?? "", v.join("=").trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const dataId = params.dataId && /^[a-z0-9]+$/i.test(params.dataId) ? params.dataId.toLowerCase() : params.dataId;
  let manifest = "";
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** MP espera montos en pesos con hasta 2 decimales. */
export function centsToMpAmount(cents: number): number {
  return Math.round(cents) / 100;
}

export function mpAmountToCents(amount: number): number {
  return Math.round(amount * 100);
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = "mercadopago" as const;

  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret: string | undefined,
    private readonly useSandboxUrl: boolean,
  ) {}

  private async request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Mercado Pago respondió ${res.status}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const body = {
      items: [
        {
          id: req.paymentId,
          title: req.title.slice(0, 250),
          description: req.description.slice(0, 250),
          quantity: 1,
          currency_id: "ARS",
          unit_price: centsToMpAmount(req.amountCents),
        },
      ],
      payer: { email: req.payerEmail, name: req.payerName },
      external_reference: req.paymentId,
      notification_url: req.notificationUrl,
      back_urls: {
        success: `${req.returnUrl}?resultado=aprobado`,
        pending: `${req.returnUrl}?resultado=pendiente`,
        failure: `${req.returnUrl}?resultado=rechazado`,
      },
      auto_return: "approved",
      statement_descriptor: "PEDILA",
      metadata: { pedila_payment_id: req.paymentId },
      ...(req.dueAt
        ? {
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: req.dueAt.toISOString(),
            date_of_expiration: req.dueAt.toISOString(),
          }
        : {}),
    };
    const pref = await this.request<{ id: string; init_point: string; sandbox_init_point?: string }>(
      "/checkout/preferences",
      { method: "POST", body: JSON.stringify(body), idempotencyKey: `pref-${req.paymentId}` },
    );
    const url = this.useSandboxUrl && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
    return { providerPreferenceId: pref.id, checkoutUrl: url };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentInfo> {
    const p = await this.request<{
      id: number | string;
      status: string;
      status_detail?: string;
      external_reference?: string | null;
      transaction_amount?: number;
      currency_id?: string;
      date_approved?: string | null;
    }>(`/v1/payments/${encodeURIComponent(providerPaymentId)}`);
    return {
      providerPaymentId: String(p.id),
      state: mapMercadoPagoStatus(p.status),
      providerStatus: [p.status, p.status_detail].filter(Boolean).join(":").slice(0, 60),
      externalReference: p.external_reference ?? null,
      amountCents: typeof p.transaction_amount === "number" ? mpAmountToCents(p.transaction_amount) : null,
      currency: p.currency_id ?? null,
      paidAt: p.date_approved ? new Date(p.date_approved) : null,
    };
  }

  async refund(providerPaymentId: string, idempotencyKey: string): Promise<{ ok: boolean; info: string }> {
    const r = await this.request<{ id?: number | string; status?: string }>(
      `/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`,
      { method: "POST", body: "{}", idempotencyKey },
    );
    return { ok: true, info: `reintegro ${r.id ?? ""} ${r.status ?? ""}`.trim() };
  }

  parseWebhook(req: WebhookRequest): ParsedWebhook {
    let body: { id?: string | number; type?: string; topic?: string; action?: string; data?: { id?: string | number } } = {};
    try {
      body = req.rawBody ? JSON.parse(req.rawBody) : {};
    } catch {
      body = {};
    }
    const q = req.url.searchParams;
    const topic = String(body.type ?? body.topic ?? q.get("type") ?? q.get("topic") ?? "desconocido");
    const resourceId = String(body.data?.id ?? q.get("data.id") ?? q.get("id") ?? "") || null;
    const eventKey = body.id
      ? `n:${body.id}`
      : `${topic}:${resourceId ?? "-"}:${body.action ?? req.headers.get("x-request-id") ?? "-"}`;
    const signatureValid = this.webhookSecret
      ? verifyMercadoPagoSignature({
          signatureHeader: req.headers.get("x-signature"),
          requestId: req.headers.get("x-request-id"),
          dataId: q.get("data.id") ?? resourceId,
          secret: this.webhookSecret,
        })
      : null;
    return { eventKey: eventKey.slice(0, 191), topic, resourceId, signatureValid };
  }
}
