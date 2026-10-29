import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { LIMITS } from "@/lib/rate-limit";
import { activePaymentProvider } from "@/server/env";
import { ipOf, limited } from "@/server/http";
import { processMercadoPagoWebhook } from "@/server/services/payments";

/**
 * Webhook de Mercado Pago (Checkout Pro). Idempotente: cada notificación se registra
 * con una clave única y el estado del pago siempre se consulta a la API de MP.
 * Exento de la verificación CSRF de origen (lo llama Mercado Pago), pero con firma.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const blocked = limited(`webhook:${ipOf(req)}`, LIMITS.webhook);
  if (blocked) return blocked;
  if (activePaymentProvider() !== "mercadopago" && !process.env.MP_ACCESS_TOKEN) {
    return NextResponse.json({ result: "Mercado Pago no está configurado" }, { status: 200 });
  }
  const rawBody = (await req.text()).slice(0, 100_000);
  const result = await processMercadoPagoWebhook({ headers: req.headers, url: new URL(req.url), rawBody });
  // Un pago aprobado puede cerrar o reabrir un pool: se invalida el caché de páginas públicas.
  if (result.result === "aplicado" || result.result === "reintegro") revalidateTag("pools", { expire: 0 });
  return NextResponse.json({ result: result.result }, { status: result.status });
}
