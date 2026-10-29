import type { Metadata } from "next";
import { PasswordForm } from "@/components/forms/password-form";
import { Card, DataList, PageHeader } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AdminAccountPage() {
  const user = await requirePageUser(["ADMIN"], "/admin/cuenta");
  return (
    <>
      <PageHeader title="Mi cuenta" />
      <div className="flex flex-col gap-6">
        <Card>
          <DataList items={[{ label: "Nombre", value: user.name }, { label: "Email", value: user.email }]} />
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-black">Cambiar contraseña</h2>
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
