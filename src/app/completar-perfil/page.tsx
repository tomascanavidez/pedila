import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CompleteProfileForm } from "@/components/forms/complete-profile-form";
import { Card } from "@/components/ui/display";
import { homeFor } from "@/server/auth/guards";
import { db } from "@/server/db";
import { listGeo } from "@/server/queries/public";

export const metadata: Metadata = { title: "Completá tu perfil" };

export default async function CompleteProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/ingresar?callbackUrl=/completar-perfil");
  const user = await db.user.findUnique({ where: { id: session.user.id }, include: { business: true } });
  if (!user) redirect("/ingresar");
  if (user.role === "ADMIN" || user.business) redirect(homeFor(user.role));
  const geo = await listGeo();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black">¡Hola, {user.name.split(" ")[0]}! Contanos de tu negocio</h1>
        <p className="mt-1 text-muted">Necesitamos los datos fiscales y la dirección para coordinar compras y entregas.</p>
      </div>
      <Card className="p-5 sm:p-8">
        <CompleteProfileForm geo={geo} />
      </Card>
    </div>
  );
}
