import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatARS, toCents } from "@/domain/money";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Card } from "@/components/ui/display";
import { simulatePaymentAction } from "@/server/actions/payments";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { simulatedPaymentsAllowed } from "@/server/env";

export const metadata: Metadata = { title: "Pago de prueba", robots: { index: false } };

/** Pantalla de checkout simulado (reemplaza a Mercado Pago en desarrollo). */
export default async function SimulatedCheckout(props: PageProps<"/pagos/simulado/[id]">) {
  const { id } = await props.params;
  if (!simulatedPaymentsAllowed()) notFound();
  const user = await requirePageUser(["COMERCIO", "ADMIN"], `/pagos/simulado/${id}`);
  const payment = await db.payment.findUnique({ where: { id } });
  if (!payment || payment.provider !== "simulado" || (user.role !== "ADMIN" && payment.commerceId !== user.businessId)) notFound();
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
      <Alert tone="warning">Modo de prueba: no se mueve dinero real. En producción este paso es el checkout de Mercado Pago.</Alert>
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-black">Checkout de prueba</h1>
        <p className="text-4xl font-black tabular-nums">{formatARS(toCents(payment.amountCents))}</p>
        {payment.status === "PENDIENTE" || payment.status === "EN_PROCESO" ? (
          <div className="flex flex-col gap-3">
            <ActionForm action={simulatePaymentAction} submitLabel="Aprobar pago" size="lg" buttonClassName="w-full">
              <input type="hidden" name="paymentId" value={payment.id} />
              <input type="hidden" name="decision" value="aprobar" />
            </ActionForm>
            <ActionForm action={simulatePaymentAction} submitLabel="Simular rechazo" variant="secondary" buttonClassName="w-full">
              <input type="hidden" name="paymentId" value={payment.id} />
              <input type="hidden" name="decision" value="rechazar" />
            </ActionForm>
          </div>
        ) : (
          <Alert>Este pago ya no está pendiente.</Alert>
        )}
      </Card>
    </div>
  );
}
