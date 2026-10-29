import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { PoolStatus } from "@/generated/prisma/enums";
import { formatARS, toCents } from "@/domain/money";
import { computeProgress } from "@/domain/pool-rules";
import { formatDateTimeAR } from "@/lib/dates";
import { formatInt, POOL_STATUS_LABEL } from "@/lib/labels";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/display";
import { ProgressBar } from "@/components/ui/progress";
import { PoolStatusBadge } from "@/components/ui/status-badge";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Mis pools" };

const FILTERS: { key: string; label: string; statuses?: PoolStatus[] }[] = [
  { key: "activos", label: "Activos", statuses: ["ABIERTO", "COMPLETO", "PENDIENTE_APROBACION"] },
  { key: "entregar", label: "Para entregar", statuses: ["CERRADO_PAGADO", "EN_ENTREGA"] },
  { key: "vencidos", label: "Vencidos", statuses: ["VENCIDO_SIN_COMPLETAR"] },
  { key: "borradores", label: "Borradores", statuses: ["BORRADOR"] },
  { key: "todos", label: "Todos" },
];

export default async function DistributorPoolsPage(props: PageProps<"/preventista/pools">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["PREVENTISTA"], "/preventista/pools");
  const filter = FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0]!;
  const pools = await db.pool.findMany({
    where: { distributorId: user.businessId!, ...(filter.statuses ? { status: { in: filter.statuses } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader
        title="Pools"
        actions={
          <ButtonLink href="/preventista/pools/nuevo">
            <Plus aria-hidden="true" className="h-5 w-5" /> Nuevo pool
          </ButtonLink>
        }
      />
      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/preventista/pools?f=${f.key}`}
              aria-current={f.key === filter.key ? "page" : undefined}
              className={cn("min-h-[44px] shrink-0 rounded-full border-2 border-ink px-4 py-2 font-bold", f.key === filter.key ? "bg-ink text-brand" : "hover:bg-brand-soft")}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>
      {pools.length === 0 ? (
        <EmptyState title="No hay pools en esta vista" />
      ) : (
        <Table caption="Pools">
          <thead>
            <tr>
              <Th>Pool</Th>
              <Th>Estado</Th>
              <Th>Progreso</Th>
              <Th>Precio</Th>
              <Th>Fecha límite</Th>
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => {
              const pr = computeProgress(p.committedUnits, p.minUnitsToClose, p.totalUnits);
              return (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/preventista/pools/${p.id}`} className="font-bold underline-offset-4 hover:underline">
                      {p.title}
                    </Link>
                  </Td>
                  <Td>
                    <PoolStatusBadge status={p.status} closed={p.closedAt !== null} />
                    <span className="sr-only">{POOL_STATUS_LABEL[p.status]}</span>
                  </Td>
                  <Td className="min-w-[160px]">
                    <ProgressBar value={pr.percentOfMinimum} size="sm" label={`Progreso de ${p.title}`} />
                    <span className="text-xs">
                      {formatInt(p.committedUnits)}/{formatInt(p.minUnitsToClose)} ({pr.percentOfMinimum} %)
                    </span>
                  </Td>
                  <Td className="tabular-nums">{formatARS(toCents(p.unitPriceCents))}</Td>
                  <Td className="text-sm">{formatDateTimeAR(p.deadlineAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
