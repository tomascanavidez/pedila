"use client";

import { Store, Truck } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFullReloadRedirect } from "./use-full-reload-redirect";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { formDataToObject, registerSchema, zodFieldErrors } from "@/lib/validation";
import { registerAction } from "@/server/actions/auth";
import { cn } from "@/components/ui/cn";
import { CheckboxField, FormMessage, SubmitButton, TextField } from "@/components/ui/form";
import { BusinessFields } from "./business-fields";
import type { GeoProvince } from "./location-fields";

export function RegisterForm({ geo, defaultRole }: { geo: GeoProvince[]; defaultRole: "COMERCIO" | "PREVENTISTA" }) {
  const [role, setRole] = useState<"COMERCIO" | "PREVENTISTA">(defaultRole);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    // Validación inmediata en el navegador con el mismo esquema que usa el servidor.
    const check = registerSchema.safeParse(formDataToObject(fd));
    if (!check.success) {
      setClientErrors(zodFieldErrors(check.error));
      return { ok: false, message: "Revisá los datos marcados." };
    }
    setClientErrors({});
    return registerAction(prev, fd);
  }, initialActionState);
  useFullReloadRedirect(state);
  const errors = { ...state.fields, ...clientErrors };

  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <fieldset>
        <legend className="mb-3 text-lg font-black">¿Qué tipo de cuenta querés?</legend>
        <input type="hidden" name="role" value={role} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de cuenta">
          {[
            { value: "COMERCIO" as const, icon: Store, title: "Soy comercio", text: "Kiosco, despensa, almacén. Quiero comprar mejor." },
            { value: "PREVENTISTA" as const, icon: Truck, title: "Soy preventista", text: "Distribuyo productos y quiero vender por volumen." },
          ].map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={role === o.value}
              onClick={() => setRole(o.value)}
              className={cn(
                "flex items-start gap-3 rounded-2xl border-2 border-ink p-4 text-left",
                role === o.value ? "bg-brand" : "bg-paper hover:bg-brand-soft",
              )}
            >
              <o.icon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
              <span>
                <span className="block font-black">{o.title}</span>
                <span className="block text-sm">{o.text}</span>
              </span>
            </button>
          ))}
        </div>
        {role === "PREVENTISTA" ? (
          <p className="mt-3 text-sm">Revisamos los datos de cada preventista antes de habilitar las publicaciones (suele tardar menos de 24 h hábiles).</p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-lg font-black">Tus datos</legend>
        <TextField label="Nombre y apellido" name="name" required autoComplete="name" error={errors.name} />
        <TextField label="Email" name="email" type="email" required autoComplete="email" inputMode="email" error={errors.email} />
        <TextField label="Celular / WhatsApp" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="11 5555-5555" error={errors.phone} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Contraseña"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            hint="Mínimo 8 caracteres, con letras y números."
            error={errors.password}
          />
          <TextField label="Repetí la contraseña" name="passwordConfirm" type="password" required autoComplete="new-password" error={errors.passwordConfirm} />
        </div>
      </fieldset>

      <BusinessFields geo={geo} errors={errors} isDistributor={role === "PREVENTISTA"} />

      <CheckboxField
        name="terms"
        label={
          <>
            Acepto las condiciones de uso de PEDILA y que mis datos se usen para operar las compras.{" "}
            <Link href="/como-funciona" className="underline">
              Ver cómo funciona
            </Link>
          </>
        }
        error={errors.terms}
      />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Creando tu cuenta…" className="w-full">
        Crear mi cuenta
      </SubmitButton>
    </form>
  );
}
