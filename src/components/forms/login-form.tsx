"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFullReloadRedirect } from "./use-full-reload-redirect";
import { initialActionState } from "@/lib/action-state";
import { loginAction } from "@/server/actions/auth";
import { FormMessage, SubmitButton, TextField } from "@/components/ui/form";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action] = useActionState(loginAction, initialActionState);
  useFullReloadRedirect(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required inputMode="email" />
      <TextField label="Contraseña" name="password" type="password" autoComplete="current-password" required />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Ingresando…" className="w-full">
        Ingresar
      </SubmitButton>
      <p className="text-center text-sm">
        <Link href="/recuperar" className="font-semibold underline underline-offset-4">
          Me olvidé la contraseña
        </Link>
      </p>
    </form>
  );
}
