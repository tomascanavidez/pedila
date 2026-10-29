import type { Metadata } from "next";
import { formatBps } from "@/domain/money";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader } from "@/components/ui/display";
import { saveCategoryAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Categorías" };

export default async function CategoriesPage() {
  await requirePageUser(["ADMIN"], "/admin/categorias");
  const categories = await db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true, pools: true } } } });
  return (
    <>
      <PageHeader title="Categorías" description="La comisión por categoría se edita en Comisiones." />
      <Card className="mb-6">
        <h2 className="mb-3 text-lg font-black">Nueva categoría</h2>
        <ActionForm action={saveCategoryAction} submitLabel="Crear" resetOnSuccess className="sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-sm font-bold">
            Nombre
            <input name="name" required className="field-input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Slug (para la URL)
            <input name="slug" required pattern="[a-z0-9-]{2,80}" placeholder="ej. lacteos" className="field-input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Orden
            <input name="sortOrder" type="number" min={0} defaultValue={categories.length + 1} className="field-input w-24" />
          </label>
        </ActionForm>
      </Card>
      <ul className="flex flex-col gap-3">
        {categories.map((c) => (
          <li key={c.id} className="card p-4">
            <p className="mb-2 text-sm text-muted">
              {c._count.products} productos · {c._count.pools} pools · comisión {c.commissionBps === null ? "global" : formatBps(c.commissionBps)}
            </p>
            <ActionForm action={saveCategoryAction} submitLabel="Guardar" size="sm" variant="secondary" className="sm:flex-row sm:flex-wrap sm:items-end">
              <input type="hidden" name="id" value={c.id} />
              <label className="flex flex-col gap-1 text-sm font-bold">
                Nombre
                <input name="name" required defaultValue={c.name} className="field-input" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Slug
                <input name="slug" required defaultValue={c.slug} className="field-input" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Orden
                <input name="sortOrder" type="number" min={0} defaultValue={c.sortOrder} className="field-input w-24" />
              </label>
              <label className="flex min-h-[48px] items-center gap-2 font-semibold">
                <input type="checkbox" name="active" defaultChecked={c.active} className="h-5 w-5 accent-[#111111]" /> Activa
              </label>
            </ActionForm>
          </li>
        ))}
      </ul>
    </>
  );
}
