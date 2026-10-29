import "server-only";
import { activePaymentProvider, getEnv, simulatedPaymentsAllowed } from "../env";
import { MercadoPagoProvider } from "./mercadopago";
import type { PaymentProvider, ProviderName } from "./provider";
import { SimulatedProvider } from "./simulated";

const cache = new Map<ProviderName, PaymentProvider>();

export function getProvider(name: ProviderName = activePaymentProvider()): PaymentProvider {
  const existing = cache.get(name);
  if (existing) return existing;
  const env = getEnv();
  let provider: PaymentProvider;
  if (name === "mercadopago") {
    if (!env.MP_ACCESS_TOKEN) throw new Error("Falta MP_ACCESS_TOKEN para usar Mercado Pago");
    provider = new MercadoPagoProvider(env.MP_ACCESS_TOKEN, env.MP_WEBHOOK_SECRET, env.MP_USE_SANDBOX);
  } else {
    if (!simulatedPaymentsAllowed()) {
      throw new Error("Los pagos simulados están deshabilitados en producción (ALLOW_SIMULATED_PAYMENTS)");
    }
    provider = new SimulatedProvider(env.APP_URL.replace(/\/$/, ""));
  }
  cache.set(name, provider);
  return provider;
}

export type { PaymentProvider, ProviderName } from "./provider";
