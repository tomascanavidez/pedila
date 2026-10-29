import type { Metadata } from "next";
import { ResetRequestForm } from "@/components/forms/reset-forms";
import { Card } from "@/components/ui/display";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function ResetRequestPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black">Recuperá tu contraseña</h1>
        <p className="mt-1 text-muted">Te mandamos un link a tu email para elegir una nueva.</p>
      </div>
      <Card>
        <ResetRequestForm />
      </Card>
    </div>
  );
}
