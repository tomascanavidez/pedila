import type { Metadata } from "next";
import Link from "next/link";
import { formatARS, toCents } from "@/domain/money";
import { formatDateTimeAR, formatLongDateTimeAR } from "@/lib/dates";
import { formatInt } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { OrderStatusBadge } from "@/components/ui/status-badge";
import { cancelOrderAction } from "@/server/actions/commerce";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Mis pedidos" };

export default async function OrdersPage() {
  const user = await requirePageUser(["COMERCIO"], "/comercio/pedidos");
  const orders = await db.order.findMany({
    where: { commerceId: user.businessId! },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { items: true, distributor: { select: { tradeName: true } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return (
    <>
      <PageHeader title="Mis pedidos" description="Pedidos directos al catálogo de cada preventista." actions={<ButtonLink href="/catalogo">Ir al catálogo</ButtonLink>} />
      {orders.length === 0 ? (
        <EmptyState title="Todavía no hiciste pedidos de catálogo" />
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => {
            const payment = o.payments[0];
            return (
              <li key={o.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-black">Pedido #{o.number}</p>
                    <p className="text-sm text-muted">
                      {o.distributor.tradeName} · {formatDateTimeAR(o.createdAt)}
                    </p>
                  </div>
                  <OrderStatusBadge status={o.status} />
                </div>
                <ul className="text-sm">
                  {o.items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <span>
                        {formatInt(i.quantity)} × {i.name}
                      </span>
                      <span className="tabular-nums">{formatARS(toCents(i.totalCents))}</span>
                    </li>
                  ))}
                </ul>
                <p className="flex justify-between border-t-2 border-line pt-2 font-bold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatARS(toCents(o.subtotalCents))}</span>
                </p>
                {o.scheduledDeliveryAt && o.status === "EN_ENTREGA" ? (
                  <p className="text-sm font-semibold">Entrega: {formatLongDateTimeAR(o.scheduledDeliveryAt)}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {o.status === "PENDIENTE_PAGO" && payment ? (
                    <>
                      <ButtonLink href={`/comercio/pagos/${payment.id}`} variant="dark" size="sm">
                        Pagar
                      </ButtonLink>
                      <ActionForm action={cancelOrderAction} submitLabel="Cancelar pedido" variant="secondary" size="sm" confirm="¿Cancelar este pedido?" inline>
                        <input type="hidden" name="orderId" value={o.id} />
                      </ActionForm>
                    </>
                  ) : null}
                  {o.status === "ENTREGADO" ? (
                    <Link href="/comercio/entregas" className="text-sm font-bold underline underline-offset-4">
                      Calificar o reclamar
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
