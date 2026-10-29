import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTimeAR, formatLongDateTimeAR } from "@/lib/dates";
import { formatInt, unitsText } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, EmptyState, PageHeader, Stars } from "@/components/ui/display";
import { StarInput } from "@/components/ui/star-input";
import { rateAction } from "@/server/actions/commerce";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Entregas" };

interface DeliveryRow {
  key: string;
  title: string;
  detail: string;
  distributor: string;
  when: Date | null;
  delivered: Date | null;
  participationId?: string;
  orderId?: string;
  rating: number | null;
}

export default async function DeliveriesPage() {
  const user = await requirePageUser(["COMERCIO"], "/comercio/entregas");
  const businessId = user.businessId!;
  const [parts, orders] = await Promise.all([
    db.participation.findMany({
      where: { commerceId: businessId, status: { in: ["PAGADA", "ENTREGADA"] } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { pool: { include: { distributor: { select: { tradeName: true } } } }, rating: true },
    }),
    db.order.findMany({
      where: { commerceId: businessId, status: { in: ["PAGADO", "EN_ENTREGA", "ENTREGADO"] } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { distributor: { select: { tradeName: true } }, rating: true, items: true },
    }),
  ]);
  const rows: DeliveryRow[] = [
    ...parts.map((p) => ({
      key: `p-${p.id}`,
      title: p.pool.title,
      detail: unitsText(p.quantity, p.pool.saleUnit),
      distributor: p.pool.distributor.tradeName,
      when: p.pool.scheduledDeliveryAt ?? p.pool.estimatedDeliveryAt,
      delivered: p.deliveredAt,
      participationId: p.id,
      rating: p.rating?.stars ?? null,
    })),
    ...orders.map((o) => ({
      key: `o-${o.id}`,
      title: `Pedido #${o.number}`,
      detail: `${formatInt(o.items.reduce((a, i) => a + i.quantity, 0))} productos`,
      distributor: o.distributor.tradeName,
      when: o.scheduledDeliveryAt,
      delivered: o.deliveredAt,
      orderId: o.id,
      rating: o.rating?.stars ?? null,
    })),
  ];
  const upcoming = rows.filter((r) => !r.delivered).sort((a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity));
  const done = rows.filter((r) => r.delivered).sort((a, b) => b.delivered!.getTime() - a.delivered!.getTime());

  return (
    <>
      <PageHeader title="Entregas" description="Lo que pagaste y está por llegar, y lo que ya recibiste." />
      <section aria-labelledby="por-llegar" className="mb-8">
        <h2 id="por-llegar" className="mb-3 text-xl font-black">
          Por llegar
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState title="No tenés entregas pendientes" />
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((r) => (
              <li key={r.key} className="card flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold">{r.title}</p>
                  <p className="text-sm text-muted">
                    {r.detail} · {r.distributor}
                  </p>
                </div>
                {r.when ? <Badge tone="brand">{formatLongDateTimeAR(r.when)}</Badge> : <Badge tone="outline">Fecha a confirmar</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="recibidas">
        <h2 id="recibidas" className="mb-3 text-xl font-black">
          Recibidas
        </h2>
        {done.length === 0 ? (
          <EmptyState title="Todavía no recibiste entregas" />
        ) : (
          <ul className="flex flex-col gap-3">
            {done.map((r) => (
              <li key={r.key} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{r.title}</p>
                    <p className="text-sm text-muted">
                      {r.detail} · {r.distributor} · entregado {formatDateTimeAR(r.delivered!)}
                    </p>
                  </div>
                  {r.rating ? (
                    <span className="flex items-center gap-2 text-sm">
                      Tu calificación: <Stars value={r.rating} />
                    </span>
                  ) : null}
                </div>
                {r.rating === null ? (
                  <ActionForm action={rateAction} submitLabel="Enviar calificación" size="sm" className="max-w-md" buttonClassName="self-start">
                    {r.participationId ? <input type="hidden" name="participationId" value={r.participationId} /> : null}
                    {r.orderId ? <input type="hidden" name="orderId" value={r.orderId} /> : null}
                    <StarInput label={`¿Cómo te fue con ${r.distributor}?`} />
                    <label className="flex flex-col gap-1 text-sm font-bold">
                      Comentario (opcional)
                      <textarea name="comment" maxLength={1000} className="field-input min-h-[70px]" />
                    </label>
                  </ActionForm>
                ) : null}
                <Link href={`/comercio/reclamos?ref=${r.participationId ? `p:${r.participationId}` : `o:${r.orderId}`}`} className="text-sm font-semibold underline underline-offset-4">
                  ¿Tuviste un problema? Hacé un reclamo
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
