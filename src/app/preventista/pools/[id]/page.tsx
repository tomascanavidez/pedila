import { ExternalLink, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatARS, formatBps, toCents } from "@/domain/money";
import { canAcceptBelowMinimum, canExtendDeadline, computeProgress } from "@/domain/pool-rules";
import { addDays, formatDateTimeAR, formatLongDateTimeAR, toLocalInputAR } from "@/lib/dates";
import { COMMISSION_MODE_LABEL, COMMISSION_SOURCE_LABEL, formatInt, SALE_UNIT_LABEL } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { DownloadLink } from "@/components/ui/download-link";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card, DataList, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/display";
import { ProgressBar } from "@/components/ui/progress";
import { ParticipationStatusBadge, PaymentStatusBadge, PoolStatusBadge } from "@/components/ui/status-badge";
import {
  acceptBelowMinimumAction,
  cancelPoolAction,
  extendPoolAction,
  markParticipationDeliveredAction,
  markPoolDeliveredAction,
  publishPoolAction,
  scheduleDeliveryAction,
} from "@/server/actions/pools";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Gestionar pool" };

export default async function ManagePoolPage(props: PageProps<"/preventista/pools/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requirePageUser(["PREVENTISTA"], `/preventista/pools/${id}`);
  const pool = await db.pool.findUnique({
    where: { id },
    include: {
      product: { select: { name: true } },
      participations: {
        orderBy: { createdAt: "asc" },
        include: {
          commerce: { include: { locality: { select: { name: true } } } },
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      settlement: true,
    },
  });
  if (!pool || pool.distributorId !== user.businessId) notFound();
  const [timeline, business] = await Promise.all([
    db.auditLog.findMany({ where: { entityType: "POOL", entityId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.business.findUniqueOrThrow({ where: { id: user.businessId! }, select: { distributorStatus: true } }),
  ]);
  const now = new Date();
  const unit = SALE_UNIT_LABEL[pool.saleUnit];
  const pr = computeProgress(pool.committedUnits, pool.minUnitsToClose, pool.totalUnits);
  const active = pool.participations.filter((p) => ["COMPROMETIDA", "PENDIENTE_PAGO", "PAGADA", "ENTREGADA"].includes(p.status));
  const committedNet = active.reduce((a, p) => a + toCents(p.netCents), 0);
  const paidCount = pool.participations.filter((p) => p.status === "PAGADA").length;
  const canCancel = ["BORRADOR", "PENDIENTE_APROBACION", "ABIERTO", "COMPLETO", "VENCIDO_SIN_COMPLETAR"].includes(pool.status) && !(pool.status === "VENCIDO_SIN_COMPLETAR" && pool.finalizedAt);
  const defaultDelivery = toLocalInputAR(pool.scheduledDeliveryAt ?? pool.estimatedDeliveryAt ?? addDays(now, 2));

  return (
    <>
      <PageHeader
        title={pool.title}
        description={pool.product.name}
        actions={
          <>
            {pool.status === "BORRADOR" ? (
              <ButtonLink href={`/preventista/pools/${pool.id}/editar`} variant="secondary">
                <Pencil aria-hidden="true" className="h-4 w-4" /> Editar
              </ButtonLink>
            ) : (
              <ButtonLink href={`/pools/${pool.id}`} variant="secondary">
                <ExternalLink aria-hidden="true" className="h-4 w-4" /> Ver página pública
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {sp.publicado === "1" ? <Alert>¡Pool publicado! Ya lo ven los comercios de las zonas elegidas.</Alert> : null}
        {sp.publicado === "revision" ? <Alert>Enviaste el pool a revisión. Te avisamos cuando PEDILA lo apruebe.</Alert> : null}
        {sp.guardado ? <Alert>Borrador guardado.</Alert> : null}

        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <PoolStatusBadge status={pool.status} closed={pool.closedAt !== null} />
            {pool.extendedOnce ? <span className="text-sm font-semibold">Fecha extendida una vez</span> : null}
          </div>
          <ProgressBar value={pr.percentOfMinimum} size="lg" label={`Progreso: ${pr.percentOfMinimum} % del mínimo`} />
          <p className="text-lg font-black tabular-nums">
            {formatInt(pool.committedUnits)} de {formatInt(pool.minUnitsToClose)} {unit.many} mínimas · total {formatInt(pool.totalUnits)}
          </p>
          <DataList
            items={[
              { label: "Fecha límite", value: formatLongDateTimeAR(pool.deadlineAt) },
              { label: "Participantes", value: `${active.length} comercios` },
              { label: "Neto comprometido", value: formatARS(committedNet) },
              { label: "Cierre", value: pool.closeOnMinimum ? "Al llegar al mínimo" : "Hasta el total o la fecha" },
            ]}
          />
        </Card>

        {/* Acciones según el estado */}
        {pool.status === "BORRADOR" ? (
          <Card className="flex flex-col gap-3 bg-brand-soft">
            <h2 className="text-lg font-black">Listo para publicar</h2>
            <p className="text-sm">Al publicar se congela la comisión vigente para este pool.</p>
            {business.distributorStatus === "APROBADO" ? (
              <ActionForm action={publishPoolAction} submitLabel="Publicar pool" size="lg" buttonClassName="self-start">
                <input type="hidden" name="poolId" value={pool.id} />
              </ActionForm>
            ) : (
              <Alert tone="warning">Vas a poder publicar cuando PEDILA apruebe tu cuenta.</Alert>
            )}
            {pool.reviewNote ? <Alert tone="warning">Nota de la revisión: {pool.reviewNote}</Alert> : null}
          </Card>
        ) : null}

        {pool.status === "PENDIENTE_APROBACION" ? <Alert>El pool está en revisión por el equipo de PEDILA.</Alert> : null}

        {pool.status === "VENCIDO_SIN_COMPLETAR" && !pool.finalizedAt ? (
          <Card className="flex flex-col gap-4 bg-brand-soft">
            <h2 className="text-lg font-black">El pool venció sin llegar al mínimo</h2>
            <p>
              Tenés hasta el <b>{pool.decisionDeadlineAt ? formatLongDateTimeAR(pool.decisionDeadlineAt) : "—"}</b> para decidir. Si no hacés nada, el pool queda sin efecto y no se cobra a nadie.
            </p>
            {canExtendDeadline(pool, now) ? (
              <ActionForm action={extendPoolAction} submitLabel="Extender la fecha (una sola vez)" variant="dark" className="max-w-md" buttonClassName="self-start">
                <input type="hidden" name="poolId" value={pool.id} />
                <label className="flex flex-col gap-1 text-sm font-bold">
                  Nueva fecha límite
                  <input type="datetime-local" name="deadlineAt" required defaultValue={toLocalInputAR(addDays(now, 3))} className="field-input" />
                </label>
              </ActionForm>
            ) : (
              <p className="text-sm">Ya usaste la extensión de fecha.</p>
            )}
            {canAcceptBelowMinimum(pool, now) ? (
              <ActionForm
                action={acceptBelowMinimumAction}
                submitLabel={`Cerrar igual con ${formatInt(pool.committedUnits)} ${unit.many}`}
                confirm="Se cierra el pool y se envían los links de pago con lo alcanzado. ¿Confirmás?"
                buttonClassName="self-start"
              >
                <input type="hidden" name="poolId" value={pool.id} />
              </ActionForm>
            ) : null}
          </Card>
        ) : null}

        {pool.status === "COMPLETO" && pool.closedAt ? (
          <Alert>
            El pool se cerró el {formatDateTimeAR(pool.closedAt)}. {paidCount} de {active.length} comercios ya pagaron; el resto tiene {pool.paymentWindowHours} h desde el cierre.
          </Alert>
        ) : null}

        {pool.status === "CERRADO_PAGADO" || pool.status === "EN_ENTREGA" ? (
          <Card className="flex flex-col gap-4 bg-brand-soft">
            <h2 className="text-lg font-black">{pool.status === "EN_ENTREGA" ? "Entrega programada" : "¡Pool pagado! Programá la entrega"}</h2>
            {pool.scheduledDeliveryAt ? <p className="font-bold">{formatLongDateTimeAR(pool.scheduledDeliveryAt)}</p> : null}
            <ActionForm action={scheduleDeliveryAction} submitLabel={pool.scheduledDeliveryAt ? "Reprogramar" : "Programar entrega"} variant="dark" className="max-w-md" buttonClassName="self-start">
              <input type="hidden" name="poolId" value={pool.id} />
              <label className="flex flex-col gap-1 text-sm font-bold">
                Fecha y hora de entrega
                <input type="datetime-local" name="date" required defaultValue={defaultDelivery} className="field-input" />
              </label>
            </ActionForm>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/preventista/reparto" variant="secondary">
                Armar hoja de reparto
              </ButtonLink>
              <ActionForm action={markPoolDeliveredAction} submitLabel="Marcar todo como entregado" variant="secondary" confirm="¿Marcar todas las entregas como realizadas?" inline>
                <input type="hidden" name="poolId" value={pool.id} />
              </ActionForm>
            </div>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-3 text-lg font-black">Precio y comisión {pool.commissionFrozenAt ? "(congelados al publicar)" : "(se congelan al publicar)"}</h2>
          <DataList
            items={[
              { label: `Precio para el comercio por ${unit.one}`, value: formatARS(toCents(pool.unitPriceCents)) },
              { label: "Comisión PEDILA", value: `${formatBps(pool.commissionBps)} (${COMMISSION_SOURCE_LABEL[pool.commissionSource]})` },
              { label: `Comisión por ${unit.one}`, value: formatARS(toCents(pool.commissionUnitCents)) },
              { label: `Tu neto por ${unit.one}`, value: formatARS(toCents(pool.netUnitCents)) },
              { label: "Modo de cobro", value: COMMISSION_MODE_LABEL[pool.commissionMode] },
              { label: "Neto si se vende el total", value: formatARS(toCents(pool.netUnitCents) * pool.totalUnits) },
              ...(pool.settlement
                ? [{ label: "Liquidación", value: `${formatARS(toCents(pool.settlement.netCents))} · ${pool.settlement.status === "LIQUIDADO" ? "liquidada" : "pendiente"}` }]
                : []),
            ]}
          />
        </Card>

        <section aria-labelledby="participantes">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="participantes" className="text-xl font-black">
              Participantes
            </h2>
            {pool.participations.length ? (
              <DownloadLink href={`/api/exportar/participantes?pool=${pool.id}`}>Exportar CSV</DownloadLink>
            ) : null}
          </div>
          {pool.participations.length === 0 ? (
            <EmptyState title="Todavía no se sumó nadie" />
          ) : (
            <Table caption="Participantes del pool">
              <thead>
                <tr>
                  <Th>Comercio</Th>
                  <Th>Cantidad</Th>
                  <Th>Total</Th>
                  <Th>Estado</Th>
                  <Th>Pago</Th>
                  <Th>
                    <span className="sr-only">Acciones</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {pool.participations.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <span className="font-bold">{p.commerce.tradeName}</span>
                      <span className="block text-xs text-muted">
                        {p.commerce.street} {p.commerce.streetNumber}, {p.commerce.locality.name}
                      </span>
                    </Td>
                    <Td className="tabular-nums">{formatInt(p.quantity)}</Td>
                    <Td className="tabular-nums">{formatARS(toCents(p.totalCents))}</Td>
                    <Td>
                      <ParticipationStatusBadge status={p.status} />
                    </Td>
                    <Td>{p.payments[0] ? <PaymentStatusBadge status={p.payments[0].status} /> : "—"}</Td>
                    <Td>
                      {p.status === "PAGADA" && (pool.status === "CERRADO_PAGADO" || pool.status === "EN_ENTREGA") ? (
                        <ActionForm action={markParticipationDeliveredAction} submitLabel="Entregado" size="sm" variant="secondary" inline>
                          <input type="hidden" name="participationId" value={p.id} />
                        </ActionForm>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        {canCancel ? (
          <Card>
            <h2 className="mb-2 text-lg font-black">Cancelar pool</h2>
            <p className="mb-3 text-sm">Se avisa a todos los participantes y no se le cobra a nadie.</p>
            <ActionForm action={cancelPoolAction} submitLabel="Cancelar pool" variant="secondary" confirm="¿Seguro que querés cancelar este pool?" className="max-w-md" buttonClassName="self-start">
              <input type="hidden" name="poolId" value={pool.id} />
              <label className="flex flex-col gap-1 text-sm font-bold">
                Motivo
                <input name="reason" required maxLength={300} className="field-input" placeholder="Ej.: sin stock del proveedor" />
              </label>
            </ActionForm>
          </Card>
        ) : null}

        <section aria-labelledby="historial">
          <h2 id="historial" className="mb-3 text-xl font-black">
            Historial
          </h2>
          <ol className="flex flex-col gap-2 border-l-4 border-brand pl-4">
            {timeline.map((t) => (
              <li key={t.id}>
                <p className="text-sm font-semibold">{t.summary ?? t.action}</p>
                <p className="text-xs text-muted">
                  {formatDateTimeAR(t.createdAt)} · {t.actorRole ?? "SISTEMA"}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-sm">
            <Link href="/preventista/pools" className="font-bold underline underline-offset-4">
              Volver a mis pools
            </Link>
          </p>
        </section>
      </div>
    </>
  );
}
