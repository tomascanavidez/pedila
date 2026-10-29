import { CalendarClock, Clock, CreditCard, MapPin, Store } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatARS } from "@/domain/money";
import { computeProgress } from "@/domain/pool-rules";
import { formatDateTimeAR, formatLongDateTimeAR, isPast } from "@/lib/dates";
import { formatInt, SALE_UNIT_LABEL } from "@/lib/labels";
import { ProductThumb } from "@/components/pools/pool-card";
import { PoolLive } from "@/components/pools/pool-live";
import { Countdown } from "@/components/ui/countdown";
import { Badge, Card, DataList, Stars } from "@/components/ui/display";
import { PoolStatusBadge } from "@/components/ui/status-badge";
import { getPoolDetail } from "@/server/queries/public";

// Página pública cacheada (ISR): se genera al primer pedido y se regenera cada 60 s.
// El progreso y la participación del usuario se actualizan desde el navegador.
export const revalidate = 60;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: PageProps<"/pools/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const pool = await getPoolDetail(id);
  if (!pool) return { title: "Pool no encontrado" };
  return {
    title: pool.title,
    description: `${pool.distributorName}: ${formatARS(pool.unitPriceCents)} por ${SALE_UNIT_LABEL[pool.saleUnit].one}. Sumate antes del cierre.`,
  };
}

export default async function PoolPage(props: PageProps<"/pools/[id]">) {
  const { id } = await props.params;
  const pool = await getPoolDetail(id);
  if (!pool) notFound();
  const unit = SALE_UNIT_LABEL[pool.saleUnit];
  const progress = computeProgress(pool.committedUnits, pool.minUnitsToClose, pool.totalUnits);
  const savingPct = Math.floor(pool.savingBps / 100);
  const deadline = new Date(pool.deadlineAt);
  const accepting = (pool.status === "ABIERTO" || (pool.status === "COMPLETO" && !pool.closed)) && !isPast(deadline);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <nav aria-label="Migas de pan" className="mb-4 text-sm">
        <ol className="flex flex-wrap items-center gap-1 text-muted">
          <li>
            <Link href="/" className="font-semibold text-ink underline-offset-4 hover:underline">
              Pools
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link href={`/?categoria=${pool.categorySlug}&todas=1`} className="underline-offset-4 hover:underline">
              {pool.categoryName}
            </Link>
          </li>
        </ol>
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
          <div className="card overflow-hidden lg:col-start-1 lg:row-start-1">
            <div className="aspect-[4/3] border-b-2 border-ink sm:aspect-[16/10]">
              {pool.images[0] ? (
                <Image
                  src={pool.images[0].url}
                  alt={pool.productName}
                  width={pool.images[0].width}
                  height={pool.images[0].height}
                  priority
                  className="h-full w-full object-contain"
                />
              ) : (
                <ProductThumb url={null} alt={pool.productName} />
              )}
            </div>
            {pool.images.length > 1 ? (
              <ul className="flex gap-2 overflow-x-auto p-3">
                {pool.images.slice(1).map((img) => (
                  <li key={img.thumbUrl} className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-ink">
                    <Image src={img.thumbUrl} alt="" width={80} height={80} loading="lazy" className="h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start" aria-label="Sumarme al pool">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <PoolStatusBadge status={pool.status} closed={pool.closed} />
              {savingPct > 0 ? <Badge tone="brand">Ahorrás {savingPct} %</Badge> : null}
            </div>
            <div>
              <h1 className="text-2xl font-black leading-tight sm:text-3xl">{pool.title}</h1>
              <p className="mt-1 text-muted">{pool.productName}{pool.brand ? ` · ${pool.brand}` : ""}</p>
            </div>
            <Link href={`/preventistas/${pool.distributorId}`} className="flex flex-col rounded-xl border-2 border-ink p-3 hover:bg-brand-soft">
              <span className="text-sm text-muted">Vende</span>
              <span className="font-bold">{pool.distributorName}</span>
              <span className="text-sm">{pool.distributorLocality}, {pool.distributorProvince}</span>
              <Stars value={pool.ratingAvg} count={pool.ratingCount} />
            </Link>
            <div>
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-4xl font-black tabular-nums">{formatARS(pool.unitPriceCents)}</span>
                <span className="font-semibold">por {unit.one}</span>
              </p>
              {pool.retailUnitPriceCents > pool.unitPriceCents ? (
                <p className="text-muted">
                  Precio minorista <s>{formatARS(pool.retailUnitPriceCents)}</s>
                </p>
              ) : null}
            </div>
            {accepting ? (
              <p className="flex items-center gap-2 rounded-xl border-2 border-ink bg-brand px-3 py-2 font-bold">
                <Clock aria-hidden="true" className="h-5 w-5" />
                Cierra en <Countdown to={pool.deadlineAt} fallback={formatDateTimeAR(deadline)} />
              </p>
            ) : null}
            <PoolLive
              poolId={pool.id}
              title={pool.title}
              unitPriceCents={pool.unitPriceCents}
              retailUnitPriceCents={pool.retailUnitPriceCents}
              saleUnit={pool.saleUnit}
              minPerCommerce={pool.minPerCommerce}
              maxPerCommerce={pool.maxPerCommerce}
              initial={{
                committed: progress.committed,
                minimum: progress.minimum,
                total: progress.total,
                percentOfMinimum: progress.percentOfMinimum,
                available: progress.available,
                status: pool.status,
                closed: pool.closed,
                acceptingJoins: accepting,
              }}
            />
          </Card>
        </aside>

          <Card className="lg:col-start-1">
            <h2 className="mb-4 text-xl font-black">Condiciones del pool</h2>
            <DataList
              items={[
                { label: "Precio por " + unit.one, value: formatARS(pool.unitPriceCents) },
                { label: "Precio minorista de referencia", value: formatARS(pool.retailUnitPriceCents) },
                { label: "Total del pool", value: `${formatInt(pool.totalUnits)} ${unit.many}` },
                { label: "Mínimo para cerrar", value: `${formatInt(pool.minUnitsToClose)} ${unit.many}` },
                { label: "Compra por comercio", value: `de ${formatInt(pool.minPerCommerce)} a ${formatInt(pool.maxPerCommerce)} ${unit.many}` },
                {
                  label: "Cierre",
                  value: pool.closeOnMinimum ? "Se cierra al llegar al mínimo" : "Sigue sumando hasta el total o la fecha límite",
                },
                { label: "Fecha límite", value: formatLongDateTimeAR(deadline) },
                {
                  label: "Entrega estimada",
                  value: pool.scheduledDeliveryAt
                    ? `Programada: ${formatLongDateTimeAR(new Date(pool.scheduledDeliveryAt))}`
                    : pool.estimatedDeliveryAt
                      ? formatLongDateTimeAR(new Date(pool.estimatedDeliveryAt))
                      : "A coordinar",
                },
                { label: "Plazo para pagar", value: `${pool.paymentWindowHours} h desde que se cierra el pool` },
                ...(pool.saleUnit === "BULTO" ? [{ label: "Unidades por bulto", value: formatInt(pool.unitsPerPack) }] : []),
              ]}
            />
            <div className="mt-4">
              <p className="flex items-center gap-2 text-sm font-bold">
                <MapPin aria-hidden="true" className="h-4 w-4" /> Entrega en
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {pool.zones.map((z) => (
                  <li key={`${z.provinceId}-${z.localityId ?? "x"}`}>
                    <Badge tone="outline">{z.label}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {pool.description || pool.productDescription ? (
            <Card className="lg:col-start-1">
              <h2 className="mb-2 text-xl font-black">Detalle</h2>
              {pool.description ? <p className="whitespace-pre-line">{pool.description}</p> : null}
              {pool.productDescription ? <p className="mt-3 whitespace-pre-line text-muted">{pool.productDescription}</p> : null}
              <p className="mt-3 text-sm text-muted">
                SKU {pool.sku}
                {pool.ean ? ` · EAN ${pool.ean}` : ""}
              </p>
            </Card>
          ) : null}

          <Card className="bg-brand-soft lg:col-start-1">
            <h2 className="mb-3 text-xl font-black">¿Cómo funciona?</h2>
            <ol className="flex flex-col gap-3">
              {[
                { icon: Store, text: "Te sumás con las unidades que necesitás. No pagás nada todavía." },
                { icon: Clock, text: "Cuando entre todos llegan al mínimo, el pool se cierra." },
                { icon: CreditCard, text: `Te mandamos el link de pago: tenés ${pool.paymentWindowHours} h para pagar.` },
                { icon: CalendarClock, text: "El preventista programa la entrega y te avisamos el día." },
              ].map((s, i) => (
                <li key={s.text} className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-brand font-black">
                    {i + 1}
                  </span>
                  <span className="pt-1">{s.text}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm">Si el pool vence sin llegar al mínimo, no se te cobra nada.</p>
          </Card>

      </div>
    </div>
  );
}
