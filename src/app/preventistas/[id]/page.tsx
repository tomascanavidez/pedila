import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDateAR } from "@/lib/dates";
import { PoolCard } from "@/components/pools/pool-card";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState, Stars } from "@/components/ui/display";
import { getDistributorPublic, listOpenPools } from "@/server/queries/public";

export const revalidate = 120;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: PageProps<"/preventistas/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const d = await getDistributorPublic(id);
  return { title: d ? d.tradeName : "Preventista" };
}

export default async function DistributorPublicPage(props: PageProps<"/preventistas/[id]">) {
  const { id } = await props.params;
  const d = await getDistributorPublic(id);
  if (!d) notFound();
  const pools = await listOpenPools({ distributorId: id, sort: "cierra-pronto" });
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Card className="flex flex-col gap-3 bg-brand-soft">
        <p className="text-sm font-bold uppercase tracking-wide">Preventista</p>
        <h1 className="text-3xl font-black">{d.tradeName}</h1>
        <p>{d.location} · en PEDILA desde {formatDateAR(new Date(d.since))}</p>
        <Stars value={d.ratingAvg} count={d.ratingCount} />
        {d.description ? <p className="max-w-2xl">{d.description}</p> : null}
        <div>
          <p className="mb-1 text-sm font-bold">Reparte en</p>
          <ul className="flex flex-wrap gap-2">
            {d.coverage.map((c) => (
              <li key={c}>
                <Badge tone="outline">{c}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <ButtonLink href={`/catalogo?preventista=${d.id}`} variant="dark" className="self-start">
          Ver su catálogo
        </ButtonLink>
      </Card>
      <section aria-labelledby="pools-abiertos">
        <h2 id="pools-abiertos" className="mb-3 text-2xl font-black">
          Pools abiertos
        </h2>
        {pools.length === 0 ? (
          <EmptyState title="No tiene pools abiertos ahora" />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pools.map((p) => (
              <li key={p.id}>
                <PoolCard pool={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {d.ratings.length ? (
        <section aria-labelledby="opiniones">
          <h2 id="opiniones" className="mb-3 text-2xl font-black">
            Opiniones de comercios
          </h2>
          <ul className="flex flex-col gap-3">
            {d.ratings.map((r, i) => (
              <li key={i} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{r.commerce}</span>
                  <Stars value={r.stars} />
                </div>
                {r.comment ? <p className="mt-1">{r.comment}</p> : null}
                <p className="mt-1 text-xs text-muted">{formatDateAR(new Date(r.createdAt))}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
