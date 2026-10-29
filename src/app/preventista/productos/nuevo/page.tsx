import type { Metadata } from "next";
import { ProductForm } from "@/components/products/product-forms";
import { PageHeader } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { listCategories } from "@/server/queries/public";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  await requirePageUser(["PREVENTISTA"], "/preventista/productos/nuevo");
  const categories = await listCategories();
  return (
    <>
      <PageHeader title="Nuevo producto" description="Después de crearlo vas a poder subir imágenes." />
      <ProductForm categories={categories} />
    </>
  );
}
