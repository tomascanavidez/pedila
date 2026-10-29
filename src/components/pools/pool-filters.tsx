"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { cn } from "@/components/ui/cn";

interface Props {
  provinces: { id: number; name: string; localities: { id: number; name: string }[] }[];
  categories: { slug: string; name: string }[];
  /** Ruta a la que apuntan los filtros (por defecto "/"). */
  basePath?: string;
  showSort?: boolean;
}

const SORTS = [
  { value: "destacados", label: "Destacados" },
  { value: "cierra-pronto", label: "Cierran pronto" },
  { value: "mayor-ahorro", label: "Mayor ahorro" },
  { value: "nuevos", label: "Más nuevos" },
];

/**
 * Filtros por zona, categoría y orden. Funcionan como un formulario GET común (sin JS
 * también funcionan con el botón "Filtrar"); con JS se aplican al instante.
 */
export function PoolFilters({ provinces, categories, basePath = "/", showSort = true }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const provincia = params.get("provincia") ?? "";
  const localidad = params.get("localidad") ?? "";
  const categoria = params.get("categoria") ?? "";
  const orden = params.get("orden") ?? "destacados";
  const localities = useMemo(
    () => provinces.find((p) => String(p.id) === provincia)?.localities ?? [],
    [provinces, provincia],
  );

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.delete("todas");
    if (!sp.get("provincia")) sp.set("todas", "1");
    startTransition(() => router.push(`${basePath}?${sp.toString()}`, { scroll: false }));
  }

  return (
    <form action={basePath} method="get" className="flex flex-col gap-3" aria-busy={pending || undefined}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-bold">
          Provincia
          <select
            name="provincia"
            className="field-input"
            value={provincia}
            onChange={(e) => update({ provincia: e.target.value, localidad: "" })}
          >
            <option value="">Todas las zonas</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          Localidad
          <select
            name="localidad"
            className="field-input"
            value={localidad}
            disabled={!provincia}
            onChange={(e) => update({ localidad: e.target.value })}
          >
            <option value="">{provincia ? "Toda la provincia" : "Elegí una provincia"}</option>
            {localities.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {showSort ? (
          <label className="flex flex-col gap-1 text-sm font-bold">
            Ordenar
            <select name="orden" className="field-input" value={orden} onChange={(e) => update({ orden: e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label="Categorías">
        <div className="flex gap-2 pb-1">
          {[{ slug: "", name: "Todas" }, ...categories].map((c) => (
            <button
              key={c.slug || "todas"}
              type="button"
              aria-pressed={categoria === c.slug}
              onClick={() => update({ categoria: c.slug })}
              className={cn(
                "min-h-[44px] shrink-0 rounded-full border-2 border-ink px-4 text-sm font-bold whitespace-nowrap",
                categoria === c.slug ? "bg-ink text-brand" : "bg-paper hover:bg-brand-soft",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <noscript>
        <button type="submit" className="field-input font-bold">
          Filtrar
        </button>
      </noscript>
    </form>
  );
}
