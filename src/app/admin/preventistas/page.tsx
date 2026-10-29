import type { Metadata } from "next";
import { formatCuit } from "@/domain/cuit";
import { formatDateTimeAR } from "@/lib/dates";
import { IVA_OPTIONS } from "@/lib/validation";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, DataList, EmptyState, PageHeader, Stars } from "@/components/ui/display";
import { reviewDistributorAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Preventistas" };

export default async function DistributorsAdminPage() {
  await requirePageUser(["ADMIN"], "/admin/preventistas");
  const list = await db.business.findMany({
    where: { user: { role: "PREVENTISTA" } },
    orderBy: [{ distributorStatus: "asc" }, { createdAt: "desc" }],
    include: {
      user: { select: { email: true, name: true, phone: true } },
      locality: { select: { name: true } },
      province: { select: { name: true } },
      coverage: { include: { province: { select: { name: true } }, locality: { select: { name: true } } } },
      _count: { select: { poolsAsDistributor: true, products: true } },
    },
  });
  const pending = list.filter((b) => b.distributorStatus === "PENDIENTE");
  const rest = list.filter((b) => b.distributorStatus !== "PENDIENTE");
  const card = (b: (typeof list)[number]) => (
    <li key={b.id} className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-black">{b.tradeName}</p>
          <p className="text-sm text-muted">{b.legalName}</p>
        </div>
        <Badge tone={b.distributorStatus === "APROBADO" ? "outline" : b.distributorStatus === "PENDIENTE" ? "brand" : "muted"}>{b.distributorStatus}</Badge>
      </div>
      <DataList
        items={[
          { label: "CUIT", value: formatCuit(b.cuit) },
          { label: "Condición IVA", value: IVA_OPTIONS[b.ivaCondition] },
          { label: "Contacto", value: `${b.user.name} · ${b.user.email}${b.user.phone ? ` · ${b.user.phone}` : ""}` },
          { label: "Dirección", value: `${b.street} ${b.streetNumber}, ${b.locality.name}, ${b.province.name}` },
          { label: "Reparte en", value: b.coverage.map((c) => (c.locality ? c.locality.name : `Toda ${c.province.name}`)).join(", ") || "—" },
          { label: "Actividad", value: `${b._count.products} productos · ${b._count.poolsAsDistributor} pools · registrado ${formatDateTimeAR(b.createdAt)}` },
          { label: "Calificación", value: <Stars value={b.ratingAvg} count={b.ratingCount} /> },
        ]}
      />
      {b.description ? <p className="text-sm">{b.description}</p> : null}
      {b.distributorStatus !== "APROBADO" ? (
        <div className="flex flex-wrap items-end gap-2">
          <ActionForm action={reviewDistributorAction} submitLabel="Aprobar" inline>
            <input type="hidden" name="businessId" value={b.id} />
            <input type="hidden" name="decision" value="aprobar" />
          </ActionForm>
          {b.distributorStatus === "PENDIENTE" ? (
            <ActionForm action={reviewDistributorAction} submitLabel="Rechazar" variant="secondary" className="sm:flex-row sm:items-end">
              <input type="hidden" name="businessId" value={b.id} />
              <input type="hidden" name="decision" value="rechazar" />
              <label className="sr-only" htmlFor={`r-${b.id}`}>Motivo</label>
              <input id={`r-${b.id}`} name="reason" required placeholder="Motivo del rechazo" className="field-input" />
            </ActionForm>
          ) : null}
        </div>
      ) : null}
      {b.rejectionReason ? <p className="text-sm">Motivo del rechazo: {b.rejectionReason}</p> : null}
    </li>
  );
  return (
    <>
      <PageHeader title="Preventistas" description="Validá los datos fiscales antes de habilitar las publicaciones." />
      <h2 className="mb-3 text-xl font-black">Pendientes de aprobación ({pending.length})</h2>
      {pending.length === 0 ? <EmptyState title="No hay preventistas esperando aprobación" /> : <ul className="mb-8 flex flex-col gap-3">{pending.map(card)}</ul>}
      <h2 className="mb-3 mt-8 text-xl font-black">Todos</h2>
      <ul className="flex flex-col gap-3">{rest.map(card)}</ul>
    </>
  );
}
