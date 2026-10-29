import type { Metadata } from "next";
import { formatARS, toCents } from "@/domain/money";
import { addDays, formatDateTimeAR, formatLongDateTimeAR, toLocalInputAR } from "@/lib/dates";
import { formatInt } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { OrderStatusBadge } from "@/components/ui/status-badge";
import { cancelOrderAction } from "@/server/actions/commerce";
import { markOrderDeliveredAction, scheduleOrderAction } from "@/server/actions/distributor";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Pedidos de catálogo" };

export default async function DistributorOrdersPage() {
  const user = await requirePageUser(["PREVENTISTA"], "/preventista/pedidos");
  const orders = await db.order.findMany({
    where: { distributorId: user.businessId! },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    include: { items: true, commerce: { include: { locality: { select: { name: true } } } } },
  });
  const defaultDate = toLocalInputAR(addDays(new Date(), 1));
  return (
    <>
      <PageHeader title="Pedidos de catálogo" description="Los pedidos se confirman cuando el comercio los paga." />
      {orders.length === 0 ? (
        <EmptyState title="Todavía no recibiste pedidos de catálogo" />
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <li key={o.id} className="card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-black">
                    #{o.number} · {o.commerce.tradeName}
                  </p>
                  <p className="text-sm text-muted">
                    {o.commerce.street} {o.commerce.streetNumber}, {o.commerce.locality.name} · {formatDateTimeAR(o.createdAt)}
                  </p>
                </div>
                <OrderStatusBadge status={o.status} />
              </div>
              <ul className="text-sm">
                {o.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span>
                      {formatInt(i.quantity)} × {i.name} <span className="text-muted">({i.sku})</span>
                    </span>
                    <span className="tabular-nums">{formatARS(toCents(i.totalCents))}</span>
                  </li>
                ))}
              </ul>
              <p className="flex justify-between border-t-2 border-line pt-2 font-bold">
                <span>Total · tu neto</span>
                <span className="tabular-nums">
                  {formatARS(toCents(o.subtotalCents))} · {formatARS(toCents(o.netCents))}
                </span>
              </p>
              {o.notes ? <p className="rounded-xl bg-brand-soft p-3 text-sm">Nota: {o.notes}</p> : null}
              {o.scheduledDeliveryAt && o.status === "EN_ENTREGA" ? <p className="text-sm font-bold">Entrega: {formatLongDateTimeAR(o.scheduledDeliveryAt)}</p> : null}
              {o.status === "PAGADO" || o.status === "EN_ENTREGA" ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <ActionForm action={scheduleOrderAction} submitLabel={o.scheduledDeliveryAt ? "Reprogramar" : "Programar entrega"} size="sm" variant="secondary" className="sm:flex-row sm:items-end">
                    <input type="hidden" name="orderId" value={o.id} />
                    <label className="flex flex-col gap-1 text-sm font-bold">
                      Fecha de entrega
                      <input type="datetime-local" name="date" required defaultValue={o.scheduledDeliveryAt ? toLocalInputAR(o.scheduledDeliveryAt) : defaultDate} className="field-input" />
                    </label>
                  </ActionForm>
                  <ActionForm action={markOrderDeliveredAction} submitLabel="Marcar entregado" size="sm" inline>
                    <input type="hidden" name="orderId" value={o.id} />
                  </ActionForm>
                </div>
              ) : null}
              {o.status === "PENDIENTE_PAGO" || o.status === "PAGADO" ? (
                <ActionForm action={cancelOrderAction} submitLabel="Cancelar pedido" size="sm" variant="secondary" confirm="¿Cancelar el pedido? Si ya se pagó, se reintegra el dinero." inline>
                  <input type="hidden" name="orderId" value={o.id} />
                  <input type="hidden" name="reason" value="Cancelado por el preventista" />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
