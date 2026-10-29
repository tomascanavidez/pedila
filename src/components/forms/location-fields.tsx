"use client";

import { useMemo, useState } from "react";
import { SelectField } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";

export interface GeoProvince {
  id: number;
  name: string;
  localities: { id: number; name: string }[];
}

/** Provincia + localidad dependientes. */
export function LocationFields({
  geo,
  defaultProvinceId,
  defaultLocalityId,
  errors,
}: {
  geo: GeoProvince[];
  defaultProvinceId?: number;
  defaultLocalityId?: number;
  errors?: Record<string, string>;
}) {
  const [province, setProvince] = useState(defaultProvinceId ? String(defaultProvinceId) : "");
  const localities = useMemo(() => geo.find((p) => String(p.id) === province)?.localities ?? [], [geo, province]);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SelectField
        label="Provincia"
        name="provinceId"
        required
        placeholder="Elegí la provincia"
        value={province}
        onChange={(e) => setProvince(e.target.value)}
        options={geo.map((p) => ({ value: String(p.id), label: p.name }))}
        error={errors?.provinceId}
      />
      <SelectField
        key={province}
        label="Localidad"
        name="localityId"
        required
        disabled={!province}
        placeholder={province ? "Elegí la localidad" : "Primero elegí la provincia"}
        defaultValue={defaultLocalityId && String(defaultProvinceId) === province ? String(defaultLocalityId) : ""}
        options={localities.map((l) => ({ value: String(l.id), label: l.name }))}
        error={errors?.localityId}
        hint={province && localities.length === 0 ? "Todavía no cargamos localidades en esta provincia: escribinos." : undefined}
      />
    </div>
  );
}

export interface ZoneValue {
  provinceId: number;
  localityId: number | null;
}

/**
 * Selector de zonas (provincias enteras o localidades sueltas).
 * Genera inputs ocultos `${name}[]` con el formato "provincia:localidad" o "provincia:*".
 */
export function ZonePicker({
  geo,
  name,
  defaultValue = [],
  error,
  label = "Zonas de entrega",
  hint,
}: {
  geo: GeoProvince[];
  name: string;
  defaultValue?: ZoneValue[];
  error?: string;
  label?: string;
  hint?: string;
}) {
  const [zones, setZones] = useState<ZoneValue[]>(defaultValue);
  const [province, setProvince] = useState<string>(defaultValue[0] ? String(defaultValue[0].provinceId) : "");
  const current = geo.find((p) => String(p.id) === province);
  const has = (p: number, l: number | null) => zones.some((z) => z.provinceId === p && z.localityId === l);
  const wholeProvince = current ? has(current.id, null) : false;

  function toggle(p: number, l: number | null) {
    setZones((prev) => {
      if (prev.some((z) => z.provinceId === p && z.localityId === l)) {
        return prev.filter((z) => !(z.provinceId === p && z.localityId === l));
      }
      // Elegir toda la provincia reemplaza a las localidades sueltas de esa provincia.
      const base = l === null ? prev.filter((z) => z.provinceId !== p) : prev;
      return [...base, { provinceId: p, localityId: l }];
    });
  }

  const labelOf = (z: ZoneValue) => {
    const p = geo.find((g) => g.id === z.provinceId);
    if (!p) return "";
    if (z.localityId === null) return `Toda ${p.name}`;
    return `${p.localities.find((l) => l.id === z.localityId)?.name ?? "?"} (${p.name})`;
  };

  return (
    <fieldset className="flex flex-col gap-3" aria-invalid={error ? true : undefined}>
      <legend className="text-sm font-bold">{label}</legend>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      {zones.map((z) => (
        <input key={`${z.provinceId}:${z.localityId ?? "*"}`} type="hidden" name={`${name}[]`} value={`${z.provinceId}:${z.localityId ?? "*"}`} />
      ))}
      <select className="field-input" value={province} onChange={(e) => setProvince(e.target.value)} aria-label="Provincia para agregar zonas">
        <option value="">Elegí una provincia</option>
        {geo.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {current ? (
        <div className="card max-h-72 overflow-y-auto p-3">
          <label className="flex min-h-[44px] items-center gap-3 font-bold">
            <input type="checkbox" className="h-6 w-6 accent-[#111111]" checked={wholeProvince} onChange={() => toggle(current.id, null)} />
            Toda la provincia de {current.name}
          </label>
          <div className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {current.localities.map((l) => (
              <label key={l.id} className={cn("flex min-h-[44px] items-center gap-3", wholeProvince && "text-disabled")}>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[#111111]"
                  disabled={wholeProvince}
                  checked={wholeProvince || has(current.id, l.id)}
                  onChange={() => toggle(current.id, l.id)}
                />
                {l.name}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {zones.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Zonas elegidas">
          {zones.map((z) => (
            <li key={`${z.provinceId}-${z.localityId ?? "x"}`}>
              <button
                type="button"
                onClick={() => toggle(z.provinceId, z.localityId)}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full border-2 border-ink bg-brand px-3 text-sm font-bold"
                aria-label={`Quitar ${labelOf(z)}`}
              >
                {labelOf(z)} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Todavía no elegiste zonas.</p>
      )}
      {error ? (
        <p className="text-sm font-semibold text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
