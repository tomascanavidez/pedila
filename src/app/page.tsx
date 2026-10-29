import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PoolCard } from "@/components/pools/pool-card";
import { PoolFilters } from "@/components/pools/pool-filters";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { getCurrentUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { listCategories, listGeo, listOpenPools, type PoolSort } from "@/server/queries/public";

export const dynamic = "force-dynamic";

const SORTS: PoolSort[] = ["destacados", "cierra-pronto", "mayor-ahorro", "nuevos"];

function intParam(v: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function HomePage(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const [geo, categories, user] = await Promise.all([listGeo(), listCategories(), getCurrentUser().catch(() => null)]);

  let provinceId = intParam(sp.provincia);
  let localityId = intParam(sp.localidad);
  let usingMyZone = false;
  // Un comercio logueado ve por defecto los pools que llegan a su zona.
  if (!provinceId && !sp.todas && user?.role === "COMERCIO" && user.businessId) {
    const b = await db.business.findUnique({ where: { id: user.businessId }, select: { provinceId: true, localityId: true } });
    if (b) {
      provinceId = b.provinceId;
      localityId = b.localityId;
      usingMyZone = true;
    }
  }
  const sortRaw = typeof sp.orden === "string" ? sp.orden : "destacados";
  const sort = (SORTS as string[]).includes(sortRaw) ? (sortRaw as PoolSort) : "destacados";
  const category = typeof sp.categoria === "string" ? sp.categoria.slice(0, 80) : undefined;
  const q = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim().slice(0, 80) : undefined;

  const pools = await listOpenPools({ provinceId, localityId, category, sort, q });
  const zoneName = (() => {
    const p = geo.find((x) => x.id === provinceId);
    const l = p?.localities.find((x) => x.id === localityId);
    return l ? `${l.name}, ${p?.name}` : p?.name;
  })();

  return (
    <>
      {!user ? (
        <section className="border-b-2 border-ink bg-brand">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:py-12">
            <h1 className="max-w-2xl text-3xl font-black leading-tight tracking-tight sm:text-5xl">
              Comprá a precio de pallet, aunque tengas un kiosco.
            </h1>
            <p className="max-w-xl text-lg">
              Sumate con otros comercios de tu zona a una compra mayorista. Cuando se completa el volumen, todos pagan como si fuera una sola compra grande.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/registro" variant="dark" size="lg">
                Registrá tu negocio gratis <ArrowRight aria-hidden="true" className="h-5 w-5" />
              </ButtonLink>
              <ButtonLink href="/como-funciona" variant="secondary" size="lg">
                Cómo funciona
              </ButtonLink>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-6xl px-4 py-6" aria-labelledby="titulo-pools">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="titulo-pools" className="text-2xl font-black sm:text-3xl">
              {usingMyZone ? "Pools en tu zona" : "Pools abiertos"}
            </h2>
            <p className="text-muted">
              {zoneName ? `Entregan en ${zoneName}. ` : ""}
              {usingMyZone ? (
                <Link href="/?todas=1" className="font-semibold text-ink underline underline-offset-4">
                  Ver todas las zonas
                </Link>
              ) : null}
            </p>
          </div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Users aria-hidden="true" className="h-4 w-4" /> {pools.length} {pools.length === 1 ? "pool" : "pools"}
          </p>
        </div>
        <Suspense fallback={null}>
          <PoolFilters provinces={geo} categories={categories} />
        </Suspense>
        <div className="mt-6">
          {pools.length === 0 ? (
            <EmptyState
              title="No hay pools abiertos con estos filtros"
              action={
                <ButtonLink href="/catalogo" variant="secondary">
                  Ver el catálogo
                </ButtonLink>
              }
            >
              Probá con otra zona o categoría. También podés pedir directo del catálogo de los preventistas.
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pools.map((p) => (
                <li key={p.id} className="flex">
                  <div className="w-full">
                    <PoolCard pool={p} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
