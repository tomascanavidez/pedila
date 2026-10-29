"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/action-state";
import { changePasswordAction, updateProfileAction } from "@/server/actions/commerce";
import { Card } from "@/components/ui/display";
import { FormMessage, SubmitButton, TextField } from "@/components/ui/form";
import { BusinessFields, type BusinessDefaults } from "./business-fields";
import type { GeoProvince } from "./location-fields";

export function ProfileForm({
  geo,
  isDistributor,
  defaults,
  user,
  hasPassword,
}: {
  geo: GeoProvince[];
  isDistributor: boolean;
  defaults: BusinessDefaults;
  user: { name: string; email: string; phone: string | null };
  hasPassword: boolean;
}) {
  const [state, action] = useActionState(updateProfileAction, initialActionState);
  const [pwState, pwAction] = useActionState(changePasswordAction, initialActionState);
  const errors = state.fields ?? {};
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 sm:p-6">
        <form action={action} className="flex flex-col gap-8" noValidate>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-lg font-black">Contacto</legend>
            <TextField label="Nombre y apellido" name="name" required defaultValue={user.name} error={errors.name} />
            <TextField label="Email" name="emailView" disabled defaultValue={user.email} hint="Para cambiar el email escribinos." />
            <TextField label="Celular / WhatsApp" name="phone" type="tel" defaultValue={user.phone ?? ""} error={errors.phone} />
          </fieldset>
          <BusinessFields geo={geo} errors={errors} isDistributor={isDistributor} defaults={defaults} cuitLocked />
          <FormMessage state={state} />
          <SubmitButton size="lg" className="w-full sm:w-auto">
            Guardar cambios
          </SubmitButton>
        </form>
      </Card>
      <Card className="p-5 sm:p-6">
        <form action={pwAction} className="flex flex-col gap-4">
          <h2 className="text-lg font-black">Cambiar contraseña</h2>
          {hasPassword ? <TextField label="Contraseña actual" name="current" type="password" autoComplete="current-password" error={pwState.fields?.current} /> : <input type="hidden" name="current" value="" />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Contraseña nueva" name="password" type="password" autoComplete="new-password" error={pwState.fields?.password} />
            <TextField label="Repetila" name="passwordConfirm" type="password" autoComplete="new-password" error={pwState.fields?.passwordConfirm} />
          </div>
          <FormMessage state={pwState} />
          <SubmitButton variant="secondary" className="self-start">
            Cambiar contraseña
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
