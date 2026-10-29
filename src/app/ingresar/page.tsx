import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { googleEnabled } from "@/auth";
import { LoginForm } from "@/components/forms/login-form";
import { Alert, Card } from "@/components/ui/display";
import { googleLoginAction } from "@/server/actions/auth";
import { getCurrentUser, homeFor, safeCallbackUrl } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Ingresar" };

const ERRORS: Record<string, string> = {
  cuenta_suspendida: "Tu cuenta está suspendida. Escribinos para revisarla.",
  GoogleSinEmail: "Tu cuenta de Google no tiene un email verificado.",
  AccessDenied: "No pudimos ingresar con esa cuenta.",
  OAuthAccountNotLinked: "Ese email ya está registrado con otro método de ingreso.",
};

export default async function LoginPage(props: PageProps<"/ingresar">) {
  const sp = await props.searchParams;
  const callbackUrl = safeCallbackUrl(typeof sp.callbackUrl === "string" ? sp.callbackUrl : null, "");
  const user = await getCurrentUser();
  if (user) redirect(callbackUrl || homeFor(user.role));
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "No pudimos completar el ingreso. Probá de nuevo.") : null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-black">Ingresá a PEDILA</h1>
        <p className="mt-1 text-muted">Para sumarte a pools, pedir y seguir tus entregas.</p>
      </div>
      {sp.registrado ? <Alert>¡Tu cuenta quedó creada! Ingresá con tu email y contraseña.</Alert> : null}
      {sp.clave ? <Alert>Listo, cambiaste tu contraseña. Ya podés ingresar.</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card>
        <LoginForm callbackUrl={callbackUrl} />
        {googleEnabled ? (
          <form action={googleLoginAction} className="mt-4 border-t-2 border-line pt-4">
            <input type="hidden" name="callbackUrl" value={callbackUrl || "/"} />
            <button type="submit" className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-ink font-bold hover:bg-brand-soft">
              <span aria-hidden="true" className="text-lg font-black">G</span> Ingresar con Google
            </button>
          </form>
        ) : null}
      </Card>
      <p className="text-center">
        ¿No tenés cuenta?{" "}
        <Link href="/registro" className="font-bold underline underline-offset-4">
          Registrá tu negocio
        </Link>
      </p>
    </div>
  );
}
