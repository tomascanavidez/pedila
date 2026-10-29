import { Clock, MapPin, Package } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatARS } from "@/domain/money";
import { computeProgress } from "@/domain/pool-rules";
import { formatDateTimeAR } from "@/lib/dates";
import { formatInt, SALE_UNIT_LABEL } from "@/lib/labels";
import { Countdown } from "@/components/ui/countdown";
import { Badge } from "@/components/ui/display";
import { ProgressBar } from "@/components/ui/progress";
import { PoolStatusBadge } from "@/components/ui/status-badge";
import type { PoolCardDTO } from "@/server/queries/public";

export function ProductThumb({ url, alt, className = "h-full w-full" }: { url: string | null; alt: string; className?: string }) {
  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-brand-soft ${className}`} aria-hidden="true">
        <Package className="h-10 w-10" strokeWidth={1.5} />
      </div>
    );
  }
  return <Image src={url} alt={alt} width={400} height={400} loading="lazy" className={`object-cover ${className}`} />;
}

export function PoolCard({ pool }: { pool: PoolCardDTO }) {
  const progress = computeProgress(pool.committedUnits, pool.minUnitsToClose, pool.totalUnits);
  const unit = SALE_UNIT_LABEL[pool.saleUnit];
  const savingPct = Math.floor(pool.savingBps / 100);
  return (
    <article className="card flex flex-col overflow-hidden transition-shadow hover:shadow-[4px_4px_0_#111111]">
      <Link href={`/pools/${pool.id}`} className="flex flex-1 flex-col focus-visible:outline-offset-[-4px]">
        <div className="relative aspect-[4/3] border-b-2 border-ink">
          <ProductThumb url={pool.imageUrl} alt={pool.productName} />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {savingPct > 0 ? <Badge tone="brand">Ahorrás {savingPct} %</Badge> : null}
            {pool.featured ? <Badge tone="dark">Destacado</Badge> : null}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-black leading-tight">{pool.title}</h3>
            <PoolStatusBadge status={pool.status} closed={pool.closed} />
          </div>
          <p className="text-sm text-muted">
            {pool.distributorName}
            {pool.ratingAvg ? ` · ★ ${pool.ratingAvg.toFixed(1).replace(".", ",")}` : ""}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-black tabular-nums">{formatARS(pool.unitPriceCents)}</span>
            <span className="text-sm font-semibold">por {unit.one}</span>
            {pool.retailUnitPriceCents > pool.unitPriceCents ? (
              <span className="text-sm text-muted">
                <span className="sr-only">Precio minorista: </span>
                <s>{formatARS(pool.retailUnitPriceCents)}</s>
              </span>
            ) : null}
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <ProgressBar value={progress.percentOfMinimum} label={`Progreso del pool ${pool.title}`} />
            <p className="text-sm font-semibold tabular-nums">
              {formatInt(pool.committedUnits)} de {formatInt(pool.minUnitsToClose)} {unit.many} para cerrar
              <span className="font-normal text-muted"> · {progress.percentOfMinimum} %</span>
            </p>
            <p className="flex items-center gap-1.5 text-sm">
              <Clock aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>
                Cierra en{" "}
                <Countdown to={pool.deadlineAt} fallback={formatDateTimeAR(new Date(pool.deadlineAt))} className="font-bold" />
              </span>
            </p>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
              {pool.zonesLabel}
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
}
