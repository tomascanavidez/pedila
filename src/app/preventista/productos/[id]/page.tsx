import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { centsToInput, toCents } from "@/domain/money";
import { ImageUploader, ProductForm } from "@/components/products/product-forms";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/display";
import { deleteProductAction } from "@/server/actions/distributor";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { listCategories } from "@/server/queries/public";
import { uploadUrl } from "@/server/storage/storage";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditProductPage(props: PageProps<"/preventista/productos/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requirePageUser(["PREVENTISTA"], `/preventista/productos/${id}`);
  const [product, categories] = await Promise.all([
    db.product.findUnique({ where: { id }, include: { images: { orderBy: { sortOrder: "asc" } } } }),
    listCategories(),
  ]);
  if (!product || product.distributorId !== user.businessId) notFound();
  return (
    <>
      <PageHeader
        title={product.name}
        description={`SKU ${product.sku}`}
        actions={
          <ButtonLink href={`/preventista/pools/nuevo?producto=${product.id}`} variant="primary">
            Crear pool con este producto
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-6">
        {sp.nuevo ? <Alert>¡Producto creado! Sumale imágenes para que se vea mejor.</Alert> : null}
        <ImageUploader productId={product.id} maxMb={getEnv().UPLOAD_MAX_MB} images={product.images.map((i) => ({ id: i.id, url: uploadUrl(i.thumbKey)! }))} />
        <ProductForm
          categories={categories}
          defaults={{
            id: product.id,
            name: product.name,
            brand: product.brand,
            description: product.description,
            sku: product.sku,
            ean: product.ean,
            categoryId: product.categoryId,
            saleUnit: product.saleUnit,
            unitsPerPack: product.unitsPerPack,
            price: centsToInput(toCents(product.priceCents)),
            retailPrice: product.retailPriceCents === null ? "" : centsToInput(toCents(product.retailPriceCents)),
            minOrderQty: product.minOrderQty,
            active: product.active,
          }}
        />
        <ActionForm action={deleteProductAction} submitLabel="Eliminar producto" variant="secondary" confirm="¿Eliminar este producto? Si tiene pools o pedidos, se desactiva." buttonClassName="self-start">
          <input type="hidden" name="productId" value={product.id} />
        </ActionForm>
      </div>
    </>
  );
}
