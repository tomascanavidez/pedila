import "server-only";
import type {
  CheckoutRequest,
  CheckoutResult,
  ParsedWebhook,
  PaymentProvider,
  ProviderPaymentInfo,
  WebhookRequest,
} from "./provider";

/**
 * Proveedor SIMULADO (solo desarrollo y demos).
 * El "checkout" es una página de PEDILA (/pagos/simulado/[id]) con botones para aprobar
 * o rechazar, que aplica el resultado por el mismo camino que un webhook real
 * (payments.applyProviderUpdate). En producción queda deshabilitado salvo que se
 * active explícitamente ALLOW_SIMULATED_PAYMENTS=true.
 */
export class SimulatedProvider implements PaymentProvider {
  readonly name = "simulado" as const;

  constructor(private readonly appUrl: string) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    return {
      providerPreferenceId: `SIM-PREF-${req.paymentId}`,
      checkoutUrl: `${this.appUrl}/pagos/simulado/${req.paymentId}`,
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentInfo> {
    // Los pagos simulados se aplican directamente; esta consulta solo devuelve un aprobado.
    return {
      providerPaymentId,
      state: "APPROVED",
      providerStatus: "simulado:approved",
      externalReference: providerPaymentId.replace(/^SIM-/, ""),
      amountCents: null,
      currency: "ARS",
      paidAt: new Date(),
    };
  }

  async refund(providerPaymentId: string): Promise<{ ok: boolean; info: string }> {
    return { ok: true, info: `reintegro simulado de ${providerPaymentId}` };
  }

  parseWebhook(req: WebhookRequest): ParsedWebhook {
    return { eventKey: `sim:${req.url.searchParams.get("id") ?? "x"}`, topic: "simulado", resourceId: null, signatureValid: null };
  }
}
