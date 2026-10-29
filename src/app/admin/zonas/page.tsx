import type { Metadata } from "next";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader } from "@/components/ui/display";
import { createLocalityAction, toggleLocalityAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Zonas" };

export default async function ZonesPage(props: PageProps<"/admin/zonas">) {
  const sp = await props.searchParams;
  await requirePageUser(["ADMIN"], "/admin/zonas");
  const provinces = await db.province.findMany({ orderBy: { name: "asc" }, include: { localities: { orderBy: { name: "asc" }, include: { _count: { select: { businesses: true } } } } } });
  const selected = provinces.find((p) => String(p.id) === sp.provincia) ?? provinces[0];
  return (
    <>
      <PageHeader title="Zonas de entrega" description="Provincias (código INDEC) y localidades que se usan en registros, pools y repartos." />
      <Card className="mb-6">
        <h2 className="mb-3 text-lg font-black">Agregar localidad</h2>
        <ActionForm action={createLocalityAction} submitLabel="Agregar" resetOnSuccess className="sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-sm font-bold">
            Provincia
            <select name="provinceId" defaultValue={selected?.id} className="field-input">
              {provinces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Localidad / barrio / partido
            <input name="name" required className="field-input" />
          </label>
        </ActionForm>
      </Card>
      <form className="mb-4" action="/admin/zonas">
        <label className="flex flex-col gap-1 text-sm font-bold">
          Ver localidades de
          <select name="provincia" defaultValue={selected?.id} className="field-input">
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.localities.length})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="mt-2 font-bold underline">Ver</button>
      </form>
      {selected ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {selected.localities.map((l) => (
            <li key={l.id} className="card flex items-center justify-between gap-2 p-3">
              <span className={l.active ? "font-semibold" : "text-disabled line-through"}>
                {l.name} <span className="text-xs font-normal text-muted">({l._count.businesses} negocios)</span>
              </span>
              <ActionForm action={toggleLocalityAction} submitLabel={l.active ? "Desactivar" : "Activar"} size="sm" variant="secondary" inline>
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="active" value={l.active ? "0" : "1"} />
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
