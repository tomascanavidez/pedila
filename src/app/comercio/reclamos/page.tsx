import type { Metadata } from "next";
import { formatDateTimeAR } from "@/lib/dates";
import { DISPUTE_STATUS_LABEL } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/display";
import { openDisputeAction } from "@/server/actions/commerce";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { DISPUTE_REASONS } from "@/server/services/feedback";

export const metadata: Metadata = { title: "Reclamos" };

export default async function DisputesPage(props: PageProps<"/comercio/reclamos">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["COMERCIO"], "/comercio/reclamos");
  const businessId = user.businessId!;
  const [disputes, parts, orders] = await Promise.all([
    db.dispute.findMany({
      where: { commerceId: businessId },
      orderBy: { createdAt: "desc" },
      include: { pool: { select: { title: true } }, order: { select: { number: true } }, distributor: { select: { tradeName: true } } },
    }),
    db.participation.findMany({
      where: { commerceId: businessId, status: { in: ["PAGADA", "ENTREGADA"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { pool: { select: { title: true } } },
    }),
    db.order.findMany({ where: { commerceId: businessId, status: { in: ["PAGADO", "EN_ENTREGA", "ENTREGADO"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const options = [
    ...parts.map((p) => ({ value: `p:${p.id}`, label: `Pool: ${p.pool.title}` })),
    ...orders.map((o) => ({ value: `o:${o.id}`, label: `Pedido #${o.number}` })),
  ];
  const preselected = typeof sp.ref === "string" ? sp.ref : "";
  return (
    <>
      <PageHeader title="Reclamos" description="Si algo salió mal con una compra, contanos y lo resolvemos con el preventista." />
      {options.length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-lg font-black">Nuevo reclamo</h2>
          <ActionForm action={openDisputeAction} submitLabel="Enviar reclamo" resetOnSuccess>
            <label className="flex flex-col gap-1 text-sm font-bold">
              Compra
              <select name="ref" required defaultValue={preselected} className="field-input">
                <option value="">Elegí la compra</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              Motivo
              <select name="reason" required className="field-input" defaultValue="">
                <option value="">Elegí el motivo</option>
                {Object.entries(DISPUTE_REASONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold">
              Contanos qué pasó
              <textarea name="description" required minLength={10} maxLength={5000} className="field-input min-h-[110px]" />
            </label>
          </ActionForm>
        </Card>
      ) : null}
      {disputes.length === 0 ? (
        <EmptyState title="No tenés reclamos" />
      ) : (
        <ul className="flex flex-col gap-3">
          {disputes.map((d) => (
            <li key={d.id} className="card flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-bold">
                  {DISPUTE_REASONS[d.reason as keyof typeof DISPUTE_REASONS] ?? d.reason} · {d.pool ? d.pool.title : `Pedido #${d.order?.number}`}
                </p>
                <Badge tone={d.status === "ABIERTA" || d.status === "EN_REVISION" ? "brand" : "outline"}>{DISPUTE_STATUS_LABEL[d.status]}</Badge>
              </div>
              <p className="text-sm text-muted">
                {d.distributor.tradeName} · {formatDateTimeAR(d.createdAt)}
              </p>
              <p className="whitespace-pre-line">{d.description}</p>
              {d.distributorResponse ? <p className="rounded-xl bg-brand-soft p-3 text-sm"><b>Respuesta del preventista:</b> {d.distributorResponse}</p> : null}
              {d.resolution ? <p className="rounded-xl border-2 border-ink p-3 text-sm"><b>Resolución de PEDILA:</b> {d.resolution}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
