import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/forms/reset-forms";
import { Card } from "@/components/ui/display";

export const metadata: Metadata = { title: "Nueva contraseña", robots: { index: false } };

export default async function ResetPasswordPage(props: PageProps<"/recuperar/[token]">) {
  const { token } = await props.params;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-black">Elegí una contraseña nueva</h1>
      <Card>
        <ResetPasswordForm token={token} />
      </Card>
    </div>
  );
}
