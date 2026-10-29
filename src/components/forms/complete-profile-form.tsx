"use client";

import { useActionState, useState } from "react";
import { useFullReloadRedirect } from "./use-full-reload-redirect";
import { initialActionState } from "@/lib/action-state";
import { completeProfileAction } from "@/server/actions/auth";
import { FormMessage, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { BusinessFields } from "./business-fields";
import type { GeoProvince } from "./location-fields";

export function CompleteProfileForm({ geo }: { geo: GeoProvince[] }) {
  const [state, action] = useActionState(completeProfileAction, initialActionState);
  useFullReloadRedirect(state);
  const [role, setRole] = useState<"COMERCIO" | "PREVENTISTA">("COMERCIO");
  const errors = state.fields ?? {};
  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Tipo de cuenta"
          name="role"
          required
          value={role}
          onChange={(e) => setRole(e.target.value as "COMERCIO" | "PREVENTISTA")}
          options={[
            { value: "COMERCIO", label: "Comercio (compro)" },
            { value: "PREVENTISTA", label: "Preventista / distribuidor (vendo)" },
          ]}
          error={errors.role}
        />
        <TextField label="Celular / WhatsApp" name="phone" type="tel" autoComplete="tel" error={errors.phone} />
      </div>
      <BusinessFields geo={geo} errors={errors} isDistributor={role === "PREVENTISTA"} />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Guardando…" className="w-full">
        Guardar y continuar
      </SubmitButton>
    </form>
  );
}
