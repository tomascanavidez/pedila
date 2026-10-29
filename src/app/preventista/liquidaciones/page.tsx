import type { Metadata } from "next";
import { DownloadLink } from "@/components/ui/download-link";
import { formatARS } from "@/domain/money";
import { formatDateAR } from "@/lib/dates";
import { SETTLEMENT_STATUS_LABEL } from "@/lib/labels";
import { buttonClass } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { listSettlements, settlementTotals } from "@/server/services/settlements";

export const metadata: Metadata = { title: "Liquidaciones" };

export default async function DistributorSettlementsPage() {
  const user = await requirePageUser(["PREVENTISTA"], "/preventista/liquidaciones");
  const [rows, totals] = await Promise.all([listSettlements({ distributorId: user.businessId! }), settlementTotals({ distributorId: user.businessId! })]);
  return (
    <>
      <PageHeader
        title="Liquidaciones"
        description="Lo cobrado en cada pool o pedido, la comisión de PEDILA y tu neto."
        actions={
          <DownloadLink href="/api/exportar/liquidaciones" button={buttonClass("secondary", "md")}>
            Exportar CSV
          </DownloadLink>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Neto pendiente de liquidar" value={formatARS(totals.pendingNetCents)} accent />
        <StatCard label="Neto ya liquidado" value={formatARS(totals.paidNetCents)} />
        <StatCard label="Comisión PEDILA (total)" value={formatARS(totals.commissionCents)} hint={`Sobre ventas por ${formatARS(totals.grossCents)}`} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Todavía no hay liquidaciones">Se generan automáticamente cuando un pool o pedido queda pagado.</EmptyState>
      ) : (
        <Table caption="Liquidaciones">
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Origen</Th>
              <Th>Bruto</Th>
              <Th>Comisión</Th>
              <Th>Neto</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <Td>{formatDateAR(s.createdAt)}</Td>
                <Td>
                  <span className="font-semibold">{s.sourceLabel}</span>
                  <span className="block text-xs text-muted">{s.sourceType === "POOL" ? "Pool" : "Pedido de catálogo"}</span>
                </Td>
                <Td className="tabular-nums">{formatARS(s.grossCents)}</Td>
                <Td className="tabular-nums">{formatARS(s.commissionCents)}</Td>
                <Td className="font-bold tabular-nums">{formatARS(s.netCents)}</Td>
                <Td>
                  <Badge tone={s.status === "LIQUIDADO" ? "outline" : "brand"}>{SETTLEMENT_STATUS_LABEL[s.status]}</Badge>
                  {s.reference ? <span className="block text-xs text-muted">Ref. {s.reference}</span> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
