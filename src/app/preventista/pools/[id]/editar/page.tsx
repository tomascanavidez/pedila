import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PoolForm } from "@/components/pools/pool-form";
import { PageHeader } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { poolEditDefaults, poolFormData } from "@/server/queries/distributor";

export const metadata: Metadata = { title: "Editar pool" };

export default async function EditPoolPage(props: PageProps<"/preventista/pools/[id]/editar">) {
  const { id } = await props.params;
  const user = await requirePageUser(["PREVENTISTA"], `/preventista/pools/${id}/editar`);
  const pool = await db.pool.findUnique({ where: { id }, select: { distributorId: true, status: true } });
  if (!pool || pool.distributorId !== user.businessId) notFound();
  if (pool.status !== "BORRADOR") redirect(`/preventista/pools/${id}`);
  const [data, defaults] = await Promise.all([poolFormData(user.businessId!), poolEditDefaults(id)]);
  return (
    <>
      <PageHeader title="Editar borrador" />
      <PoolForm products={data.products} commission={data.commission} geo={data.geo} canPublish={data.canPublish} defaults={defaults!} />
    </>
  );
}
