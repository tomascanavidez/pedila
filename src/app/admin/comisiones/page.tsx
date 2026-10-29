import type { Metadata } from "next";
import { DownloadLink } from "@/components/ui/download-link";
import { computePoolCalculation, resolveCommission } from "@/domain/commission";
import { formatARS, formatBps } from "@/domain/money";
import { formatDateTimeAR } from "@/lib/dates";
import { COMMISSION_MODE_LABEL } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader, Table, Td, Th } from "@/components/ui/display";
import { setCategoryCommissionAction, setDistributorCommissionAction, updateCommissionSettingsAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { getPlatformConfig } from "@/server/config";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Comisiones" };

const pct = (bps: number | null) => (bps === null ? "" : (bps / 100).toString().replace(".", ","));

export default async function CommissionsPage() {
  await requirePageUser(["ADMIN"], "/admin/comisiones");
  const [config, categories, distributors, history] = await Promise.all([
    getPlatformConfig(),
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.business.findMany({ where: { user: { role: "PREVENTISTA" } }, orderBy: { tradeName: "asc" } }),
    db.commissionChange.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { changedBy: { select: { name: true, email: true } } } }),
  ]);
  // Ejemplo numérico con la configuración actual: pallet de 600 u. a $ 1.500.
  const example = computePoolCalculation({ inputCents: 150_000, bps: config.globalCommissionBps, mode: config.commissionMode, totalUnits: 600, minUnitsToClose: 480 });

  return (
    <>
      <PageHeader title="Comisiones" description="Prioridad: preventista > categoría > global. El % se congela en cada pool al publicarlo." />
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-lg font-black">Comisión global y modo de cobro</h2>
          <ActionForm action={updateCommissionSettingsAction} submitLabel="Guardar" buttonClassName="self-start">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                Comisión global (%)
                <input name="globalPercent" required inputMode="decimal" defaultValue={pct(config.globalCommissionBps)} className="field-input" aria-describedby="global-help" />
                <span id="global-help" className="font-normal text-muted">Entre 0 y 50, hasta 2 decimales (ej. 8,5).</span>
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Modo de cobro
                <select name="mode" defaultValue={config.commissionMode} className="field-input">
                  {Object.entries(COMMISSION_MODE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex min-h-[44px] items-center gap-3 font-semibold">
              <input type="checkbox" name="catalogCommissionEnabled" defaultChecked={config.catalogCommissionEnabled} className="h-6 w-6 accent-[#111111]" />
              Cobrar comisión también en pedidos de catálogo
            </label>
          </ActionForm>
          <p className="mt-4 rounded-xl bg-brand-soft p-3 text-sm">
            Con la configuración actual, un pallet de 600 u. a {formatARS(150_000)} genera {formatARS(example.full.commissionCents)} de comisión y el preventista recibe{" "}
            {formatARS(example.full.netCents)} ({formatBps(config.globalCommissionBps)}, {COMMISSION_MODE_LABEL[config.commissionMode].toLowerCase()}).
          </p>
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-black">Overrides por categoría</h2>
          <p className="mb-3 text-sm text-muted">Dejá vacío para usar la global.</p>
          <ul className="flex flex-col gap-3">
            {categories.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-bold">{c.name}</p>
                  <p className="text-sm text-muted">Aplica: {formatBps(resolveCommission({ globalBps: config.globalCommissionBps, categoryBps: c.commissionBps }).bps)}</p>
                </div>
                <ActionForm action={setCategoryCommissionAction} submitLabel="Guardar" size="sm" variant="secondary" className="sm:flex-row sm:items-end">
                  <input type="hidden" name="targetId" value={c.id} />
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    % categoría
                    <input name="percent" inputMode="decimal" defaultValue={pct(c.commissionBps)} placeholder="global" className="field-input w-32" />
                  </label>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-black">Overrides por preventista</h2>
          <p className="mb-3 text-sm text-muted">Tienen prioridad sobre la categoría y la global.</p>
          <ul className="flex flex-col gap-3">
            {distributors.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-bold">{d.tradeName}</p>
                  <p className="text-sm text-muted">{d.commissionBps === null ? "Usa categoría / global" : `Acordada: ${formatBps(d.commissionBps)}`}</p>
                </div>
                <ActionForm action={setDistributorCommissionAction} submitLabel="Guardar" size="sm" variant="secondary" className="sm:flex-row sm:items-end">
                  <input type="hidden" name="targetId" value={d.id} />
                  <label className="flex flex-col gap-1 text-sm font-bold">
                    % preventista
                    <input name="percent" inputMode="decimal" defaultValue={pct(d.commissionBps)} placeholder="sin override" className="field-input w-32" />
                  </label>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>

        <section aria-labelledby="historial-comisiones">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="historial-comisiones" className="text-xl font-black">
              Historial de cambios
            </h2>
            <DownloadLink href="/api/exportar/comisiones">CSV</DownloadLink>
          </div>
          <Table caption="Historial de cambios de comisión">
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Quién</Th>
                <Th>Sobre</Th>
                <Th>Anterior</Th>
                <Th>Nuevo</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap">{formatDateTimeAR(h.createdAt)}</Td>
                  <Td>{h.changedBy.name}</Td>
                  <Td>{h.targetLabel}</Td>
                  <Td>{h.oldValue}</Td>
                  <Td className="font-bold">{h.newValue}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      </div>
    </>
  );
}
