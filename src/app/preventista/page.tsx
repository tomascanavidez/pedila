import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatARS } from "@/domain/money";
import { computeProgress } from "@/domain/pool-rules";
import { formatDateTimeAR } from "@/lib/dates";
import { formatInt, SALE_UNIT_LABEL } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader, StatCard } from "@/components/ui/display";
import { ProgressBar } from "@/components/ui/progress";
import { PoolStatusBadge } from "@/components/ui/status-badge";
import { respondDisputeAction } from "@/server/actions/distributor";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { DISPUTE_REASONS } from "@/server/services/feedback";
import { distributorDashboard } from "@/server/services/reports";

export const metadata: Metadata = { title: "Panel de preventista" };

export default async function DistributorHome(props: PageProps<"/preventista">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["PREVENTISTA"], "/preventista");
  const [d, disputes] = await Promise.all([
    distributorDashboard(user.businessId!),
    db.dispute.findMany({
      where: { distributorId: user.businessId!, status: { in: ["ABIERTA", "EN_REVISION"] } },
      include: { commerce: { select: { tradeName: true } }, pool: { select: { title: true } }, order: { select: { number: true } } },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Resumen"
        description="Cómo vienen tus ventas y pools."
        actions={
          <ButtonLink href="/preventista/pools/nuevo">
            <Plus aria-hidden="true" className="h-5 w-5" /> Nuevo pool
          </ButtonLink>
        }
      />
      {sp.bienvenida ? (
        <div className="mb-4">
          <Alert>¡Gracias por registrarte! Revisamos tu cuenta y te avisamos por email cuando puedas publicar.</Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ventas últimos 30 días" value={formatARS(d.sales30Cents, { decimals: false })} hint={`Total histórico ${formatARS(d.salesTotalCents, { decimals: false })}`} />
        <StatCard label="Neto a cobrar" value={formatARS(d.pendingNetCents, { decimals: false })} hint="Liquidaciones pendientes" accent />
        <StatCard label="Pools activos" value={d.activePools} hint={`${d.toDeliver} para entregar`} />
        <StatCard
          label="Tasa de completado"
          value={d.completionRate === null ? "—" : `${d.completionRate} %`}
          hint={`${d.succeeded} completados · ${d.failed} vencidos o cancelados`}
        />
      </div>

      {disputes.length > 0 ? (
        <section className="mt-8" aria-labelledby="reclamos">
          <h2 id="reclamos" className="mb-3 text-xl font-black">
            Reclamos de comercios
          </h2>
          <ul className="flex flex-col gap-3">
            {disputes.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-col gap-2">
                  <p className="font-bold">
                    {r.commerce.tradeName} · {DISPUTE_REASONS[r.reason as keyof typeof DISPUTE_REASONS] ?? r.reason} · {r.pool?.title ?? `Pedido #${r.order?.number}`}
                  </p>
                  <p className="whitespace-pre-line text-sm">{r.description}</p>
                  {r.distributorResponse ? (
                    <p className="rounded-xl bg-brand-soft p-3 text-sm">Tu respuesta: {r.distributorResponse}</p>
                  ) : (
                    <ActionForm action={respondDisputeAction} submitLabel="Responder" size="sm" variant="secondary" buttonClassName="self-start">
                      <input type="hidden" name="disputeId" value={r.id} />
                      <label className="flex flex-col gap-1 text-sm font-bold">
                        Tu respuesta (la ven el comercio y PEDILA)
                        <textarea name="response" required className="field-input min-h-[80px]" />
                      </label>
                    </ActionForm>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="recientes">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recientes" className="text-xl font-black">
            Tus pools
          </h2>
          <Link href="/preventista/pools" className="font-bold underline underline-offset-4">
            Ver todos
          </Link>
        </div>
        {d.recentPools.length === 0 ? (
          <EmptyState title="Todavía no creaste pools" action={<ButtonLink href="/preventista/pools/nuevo">Crear mi primer pool</ButtonLink>}>
            Publicá una oferta por volumen (por ejemplo, un pallet) y dejá que los comercios se sumen.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {d.recentPools.map((p) => {
              const pr = computeProgress(p.committedUnits, p.minUnitsToClose, p.totalUnits);
              return (
                <li key={p.id}>
                  <Link href={`/preventista/pools/${p.id}`} className="card flex flex-col gap-2 p-4 hover:bg-brand-soft">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-black">{p.title}</span>
                      <PoolStatusBadge status={p.status} closed={p.closedAt !== null} />
                    </div>
                    <ProgressBar value={pr.percentOfMinimum} size="sm" label={`Progreso de ${p.title}`} />
                    <span className="text-sm">
                      {formatInt(p.committedUnits)}/{formatInt(p.minUnitsToClose)} {SALE_UNIT_LABEL[p.saleUnit].many} · cierra {formatDateTimeAR(p.deadlineAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
