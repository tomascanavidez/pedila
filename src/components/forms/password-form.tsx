"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { changePasswordAction } from "@/server/actions/commerce";
import { FormMessage, SubmitButton, TextField } from "@/components/ui/form";

/** Cambio de contraseña (para cuentas sin negocio, como los administradores). */
export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField label="Contraseña actual" name="current" type="password" autoComplete="current-password" error={state.fields?.current} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Contraseña nueva" name="password" type="password" autoComplete="new-password" hint="Mínimo 8 caracteres, con letras y números." error={state.fields?.password} />
        <TextField label="Repetila" name="passwordConfirm" type="password" autoComplete="new-password" error={state.fields?.passwordConfirm} />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="self-start">Cambiar contraseña</SubmitButton>
    </form>
  );
}
