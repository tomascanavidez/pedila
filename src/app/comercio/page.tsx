import { ArrowRight, CreditCard, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatARS, toCents } from "@/domain/money";
import { formatDateTimeAR, formatLongDateTimeAR } from "@/lib/dates";
import { unitsText } from "@/lib/labels";
import { PoolCard } from "@/components/pools/pool-card";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader, StatCard } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { listOpenPools } from "@/server/queries/public";

export const metadata: Metadata = { title: "Mi comercio" };

export default async function CommerceHome(props: PageProps<"/comercio">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["COMERCIO"], "/comercio");
  const businessId = user.businessId!;
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  const [pending, active, upcoming, savings, pools] = await Promise.all([
    db.payment.findMany({
      where: { commerceId: businessId, status: { in: ["PENDIENTE", "EN_PROCESO"] } },
      orderBy: { dueAt: "asc" },
      include: { participation: { include: { pool: { select: { title: true } } } }, order: { select: { number: true } } },
    }),
    db.participation.count({ where: { commerceId: businessId, status: "COMPROMETIDA" } }),
    db.participation.findMany({
      where: { commerceId: businessId, status: "PAGADA", pool: { status: { in: ["CERRADO_PAGADO", "EN_ENTREGA"] } } },
      include: { pool: { select: { id: true, title: true, scheduledDeliveryAt: true, saleUnit: true, estimatedDeliveryAt: true } } },
      take: 5,
    }),
    db.participation.findMany({
      where: { commerceId: businessId, status: { in: ["PAGADA", "ENTREGADA"] } },
      select: { quantity: true, unitPriceCents: true, pool: { select: { retailUnitPriceCents: true } } },
    }),
    listOpenPools({ provinceId: business.provinceId, localityId: business.localityId, sort: "cierra-pronto" }),
  ]);
  const saved = savings.reduce((a, p) => a + Math.max(0, toCents(p.pool.retailUnitPriceCents) - toCents(p.unitPriceCents)) * p.quantity, 0);

  return (
    <>
      <PageHeader title={`¡Hola, ${user.name.split(" ")[0]}!`} description={`${business.tradeName} · tus compras en un solo lugar.`} />
      {sp.bienvenida ? <Alert>¡Bienvenido a PEDILA! Sumate a un pool de tu zona para empezar a ahorrar.</Alert> : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Pagos pendientes" value={pending.length} accent={pending.length > 0} hint={pending.length ? "Pagá antes del vencimiento" : "Estás al día"} />
        <StatCard label="Pools en los que estás" value={active} hint="Esperando a llegar al mínimo" />
        <StatCard label="Ahorro acumulado" value={formatARS(saved, { decimals: false })} hint="vs. precio minorista" />
      </div>

      {pending.length > 0 ? (
        <section className="mt-8" aria-labelledby="pagos-pendientes">
          <h2 id="pagos-pendientes" className="mb-3 flex items-center gap-2 text-xl font-black">
            <CreditCard aria-hidden="true" className="h-5 w-5" /> Para pagar
          </h2>
          <ul className="flex flex-col gap-3">
            {pending.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-3 bg-brand-soft sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold">{p.participation ? p.participation.pool.title : `Pedido #${p.order?.number}`}</p>
                    <p className="text-sm">
                      {formatARS(toCents(p.amountCents))}
                      {p.dueAt ? ` · vence el ${formatDateTimeAR(p.dueAt)}` : ""}
                    </p>
                  </div>
                  <ButtonLink href={`/comercio/pagos/${p.id}`} variant="dark">
                    Pagar ahora
                  </ButtonLink>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section className="mt-8" aria-labelledby="proximas">
          <h2 id="proximas" className="mb-3 flex items-center gap-2 text-xl font-black">
            <Truck aria-hidden="true" className="h-5 w-5" /> Próximas entregas
          </h2>
          <ul className="flex flex-col gap-2">
            {upcoming.map((u) => (
              <li key={u.id} className="card flex flex-col p-3 sm:flex-row sm:justify-between">
                <span className="font-bold">
                  {u.pool.title} · {unitsText(u.quantity, u.pool.saleUnit)}
                </span>
                <span className="text-sm">
                  {u.pool.scheduledDeliveryAt
                    ? `Llega el ${formatLongDateTimeAR(u.pool.scheduledDeliveryAt)}`
                    : "El preventista está programando la entrega"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="en-tu-zona">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="en-tu-zona" className="text-xl font-black">
            Pools que cierran pronto en tu zona
          </h2>
          <Link href="/" className="inline-flex items-center gap-1 font-bold underline underline-offset-4">
            Ver todos <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
        {pools.length === 0 ? (
          <EmptyState title="No hay pools abiertos en tu zona ahora">Te avisamos por email cuando se abra uno nuevo.</EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {pools.slice(0, 4).map((p) => (
              <li key={p.id}>
                <PoolCard pool={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
