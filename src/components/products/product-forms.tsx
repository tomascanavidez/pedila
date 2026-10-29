"use client";

import { ImagePlus } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { formDataToObject, productSchema, zodFieldErrors } from "@/lib/validation";
import { importProductsAction, removeProductImageAction, saveProductAction } from "@/server/actions/distributor";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { CheckboxField, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";

export interface ProductDefaults {
  id?: string;
  name?: string;
  brand?: string | null;
  description?: string | null;
  sku?: string;
  ean?: string | null;
  categoryId?: string;
  saleUnit?: "UNIDAD" | "BULTO";
  unitsPerPack?: number;
  price?: string;
  retailPrice?: string;
  minOrderQty?: number;
  active?: boolean;
}

export function ProductForm({ categories, defaults = {} }: { categories: { id: string; name: string }[]; defaults?: ProductDefaults }) {
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const parsed = productSchema.safeParse(formDataToObject(fd));
    if (!parsed.success) {
      setClientErrors(zodFieldErrors(parsed.error));
      return { ok: false, message: "Revisá los datos marcados." };
    }
    setClientErrors({});
    return saveProductAction(prev, fd);
  }, initialActionState);
  const [unit, setUnit] = useState(defaults.saleUnit ?? "UNIDAD");
  const e = { ...state.fields, ...clientErrors };
  return (
    <form action={action} className="card flex flex-col gap-4 p-5" noValidate>
      {defaults.id ? <input type="hidden" name="productId" value={defaults.id} /> : null}
      <TextField label="Nombre" name="name" required defaultValue={defaults.name} maxLength={160} error={e.name} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Marca" name="brand" defaultValue={defaults.brand ?? ""} error={e.brand} />
        <SelectField
          label="Categoría"
          name="categoryId"
          required
          placeholder="Elegí una categoría"
          defaultValue={defaults.categoryId ?? ""}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          error={e.categoryId}
        />
        <TextField label="SKU (tu código interno)" name="sku" required defaultValue={defaults.sku} error={e.sku} />
        <TextField label="EAN (código de barras)" name="ean" inputMode="numeric" defaultValue={defaults.ean ?? ""} error={e.ean} />
        <SelectField
          label="Se vende por"
          name="saleUnit"
          value={unit}
          onChange={(ev) => setUnit(ev.target.value as "UNIDAD" | "BULTO")}
          options={[
            { value: "UNIDAD", label: "Unidad" },
            { value: "BULTO", label: "Bulto / caja / pack" },
          ]}
        />
        {unit === "BULTO" ? (
          <TextField label="Unidades por bulto" name="unitsPerPack" type="number" min={1} defaultValue={defaults.unitsPerPack ?? 12} error={e.unitsPerPack} />
        ) : (
          <input type="hidden" name="unitsPerPack" value="1" />
        )}
        <TextField
          label={`Precio por ${unit === "BULTO" ? "bulto" : "unidad"}`}
          name="price"
          required
          inputMode="decimal"
          placeholder="1.234,50"
          defaultValue={defaults.price}
          error={e.price}
        />
        <TextField label="Precio minorista sugerido" name="retailPrice" inputMode="decimal" defaultValue={defaults.retailPrice ?? ""} error={e.retailPrice} />
        <TextField label="Pedido mínimo (catálogo)" name="minOrderQty" type="number" min={1} defaultValue={defaults.minOrderQty ?? 1} error={e.minOrderQty} />
      </div>
      <TextAreaField label="Descripción" name="description" defaultValue={defaults.description ?? ""} error={e.description} />
      <CheckboxField name="active" label="Activo (visible en el catálogo)" defaultChecked={defaults.active ?? true} />
      <FormMessage state={state} />
      <SubmitButton size="lg" className="self-start">
        {defaults.id ? "Guardar cambios" : "Crear producto"}
      </SubmitButton>
    </form>
  );
}

export function ImageUploader({
  productId,
  images,
  maxMb,
}: {
  productId: string;
  images: { id: string; url: string }[];
  maxMb: number;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeState, removeAction] = useActionState(removeProductImageAction, initialActionState);

  async function upload(file: File) {
    setError(null);
    if (file.size > maxMb * 1024 * 1024) return setError(`La imagen supera el máximo de ${maxMb} MB.`);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setError("Solo JPG, PNG o WebP.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/productos/${productId}/imagenes`, { method: "POST", body: fd });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No pudimos subir la imagen.");
      else router.refresh();
    } catch {
      setError("No pudimos subir la imagen. Revisá tu conexión.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-5" aria-labelledby="imagenes">
      <h2 id="imagenes" className="text-lg font-black">
        Imágenes
      </h2>
      <p className="text-sm text-muted">JPG, PNG o WebP de hasta {maxMb} MB. Las optimizamos automáticamente (hasta 6 por producto).</p>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {images.map((img) => (
          <li key={img.id} className="flex flex-col gap-1">
            <Image src={img.url} alt="" width={120} height={120} className="aspect-square w-full rounded-xl border-2 border-ink object-cover" />
            <form action={removeAction}>
              <input type="hidden" name="imageId" value={img.id} />
              <button type="submit" className="w-full text-xs font-bold underline">
                Quitar
              </button>
            </form>
          </li>
        ))}
      </ul>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id={`up-${productId}`} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <label htmlFor={`up-${productId}`} className={buttonClass("secondary", "md", `self-start cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`)}>
        <ImagePlus aria-hidden="true" className="h-5 w-5" /> {busy ? "Subiendo…" : "Subir imagen"}
      </label>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <FormMessage state={removeState} />
    </section>
  );
}

export function CsvImportForm() {
  const [state, action] = useActionState(importProductsAction, initialActionState);
  const errors = (state.data?.errors as { line: number; message: string }[] | undefined) ?? [];
  return (
    <form action={action} className="card flex flex-col gap-4 p-5">
      <label className="flex flex-col gap-1 text-sm font-bold">
        Archivo CSV
        <input type="file" name="file" accept=".csv,text/csv" required className="field-input py-2" />
      </label>
      <FormMessage state={state} />
      {errors.length ? (
        <div className="rounded-xl border-2 border-danger p-3 text-sm">
          <p className="font-bold text-danger">Filas con errores (no se importaron):</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e.line}>
                Fila {e.line}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SubmitButton pendingText="Importando…" className="self-start">
        Importar productos
      </SubmitButton>
    </form>
  );
}
