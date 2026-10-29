import type { Metadata } from "next";
import Link from "next/link";
import type { PoolStatus } from "@/generated/prisma/enums";
import { formatARS, formatBps, toCents } from "@/domain/money";
import { formatDateTimeAR } from "@/lib/dates";
import { formatInt, POOL_STATUS_LABEL } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { PoolStatusBadge } from "@/components/ui/status-badge";
import { cancelPoolAction, reviewPoolAction, toggleFeaturedAction } from "@/server/actions/pools";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Pools" };

const STATUSES = Object.keys(POOL_STATUS_LABEL) as PoolStatus[];

export default async function AdminPoolsPage(props: PageProps<"/admin/pools">) {
  const sp = await props.searchParams;
  await requirePageUser(["ADMIN"], "/admin/pools");
  const status = STATUSES.find((s) => s === sp.estado);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const pools = await db.pool.findMany({
    where: { ...(status ? { status } : {}), ...(q ? { title: { contains: q } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { distributor: { select: { tradeName: true } } },
  });
  return (
    <>
      <PageHeader title="Pools" description="Todos los pools de la plataforma." />
      <div className="-mx-4 mb-3 overflow-x-auto px-4">
        <div className="flex gap-2">
          {[undefined, ...STATUSES].map((s) => (
            <Link
              key={s ?? "todos"}
              href={s ? `/admin/pools?estado=${s}` : "/admin/pools"}
              aria-current={s === status ? "page" : undefined}
              className={cn("min-h-[40px] shrink-0 rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold", s === status ? "bg-ink text-brand" : "hover:bg-brand-soft")}
            >
              {s ? POOL_STATUS_LABEL[s] : "Todos"}
            </Link>
          ))}
        </div>
      </div>
      <form className="mb-4" action="/admin/pools">
        {status ? <input type="hidden" name="estado" value={status} /> : null}
        <label className="sr-only" htmlFor="q-pools">Buscar</label>
        <input id="q-pools" name="q" defaultValue={q} placeholder="Buscar por título" className="field-input" />
      </form>
      {pools.length === 0 ? (
        <EmptyState title="No hay pools con este filtro" />
      ) : (
        <ul className="flex flex-col gap-3">
          {pools.map((p) => (
            <li key={p.id} className="card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/pools/${p.id}`} className="font-black underline-offset-4 hover:underline">
                    {p.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {p.distributor.tradeName} · {formatARS(toCents(p.unitPriceCents))} · comisión {formatBps(p.commissionBps)} · {formatInt(p.committedUnits)}/{formatInt(p.minUnitsToClose)} u. · cierra {formatDateTimeAR(p.deadlineAt)}
                  </p>
                </div>
                <PoolStatusBadge status={p.status} closed={p.closedAt !== null} />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {p.status === "PENDIENTE_APROBACION" ? (
                  <>
                    <ActionForm action={reviewPoolAction} submitLabel="Aprobar y publicar" size="sm" inline>
                      <input type="hidden" name="poolId" value={p.id} />
                      <input type="hidden" name="decision" value="aprobar" />
                    </ActionForm>
                    <ActionForm action={reviewPoolAction} submitLabel="Devolver con comentario" size="sm" variant="secondary" className="sm:flex-row sm:items-end">
                      <input type="hidden" name="poolId" value={p.id} />
                      <input type="hidden" name="decision" value="rechazar" />
                      <label className="sr-only" htmlFor={`note-${p.id}`}>Comentario</label>
                      <input id={`note-${p.id}`} name="note" required placeholder="Qué tiene que corregir" className="field-input min-h-[40px] py-1.5" />
                    </ActionForm>
                  </>
                ) : null}
                {p.status === "ABIERTO" || p.status === "COMPLETO" ? (
                  <ActionForm action={toggleFeaturedAction} submitLabel={p.featured ? "Quitar de destacados" : "Destacar en el inicio"} size="sm" variant="secondary" inline>
                    <input type="hidden" name="poolId" value={p.id} />
                    <input type="hidden" name="featured" value={p.featured ? "0" : "1"} />
                  </ActionForm>
                ) : null}
                {!["ENTREGADO", "CANCELADO", "EN_ENTREGA"].includes(p.status) && !(p.status === "VENCIDO_SIN_COMPLETAR" && p.finalizedAt) ? (
                  <ActionForm action={cancelPoolAction} submitLabel="Cancelar" size="sm" variant="secondary" confirm="Se cancela el pool y se reintegra lo pagado. ¿Seguro?" className="sm:flex-row sm:items-end">
                    <input type="hidden" name="poolId" value={p.id} />
                    <label className="sr-only" htmlFor={`reason-${p.id}`}>Motivo</label>
                    <input id={`reason-${p.id}`} name="reason" required placeholder="Motivo" className="field-input min-h-[40px] py-1.5" />
                  </ActionForm>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
