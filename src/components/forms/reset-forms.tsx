"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { requestResetAction, resetPasswordAction } from "@/server/actions/auth";
import { FormMessage, SubmitButton, TextField } from "@/components/ui/form";

export function ResetRequestForm() {
  const [state, action] = useActionState(requestResetAction, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={state.fields?.email} />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Enviando…" className="w-full">
        Enviarme el link
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <TextField
        label="Contraseña nueva"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="Mínimo 8 caracteres, con al menos una letra y un número."
        error={state.fields?.password}
      />
      <TextField label="Repetí la contraseña" name="passwordConfirm" type="password" autoComplete="new-password" required error={state.fields?.passwordConfirm} />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Guardando…" className="w-full">
        Guardar contraseña
      </SubmitButton>
    </form>
  );
}
