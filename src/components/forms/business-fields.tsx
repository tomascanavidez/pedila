"use client";

import { IVA_OPTIONS } from "@/lib/validation";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form";
import { LocationFields, ZonePicker, type GeoProvince, type ZoneValue } from "./location-fields";

export interface BusinessDefaults {
  legalName?: string;
  tradeName?: string;
  cuit?: string;
  ivaCondition?: string;
  street?: string;
  streetNumber?: string;
  floorApt?: string | null;
  postalCode?: string | null;
  provinceId?: number;
  localityId?: number;
  description?: string | null;
  coverage?: ZoneValue[];
}

/** Datos fiscales y dirección del negocio (registro, completar perfil y edición). */
export function BusinessFields({
  geo,
  errors = {},
  isDistributor,
  defaults = {},
  cuitLocked = false,
}: {
  geo: GeoProvince[];
  errors?: Record<string, string>;
  isDistributor: boolean;
  defaults?: BusinessDefaults;
  cuitLocked?: boolean;
}) {
  return (
    <>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-lg font-black">Datos fiscales</legend>
        <TextField
          label="Nombre del negocio"
          name="tradeName"
          required
          autoComplete="organization"
          placeholder={isDistributor ? "Distribuidora Sur" : "Kiosco La Esquina"}
          defaultValue={defaults.tradeName}
          error={errors.tradeName}
        />
        <TextField
          label="Razón social"
          name="legalName"
          required
          placeholder="Como figura en AFIP/ARCA"
          defaultValue={defaults.legalName}
          error={errors.legalName}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cuitLocked ? (
            <TextField label="CUIT" name="cuitView" disabled defaultValue={defaults.cuit} hint="Para cambiar el CUIT escribinos." />
          ) : (
            <TextField
              label="CUIT"
              name="cuit"
              required
              inputMode="numeric"
              placeholder="20-12345678-6"
              defaultValue={defaults.cuit}
              error={errors.cuit}
              hint="11 números, con o sin guiones."
            />
          )}
          <SelectField
            label="Condición frente al IVA"
            name="ivaCondition"
            required
            placeholder="Elegí una opción"
            defaultValue={defaults.ivaCondition ?? ""}
            options={Object.entries(IVA_OPTIONS).map(([value, label]) => ({ value, label }))}
            error={errors.ivaCondition}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-lg font-black">Dirección {isDistributor ? "del depósito" : "del local"}</legend>
        <div className="grid grid-cols-[1fr_7rem] gap-4">
          <TextField label="Calle" name="street" required autoComplete="address-line1" defaultValue={defaults.street} error={errors.street} />
          <TextField label="Altura" name="streetNumber" required inputMode="numeric" defaultValue={defaults.streetNumber} error={errors.streetNumber} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Piso / local" name="floorApt" defaultValue={defaults.floorApt ?? ""} error={errors.floorApt} />
          <TextField label="Código postal" name="postalCode" autoComplete="postal-code" defaultValue={defaults.postalCode ?? ""} error={errors.postalCode} />
        </div>
        <LocationFields geo={geo} defaultProvinceId={defaults.provinceId} defaultLocalityId={defaults.localityId} errors={errors} />
      </fieldset>

      {isDistributor ? (
        <>
          <ZonePicker
            geo={geo}
            name="coverage"
            label="¿Dónde repartís?"
            hint="Elegí provincias completas o localidades. Solo los comercios de estas zonas van a poder pedirte por catálogo."
            defaultValue={defaults.coverage}
            error={errors.coverage}
          />
          <TextAreaField
            label="Contale a los comercios sobre tu distribuidora"
            name="description"
            placeholder="Marcas que trabajás, días de reparto, condiciones…"
            defaultValue={defaults.description ?? ""}
            error={errors.description}
          />
        </>
      ) : null}
    </>
  );
}
