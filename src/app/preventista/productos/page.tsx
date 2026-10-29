import { FileUp, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatARS, toCents } from "@/domain/money";
import { SALE_UNIT_LABEL } from "@/lib/labels";
import { ProductThumb } from "@/components/pools/pool-card";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { uploadUrl } from "@/server/storage/storage";

export const metadata: Metadata = { title: "Productos" };

export default async function ProductsPage(props: PageProps<"/preventista/productos">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["PREVENTISTA"], "/preventista/productos");
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const products = await db.product.findMany({
    where: { distributorId: user.businessId!, ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { ean: q }] } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { category: { select: { name: true } }, images: { take: 1, orderBy: { sortOrder: "asc" } }, _count: { select: { pools: true } } },
    take: 500,
  });
  return (
    <>
      <PageHeader
        title="Productos"
        description={`${products.length} productos en tu catálogo.`}
        actions={
          <>
            <ButtonLink href="/preventista/productos/importar" variant="secondary">
              <FileUp aria-hidden="true" className="h-5 w-5" /> Importar CSV
            </ButtonLink>
            <ButtonLink href="/preventista/productos/nuevo">
              <Plus aria-hidden="true" className="h-5 w-5" /> Nuevo producto
            </ButtonLink>
          </>
        }
      />
      {sp.borrado ? <div className="mb-4"><Alert>Producto eliminado.</Alert></div> : null}
      <form className="mb-4 flex gap-2" action="/preventista/productos">
        <label className="sr-only" htmlFor="buscar-prod">Buscar</label>
        <input id="buscar-prod" name="q" defaultValue={q} placeholder="Buscar por nombre, SKU o EAN" className="field-input" />
      </form>
      {products.length === 0 ? (
        <EmptyState title="Tu catálogo está vacío" action={<ButtonLink href="/preventista/productos/nuevo">Cargar un producto</ButtonLink>}>
          Cargá productos uno por uno o importalos todos juntos desde un CSV.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/preventista/productos/${p.id}`} className="card flex items-center gap-3 p-3 hover:bg-brand-soft">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 border-ink">
                  <ProductThumb url={uploadUrl(p.images[0]?.thumbKey)} alt={p.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{p.name}</p>
                  <p className="text-sm text-muted">
                    SKU {p.sku} · {p.category.name} · {p._count.pools} pools
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-black tabular-nums">{formatARS(toCents(p.priceCents))}</span>
                  <span className="text-xs">por {SALE_UNIT_LABEL[p.saleUnit].one}</span>
                  {!p.active ? <Badge tone="muted">Inactivo</Badge> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
