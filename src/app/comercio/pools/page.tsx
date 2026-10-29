import type { Metadata } from "next";
import Link from "next/link";
import type { ParticipationStatus } from "@/generated/prisma/enums";
import { formatARS, toCents } from "@/domain/money";
import { formatDateTimeAR } from "@/lib/dates";
import { unitsText } from "@/lib/labels";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { ProgressBar } from "@/components/ui/progress";
import { ParticipationStatusBadge, PoolStatusBadge } from "@/components/ui/status-badge";
import { computeProgress } from "@/domain/pool-rules";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Mis pools" };

const TABS: { key: string; label: string; statuses: ParticipationStatus[] }[] = [
  { key: "activos", label: "Activos", statuses: ["COMPROMETIDA", "PENDIENTE_PAGO", "PAGADA"] },
  { key: "historial", label: "Historial", statuses: ["ENTREGADA", "RETIRADA", "LIBERADA", "CANCELADA"] },
];

export default async function MyPoolsPage(props: PageProps<"/comercio/pools">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["COMERCIO"], "/comercio/pools");
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0]!;
  const parts = await db.participation.findMany({
    where: { commerceId: user.businessId!, status: { in: tab.statuses } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      pool: { include: { distributor: { select: { tradeName: true } } } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return (
    <>
      <PageHeader title="Mis pools" description="Las compras en grupo en las que participás." />
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Filtrar">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/comercio/pools?tab=${t.key}`}
            role="tab"
            aria-selected={t.key === tab.key}
            className={cn("min-h-[44px] rounded-full border-2 border-ink px-4 py-2 font-bold", t.key === tab.key ? "bg-ink text-brand" : "hover:bg-brand-soft")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {parts.length === 0 ? (
        <EmptyState title="Todavía no hay nada acá" action={<ButtonLink href="/">Ver pools abiertos</ButtonLink>}>
          Sumate a un pool con las unidades que necesites: pagás recién cuando se completa.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {parts.map((p) => {
            const progress = computeProgress(p.pool.committedUnits, p.pool.minUnitsToClose, p.pool.totalUnits);
            const payment = p.payments[0];
            return (
              <li key={p.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/pools/${p.poolId}`} className="text-lg font-black underline-offset-4 hover:underline">
                      {p.pool.title}
                    </Link>
                    <p className="text-sm text-muted">{p.pool.distributor.tradeName}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <PoolStatusBadge status={p.pool.status} closed={p.pool.closedAt !== null} />
                    <ParticipationStatusBadge status={p.status} />
                  </div>
                </div>
                <p className="font-semibold">
                  {unitsText(p.quantity, p.pool.saleUnit)} · {formatARS(toCents(p.totalCents) || toCents(p.unitPriceCents) * p.quantity)}
                </p>
                {p.status === "COMPROMETIDA" ? (
                  <div className="flex flex-col gap-1">
                    <ProgressBar value={progress.percentOfMinimum} size="sm" label={`Progreso de ${p.pool.title}`} />
                    <p className="text-sm">
                      {progress.percentOfMinimum} % del mínimo · cierra el {formatDateTimeAR(p.pool.deadlineAt)}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {p.status === "PENDIENTE_PAGO" && payment ? (
                    <ButtonLink href={`/comercio/pagos/${payment.id}`} variant="dark" size="sm">
                      Pagar {payment.dueAt ? `antes del ${formatDateTimeAR(payment.dueAt)}` : ""}
                    </ButtonLink>
                  ) : null}
                  <ButtonLink href={`/pools/${p.poolId}`} variant="secondary" size="sm">
                    {p.status === "COMPROMETIDA" ? "Modificar o retirarme" : "Ver pool"}
                  </ButtonLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
