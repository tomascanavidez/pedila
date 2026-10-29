import type { Metadata } from "next";
import { PoolForm } from "@/components/pools/pool-form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { newPoolDefaults, poolFormData } from "@/server/queries/distributor";

export const metadata: Metadata = { title: "Nuevo pool" };

export default async function NewPoolPage(props: PageProps<"/preventista/pools/nuevo">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["PREVENTISTA"], "/preventista/pools/nuevo");
  const data = await poolFormData(user.businessId!);
  if (data.products.length === 0) {
    return (
      <>
        <PageHeader title="Nuevo pool" />
        <EmptyState title="Primero cargá un producto" action={<ButtonLink href="/preventista/productos/nuevo">Cargar producto</ButtonLink>}>
          Cada pool se arma sobre un producto de tu catálogo.
        </EmptyState>
      </>
    );
  }
  const productId = typeof sp.producto === "string" ? sp.producto : undefined;
  return (
    <>
      <PageHeader title="Nuevo pool de compra" description="Publicá una oferta por volumen: los comercios se suman de a pocas unidades al precio mayorista." />
      <PoolForm products={data.products} commission={data.commission} geo={data.geo} canPublish={data.canPublish} defaults={newPoolDefaults(data.coverage, productId)} />
    </>
  );
}
