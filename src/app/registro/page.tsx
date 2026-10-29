import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/forms/register-form";
import { Card } from "@/components/ui/display";
import { getCurrentUser, homeFor } from "@/server/auth/guards";
import { listGeo } from "@/server/queries/public";

export const metadata: Metadata = { title: "Registrate" };

export default async function RegisterPage(props: PageProps<"/registro">) {
  const sp = await props.searchParams;
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  const geo = await listGeo();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black">Registrá tu negocio</h1>
        <p className="mt-1 text-muted">
          Es gratis. ¿Ya tenés cuenta?{" "}
          <Link href="/ingresar" className="font-bold text-ink underline underline-offset-4">
            Ingresá
          </Link>
        </p>
      </div>
      <Card className="p-5 sm:p-8">
        <RegisterForm geo={geo} defaultRole={sp.rol === "PREVENTISTA" ? "PREVENTISTA" : "COMERCIO"} />
      </Card>
    </div>
  );
}
