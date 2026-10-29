/**
 * Interfaz común de medios de pago. Hoy hay dos implementaciones:
 *  - MercadoPagoProvider (Checkout Pro + webhooks), en modo sandbox por defecto.
 *  - SimulatedProvider, solo para desarrollo/demo (ver README › Decisiones).
 * Para sumar transferencia con comprobante o efectivo contra entrega, se implementa
 * esta misma interfaz y se registra en payments/index.ts.
 */
export type ProviderName = "mercadopago" | "simulado";

export interface CheckoutRequest {
  paymentId: string;
  title: string;
  description: string;
  amountCents: number;
  payerEmail: string;
  payerName: string;
  dueAt: Date | null;
  /** URL de PEDILA a la que vuelve el comercio después de pagar. */
  returnUrl: string;
  notificationUrl: string;
}

export interface CheckoutResult {
  providerPreferenceId: string;
  checkoutUrl: string;
}

/** Estado normalizado de un cobro según el proveedor. */
export type ProviderPaymentState = "APPROVED" | "PENDING" | "REJECTED" | "CANCELLED" | "REFUNDED";

export interface ProviderPaymentInfo {
  providerPaymentId: string;
  state: ProviderPaymentState;
  providerStatus: string;
  /** Nuestro Payment.id (external_reference). */
  externalReference: string | null;
  amountCents: number | null;
  currency: string | null;
  paidAt: Date | null;
}

export interface WebhookRequest {
  headers: Headers;
  url: URL;
  rawBody: string;
}

export interface ParsedWebhook {
  /** Clave de idempotencia del evento. */
  eventKey: string;
  topic: string;
  /** Id del cobro en el proveedor (si el evento es de un pago). */
  resourceId: string | null;
  signatureValid: boolean | null; // null = no hay secreto configurado para validar
}

export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  getPayment(providerPaymentId: string): Promise<ProviderPaymentInfo>;
  refund(providerPaymentId: string, idempotencyKey: string): Promise<{ ok: boolean; info: string }>;
  parseWebhook(req: WebhookRequest): ParsedWebhook;
}
