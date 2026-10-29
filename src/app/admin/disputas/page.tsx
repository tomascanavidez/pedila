import type { Metadata } from "next";
import { formatDateTimeAR } from "@/lib/dates";
import { DISPUTE_STATUS_LABEL } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, EmptyState, PageHeader } from "@/components/ui/display";
import { resolveDisputeAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { DISPUTE_REASONS } from "@/server/services/feedback";

export const metadata: Metadata = { title: "Disputas" };

export default async function AdminDisputesPage() {
  await requirePageUser(["ADMIN"], "/admin/disputas");
  const disputes = await db.dispute.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      commerce: { select: { tradeName: true } },
      distributor: { select: { tradeName: true } },
      pool: { select: { id: true, title: true } },
      order: { select: { number: true } },
      openedBy: { select: { email: true } },
    },
  });
  return (
    <>
      <PageHeader title="Disputas" description="Reclamos de comercios. Las resoluciones se notifican a ambas partes." />
      {disputes.length === 0 ? (
        <EmptyState title="No hay disputas" />
      ) : (
        <ul className="flex flex-col gap-3">
          {disputes.map((d) => (
            <li key={d.id} className="card flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-black">
                  {DISPUTE_REASONS[d.reason as keyof typeof DISPUTE_REASONS] ?? d.reason} · {d.pool ? d.pool.title : `Pedido #${d.order?.number}`}
                </p>
                <Badge tone={d.status === "ABIERTA" ? "brand" : d.status === "EN_REVISION" ? "dark" : "outline"}>{DISPUTE_STATUS_LABEL[d.status]}</Badge>
              </div>
              <p className="text-sm text-muted">
                {d.commerce.tradeName} ({d.openedBy.email}) → {d.distributor.tradeName} · {formatDateTimeAR(d.createdAt)}
              </p>
              <p className="whitespace-pre-line">{d.description}</p>
              {d.distributorResponse ? <p className="rounded-xl bg-brand-soft p-3 text-sm"><b>Preventista:</b> {d.distributorResponse}</p> : null}
              {d.resolution ? <p className="rounded-xl border-2 border-ink p-3 text-sm"><b>Resolución:</b> {d.resolution}</p> : null}
              {d.status === "ABIERTA" || d.status === "EN_REVISION" ? (
                <ActionForm action={resolveDisputeAction} submitLabel="Guardar" size="sm" buttonClassName="self-start">
                  <input type="hidden" name="disputeId" value={d.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
                    <label className="flex flex-col gap-1 text-sm font-bold">
                      Estado
                      <select name="status" defaultValue="RESUELTA" className="field-input">
                        <option value="EN_REVISION">En revisión</option>
                        <option value="RESUELTA">Resuelta</option>
                        <option value="RECHAZADA">Rechazada</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-bold">
                      Resolución / comentario
                      <textarea name="resolution" required className="field-input min-h-[80px]" />
                    </label>
                  </div>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
