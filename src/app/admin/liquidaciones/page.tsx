import type { Metadata } from "next";
import { DownloadLink } from "@/components/ui/download-link";
import Link from "next/link";
import type { SettlementStatus } from "@/generated/prisma/enums";
import { formatARS } from "@/domain/money";
import { formatDateAR, formatDateTimeAR } from "@/lib/dates";
import { ActionForm } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui/display";
import { markSettlementPaidAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { listSettlements, settlementTotals } from "@/server/services/settlements";

export const metadata: Metadata = { title: "Liquidaciones" };

export default async function AdminSettlementsPage(props: PageProps<"/admin/liquidaciones">) {
  const sp = await props.searchParams;
  await requirePageUser(["ADMIN"], "/admin/liquidaciones");
  const status: SettlementStatus = sp.estado === "LIQUIDADO" ? "LIQUIDADO" : "PENDIENTE";
  const [rows, totals] = await Promise.all([listSettlements({ status }), settlementTotals({})]);
  return (
    <>
      <PageHeader
        title="Liquidaciones a preventistas"
        description="Transferí el neto y registrá la referencia: el preventista recibe el aviso."
        actions={
          <DownloadLink href={`/api/exportar/liquidaciones?estado=${status}`}>Exportar CSV</DownloadLink>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Neto pendiente de transferir" value={formatARS(totals.pendingNetCents)} accent />
        <StatCard label="Neto ya liquidado" value={formatARS(totals.paidNetCents)} />
        <StatCard label="Comisiones PEDILA" value={formatARS(totals.commissionCents)} />
      </div>
      <div className="mb-4 flex gap-2">
        {(["PENDIENTE", "LIQUIDADO"] as const).map((s) => (
          <Link key={s} href={`/admin/liquidaciones?estado=${s}`} aria-current={s === status ? "page" : undefined} className={cn("min-h-[44px] rounded-full border-2 border-ink px-4 py-2 font-bold", s === status ? "bg-ink text-brand" : "hover:bg-brand-soft")}>
            {s === "PENDIENTE" ? "Pendientes" : "Liquidadas"}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={status === "PENDIENTE" ? "No hay liquidaciones pendientes" : "Todavía no hay liquidaciones pagadas"} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((s) => (
            <li key={s.id} className="card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-black">{s.distributorName}</p>
                  <p className="text-sm text-muted">
                    {s.sourceType === "POOL" ? "Pool" : "Pedido"}: {s.sourceLabel} · {formatDateAR(s.createdAt)}
                  </p>
                </div>
                <Badge tone={s.status === "LIQUIDADO" ? "outline" : "brand"}>{s.status === "LIQUIDADO" ? "Liquidada" : "Pendiente"}</Badge>
              </div>
              <p className="text-sm tabular-nums">
                Bruto {formatARS(s.grossCents)} · Comisión {formatARS(s.commissionCents)} · <b>Neto {formatARS(s.netCents)}</b>
              </p>
              {s.status === "PENDIENTE" ? (
                <ActionForm action={markSettlementPaidAction} submitLabel="Marcar como transferida" size="sm" className="sm:flex-row sm:items-end">
                  <input type="hidden" name="settlementId" value={s.id} />
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    Referencia de la transferencia
                    <input name="reference" required minLength={3} maxLength={120} className="field-input min-h-[40px] py-1.5" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    Nota (opcional)
                    <input name="notes" maxLength={500} className="field-input min-h-[40px] py-1.5" />
                  </label>
                </ActionForm>
              ) : (
                <p className="text-sm">
                  Transferida {s.paidOutAt ? formatDateTimeAR(s.paidOutAt) : ""} · ref. {s.reference}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
