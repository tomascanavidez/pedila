import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatARS, toCents } from "@/domain/money";
import { formatDateTimeAR, formatLongDateTimeAR, isPast } from "@/lib/dates";
import { unitsText } from "@/lib/labels";
import { ClearCartForDistributor } from "@/components/catalog/clear-cart";
import { PaymentAutoRefresh } from "@/components/payments/auto-refresh";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Alert, Card, DataList, PageHeader } from "@/components/ui/display";
import { PaymentStatusBadge } from "@/components/ui/status-badge";
import { startPaymentAction } from "@/server/actions/commerce";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { activePaymentProvider } from "@/server/env";

export const metadata: Metadata = { title: "Pagar" };

const RESULT: Record<string, { tone: "info" | "warning" | "error"; text: string }> = {
  aprobado: { tone: "info", text: "¡Gracias! Mercado Pago aprobó tu pago. Lo estamos confirmando (puede tardar unos segundos)." },
  pendiente: { tone: "warning", text: "Tu pago quedó pendiente en Mercado Pago (por ejemplo, efectivo). Te avisamos cuando se acredite." },
  rechazado: { tone: "error", text: "El pago fue rechazado. Probá con otro medio antes de que venza el plazo." },
};

export default async function PayPage(props: PageProps<"/comercio/pagos/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requirePageUser(["COMERCIO"], `/comercio/pagos/${id}`);
  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      participation: { include: { pool: { include: { distributor: { select: { tradeName: true } } } } } },
      order: { include: { items: true, distributor: { select: { tradeName: true } } } },
    },
  });
  if (!payment || payment.commerceId !== user.businessId) notFound();
  const payable = (payment.status === "PENDIENTE" || payment.status === "EN_PROCESO") && (!payment.dueAt || !isPast(payment.dueAt));
  const result = typeof sp.resultado === "string" ? RESULT[sp.resultado] : undefined;
  const provider = payment.provider === "mercadopago" ? "Mercado Pago" : activePaymentProvider() === "simulado" ? "pago de prueba" : payment.provider;

  return (
    <>
      <PageHeader title="Pagar" description={payment.participation ? payment.participation.pool.title : `Pedido #${payment.order?.number}`} />
      <div className="flex flex-col gap-4">
        {sp.pedido && payment.order ? (
          <>
            <ClearCartForDistributor distributorId={payment.order.distributorId} />
            <Alert>¡Pedido creado! Pagalo para confirmarlo con el preventista.</Alert>
          </>
        ) : null}
        {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
        {payment.status === "PENDIENTE" && sp.resultado === "aprobado" ? <PaymentAutoRefresh /> : null}
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">Estado</p>
            <PaymentStatusBadge status={payment.status} />
          </div>
          <p className="text-4xl font-black tabular-nums">{formatARS(toCents(payment.amountCents))}</p>
          <DataList
            items={[
              ...(payment.participation
                ? [
                    { label: "Pool", value: payment.participation.pool.title },
                    { label: "Cantidad", value: unitsText(payment.participation.quantity, payment.participation.pool.saleUnit) },
                    { label: "Preventista", value: payment.participation.pool.distributor.tradeName },
                  ]
                : payment.order
                  ? [
                      { label: "Pedido", value: `#${payment.order.number} · ${payment.order.items.length} productos` },
                      { label: "Preventista", value: payment.order.distributor.tradeName },
                    ]
                  : []),
              ...(payment.dueAt ? [{ label: "Vence", value: formatLongDateTimeAR(payment.dueAt) }] : []),
              ...(payment.paidAt ? [{ label: "Pagado", value: formatDateTimeAR(payment.paidAt) }] : []),
            ]}
          />
          {payable ? (
            <>
              {payment.dueAt ? (
                <p className="rounded-xl border-2 border-ink bg-brand px-3 py-2 font-bold">
                  Te quedan <Countdown to={payment.dueAt.toISOString()} fallback={formatDateTimeAR(payment.dueAt)} /> para pagar.
                </p>
              ) : null}
              <ActionForm action={startPaymentAction} submitLabel={`Pagar con ${provider}`} pendingLabel="Abriendo el pago…" size="lg" buttonClassName="w-full">
                <input type="hidden" name="paymentId" value={payment.id} />
              </ActionForm>
              <p className="flex items-center gap-2 text-sm text-muted">
                <ShieldCheck aria-hidden="true" className="h-4 w-4" /> El pago se procesa en {provider}. PEDILA no guarda datos de tarjetas.
              </p>
            </>
          ) : payment.status === "APROBADO" ? (
            <p className="flex items-center gap-2 text-lg font-bold">
              <CheckCircle2 aria-hidden="true" className="h-6 w-6" /> Pago acreditado. ¡Gracias!
            </p>
          ) : (
            <Alert tone="warning">Este pago ya no se puede abonar.</Alert>
          )}
        </Card>
        <ButtonLink href="/comercio/pagos" variant="secondary">
          Volver a mis pagos
        </ButtonLink>
      </div>
    </>
  );
}
