import type { Metadata } from "next";
import Link from "next/link";
import { computeUnitPricing, resolveCommission } from "@/domain/commission";
import { formatARS } from "@/domain/money";
import { SALE_UNIT_LABEL, formatInt } from "@/lib/labels";
import { AddToCart, CartLink } from "@/components/catalog/add-to-cart";
import { ProductThumb } from "@/components/pools/pool-card";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { getPlatformConfig } from "@/server/config";
import { listApprovedDistributors, listCatalog, listCategories } from "@/server/queries/public";

export const metadata: Metadata = { title: "Catálogo", description: "Pedí directo a preventistas de tu zona, por unidad o por bulto." };
export const dynamic = "force-dynamic";

export default async function CatalogPage(props: PageProps<"/catalogo">) {
  const sp = await props.searchParams;
  const category = typeof sp.categoria === "string" ? sp.categoria.slice(0, 80) : undefined;
  const distributorId = typeof sp.preventista === "string" ? sp.preventista.slice(0, 40) : undefined;
  const q = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim().slice(0, 80) : undefined;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const [catalog, categories, distributors, config] = await Promise.all([
    listCatalog({ category, distributorId, q, page }),
    listCategories(),
    listApprovedDistributors(),
    getPlatformConfig(),
  ]);
  const pages = Math.max(1, Math.ceil(catalog.total / catalog.pageSize));
  const href = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { categoria: category, preventista: distributorId, q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/catalogo?${qs}` : "/catalogo";
  };
  // Precio que ve el comercio (incluye la comisión solo si está activada para catálogo y en modo "sumar").
  const displayPrice = (p: (typeof catalog.items)[number]) => {
    if (!config.catalogCommissionEnabled) return p.priceCents;
    const c = resolveCommission({ globalBps: config.globalCommissionBps, categoryBps: p.categoryBps, distributorBps: p.distributorBps });
    return computeUnitPricing(p.priceCents, c.bps, config.commissionMode).unitPriceCents;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader title="Catálogo" description="Pedí directo a los preventistas, sin esperar a que se arme un pool." actions={<CartLink />} />
      <form action="/catalogo" method="get" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_16rem_auto]">
        {category ? <input type="hidden" name="categoria" value={category} /> : null}
        <label className="flex flex-col gap-1 text-sm font-bold">
          Buscar
          <input name="q" defaultValue={q} placeholder="Producto, marca, SKU o EAN" className="field-input" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          Preventista
          <select name="preventista" defaultValue={distributorId ?? ""} className="field-input">
            <option value="">Todos</option>
            {distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.tradeName}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass("primary", "md", "self-end")}>
          Buscar
        </button>
      </form>
      <div className="-mx-4 mb-6 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-1">
          {[{ slug: "", name: "Todas" }, ...categories].map((c) => (
            <li key={c.slug || "todas"} className="shrink-0">
              <Link
                href={href({ categoria: c.slug || undefined, pagina: undefined })}
                aria-current={(category ?? "") === c.slug ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] items-center rounded-full border-2 border-ink px-4 text-sm font-bold whitespace-nowrap",
                  (category ?? "") === c.slug ? "bg-ink text-brand" : "hover:bg-brand-soft",
                )}
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {catalog.items.length === 0 ? (
        <EmptyState title="No encontramos productos">Probá con otra búsqueda o categoría.</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.items.map((p) => {
            const unit = SALE_UNIT_LABEL[p.saleUnit];
            const price = displayPrice(p);
            return (
              <li key={p.id} className="card flex flex-col overflow-hidden">
                <div className="flex gap-3 p-3">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border-2 border-ink">
                    <ProductThumb url={p.imageUrl} alt={p.name} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-black leading-tight">{p.name}</p>
                    <p className="text-sm text-muted">{p.brand ? `${p.brand} · ` : ""}{p.categoryName}</p>
                    <Link href={`/preventistas/${p.distributorId}`} className="text-sm font-semibold underline-offset-4 hover:underline">
                      {p.distributorName}
                    </Link>
                  </div>
                </div>
                <div className="mt-auto flex flex-col gap-2 border-t-2 border-ink p-3">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xl font-black tabular-nums">{formatARS(price)}</span>
                    <span className="text-sm font-semibold">
                      por {unit.one}
                      {p.saleUnit === "BULTO" ? ` de ${formatInt(p.unitsPerPack)} u.` : ""}
                    </span>
                    {p.retailPriceCents && p.retailPriceCents > price ? (
                      <s className="text-sm text-muted">{formatARS(p.retailPriceCents)}</s>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted">Pedido mínimo: {formatInt(p.minOrderQty)} {p.minOrderQty === 1 ? unit.one : unit.many}</p>
                  <AddToCart
                    item={{
                      productId: p.id,
                      distributorId: p.distributorId,
                      distributorName: p.distributorName,
                      name: p.name,
                      unitLabel: unit.one,
                      priceCents: price,
                      minOrderQty: p.minOrderQty,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 ? (
        <nav aria-label="Páginas" className="mt-6 flex items-center justify-center gap-3">
          {page > 1 ? (
            <Link href={href({ pagina: String(page - 1) })} className={buttonClass("secondary", "sm")}>
              Anterior
            </Link>
          ) : null}
          <span className="font-semibold">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link href={href({ pagina: String(page + 1) })} className={buttonClass("secondary", "sm")}>
              Siguiente
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
