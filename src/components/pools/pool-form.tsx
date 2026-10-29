"use client";

import { Calculator, Info } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import type { CommissionMode, CommissionSource, SaleUnit } from "@/generated/prisma/enums";
import { computePoolCalculation, computeSavings } from "@/domain/commission";
import { DomainError } from "@/domain/errors";
import { centsToInput, formatARS, formatBps, parseARS } from "@/domain/money";
import { validatePoolDefinition } from "@/domain/pool-rules";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { parseLocalDateTimeAR } from "@/lib/dates";
import { COMMISSION_SOURCE_LABEL, formatInt, SALE_UNIT_LABEL } from "@/lib/labels";
import { formDataToObject, poolSchema, zodFieldErrors } from "@/lib/validation";
import { savePoolAction } from "@/server/actions/pools";
import { ZonePicker, type GeoProvince, type ZoneValue } from "@/components/forms/location-fields";
import { Alert } from "@/components/ui/display";
import { CheckboxField, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";

export interface PoolFormProduct {
  id: string;
  name: string;
  categoryId: string;
  saleUnit: SaleUnit;
  unitsPerPack: number;
  priceCents: number;
  retailPriceCents: number | null;
}

export interface PoolFormDefaults {
  poolId?: string;
  productId?: string;
  title?: string;
  description?: string | null;
  price?: string;
  retailPrice?: string;
  totalUnits?: number;
  minUnitsToClose?: number;
  minPerCommerce?: number;
  maxPerCommerce?: number;
  closeOnMinimum?: boolean;
  deadlineAt: string;
  estimatedDeliveryAt?: string;
  zones: ZoneValue[];
}

interface Props {
  products: PoolFormProduct[];
  commission: { mode: CommissionMode; byCategory: Record<string, { bps: number; source: CommissionSource }>; globalBps: number };
  geo: GeoProvince[];
  defaults: PoolFormDefaults;
  canPublish: boolean;
}

const toInt = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

export function PoolForm({ products, commission, geo, defaults, canPublish }: Props) {
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    // Validación inmediata con las mismas reglas que el servidor.
    const parsed = poolSchema.safeParse(formDataToObject(fd));
    if (!parsed.success) {
      setClientErrors(zodFieldErrors(parsed.error));
      return { ok: false, message: "Revisá los datos marcados." };
    }
    const biz = validatePoolDefinition(
      { ...parsed.data, unitPriceCents: parsed.data.price, retailUnitPriceCents: parsed.data.retailPrice },
      new Date(),
    );
    if (Object.keys(biz).length) {
      setClientErrors({ ...biz, retailPrice: biz.retailUnitPriceCents ?? "" });
      return { ok: false, message: "Revisá los datos marcados." };
    }
    setClientErrors({});
    return savePoolAction(prev, fd);
  }, initialActionState);
  const errors: Record<string, string> = { ...state.fields, ...clientErrors };
  if (errors.retailUnitPriceCents && !errors.retailPrice) errors.retailPrice = errors.retailUnitPriceCents;

  const [productId, setProductId] = useState(defaults.productId ?? "");
  const [title, setTitle] = useState(defaults.title ?? "");
  const [price, setPrice] = useState(defaults.price ?? "");
  const [retail, setRetail] = useState(defaults.retailPrice ?? "");
  const [total, setTotal] = useState(String(defaults.totalUnits ?? ""));
  const [min, setMin] = useState(String(defaults.minUnitsToClose ?? ""));
  const [minPer, setMinPer] = useState(String(defaults.minPerCommerce ?? "1"));
  const [maxPer, setMaxPer] = useState(String(defaults.maxPerCommerce ?? ""));
  const [deadline, setDeadline] = useState(defaults.deadlineAt);

  const product = products.find((p) => p.id === productId);
  const unit = SALE_UNIT_LABEL[product?.saleUnit ?? "UNIDAD"];
  const applicable = product ? commission.byCategory[product.categoryId] : undefined;
  const bps = applicable?.bps ?? commission.globalBps;
  const priceCents = parseARS(price);
  const retailCents = parseARS(retail);
  const sumMode = commission.mode === "SUMAR_AL_COMERCIO";

  const calc = useMemo(() => {
    if (!priceCents || priceCents <= 0) return null;
    try {
      return computePoolCalculation({
        inputCents: priceCents,
        bps,
        mode: commission.mode,
        totalUnits: toInt(total),
        minUnitsToClose: Math.min(toInt(min), toInt(total)),
      });
    } catch (e) {
      return e instanceof DomainError ? e.message : null;
    }
  }, [priceCents, bps, commission.mode, total, min]);

  function onProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (!title) setTitle(`${p.name}: pool por volumen`);
    if (!price) setPrice(centsToInput(p.priceCents));
    if (!retail && p.retailPriceCents) setRetail(centsToInput(p.retailPriceCents));
  }

  const savings = calc && typeof calc !== "string" && retailCents ? computeSavings(calc.pricing.unitPriceCents, retailCents) : null;
  const deadlineDate = parseLocalDateTimeAR(deadline);

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]" noValidate>
      {defaults.poolId ? <input type="hidden" name="poolId" value={defaults.poolId} /> : null}
      <div className="flex flex-col gap-6">
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-lg font-black">Producto y precio</h2>
          <SelectField
            label="Producto de tu catálogo"
            name="productId"
            required
            placeholder="Elegí un producto"
            value={productId}
            onChange={(e) => onProduct(e.target.value)}
            options={products.map((p) => ({ value: p.id, label: `${p.name}${p.saleUnit === "BULTO" ? ` (bulto x ${p.unitsPerPack})` : ""}` }))}
            error={errors.productId}
            hint={products.length === 0 ? "Primero cargá productos en tu catálogo." : undefined}
          />
          <TextField label="Título del pool" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} error={errors.title} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label={sumMode ? `Precio que querés cobrar por ${unit.one}` : `Precio por ${unit.one} (lo paga el comercio)`}
              name="price"
              required
              inputMode="decimal"
              placeholder="1.500,00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              error={errors.price}
            />
            <TextField
              label={`Precio minorista de referencia por ${unit.one}`}
              name="retailPrice"
              required
              inputMode="decimal"
              placeholder="1.999,00"
              value={retail}
              onChange={(e) => setRetail(e.target.value)}
              error={errors.retailPrice}
              hint="Se usa para mostrarle el ahorro al comercio."
            />
          </div>
          <TextAreaField label="Descripción (opcional)" name="description" defaultValue={defaults.description ?? ""} maxLength={3000} error={errors.description} />
        </section>

        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-lg font-black">Volumen</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label={`Total de ${unit.many} (ej. 1 pallet)`} name="totalUnits" type="number" min={1} required value={total} onChange={(e) => setTotal(e.target.value)} error={errors.totalUnits} />
            <TextField
              label="Mínimo para cerrar"
              name="minUnitsToClose"
              type="number"
              min={1}
              required
              value={min}
              onChange={(e) => setMin(e.target.value)}
              error={errors.minUnitsToClose}
              hint="Puede ser igual o menor al total."
            />
            <TextField label="Mínimo por comercio" name="minPerCommerce" type="number" min={1} required value={minPer} onChange={(e) => setMinPer(e.target.value)} error={errors.minPerCommerce} />
            <TextField label="Máximo por comercio" name="maxPerCommerce" type="number" min={1} required value={maxPer} onChange={(e) => setMaxPer(e.target.value)} error={errors.maxPerCommerce} />
          </div>
          <CheckboxField
            name="closeOnMinimum"
            label="Cerrar el pool apenas se llegue al mínimo"
            defaultChecked={defaults.closeOnMinimum ?? true}
            hint="Si lo desmarcás, el pool sigue sumando unidades hasta completar el total o hasta la fecha límite."
          />
        </section>

        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-lg font-black">Fechas y zona</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Fecha límite (hora argentina)"
              name="deadlineAt"
              type="datetime-local"
              required
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              error={errors.deadlineAt}
            />
            <TextField
              label="Entrega estimada"
              name="estimatedDeliveryAt"
              type="datetime-local"
              defaultValue={defaults.estimatedDeliveryAt}
              error={errors.estimatedDeliveryAt}
            />
          </div>
          <ZonePicker geo={geo} name="zones" defaultValue={defaults.zones} error={errors.zones} hint="Solo los comercios de estas zonas van a poder sumarse." />
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start" aria-label="Calculadora de comisión">
        <section className="card overflow-hidden" aria-live="polite">
          <h2 className="flex items-center gap-2 border-b-2 border-ink bg-brand px-4 py-3 text-lg font-black">
            <Calculator aria-hidden="true" className="h-5 w-5" /> Calculadora en vivo
          </h2>
          <div className="flex flex-col gap-3 p-4">
            {!product ? (
              <p className="text-muted">Elegí un producto para ver la comisión aplicable.</p>
            ) : (
              <p className="text-sm">
                Comisión PEDILA: <b>{formatBps(bps)}</b> ({COMMISSION_SOURCE_LABEL[applicable?.source ?? "GLOBAL"]}).
                {sumMode ? " Se suma al precio que ve el comercio." : " Se descuenta de tu precio."}
              </p>
            )}
            {typeof calc === "string" ? (
              <Alert tone="error">{calc}</Alert>
            ) : calc ? (
              <dl className="flex flex-col gap-2 text-sm">
                <Row label={`Precio para el comercio por ${unit.one}`} value={formatARS(calc.pricing.unitPriceCents)} strong />
                <Row label={`Comisión por ${unit.one}`} value={formatARS(calc.pricing.commissionUnitCents)} />
                <Row label={`Tu neto por ${unit.one}`} value={formatARS(calc.pricing.netUnitCents)} />
                <div className="my-1 border-t-2 border-ink" />
                <Row label={`Total del pool (${formatInt(toInt(total))} ${unit.many})`} value={formatARS(calc.full.totalCents)} strong />
                <Row label="Comisión PEDILA" value={formatARS(calc.full.commissionCents)} />
                <div className="rounded-xl border-2 border-ink bg-brand-soft p-3">
                  <Row label="Neto que vas a recibir" value={formatARS(calc.full.netCents)} strong big />
                  {toInt(min) > 0 && toInt(min) < toInt(total) ? (
                    <p className="mt-1 text-xs">
                      Si cierra con el mínimo ({formatInt(toInt(min))} {unit.many}): {formatARS(calc.minimum.netCents)}
                    </p>
                  ) : null}
                </div>
                {savings && savings.savingBps > 0 ? (
                  <p className="text-xs">El comercio ahorra {formatARS(savings.savingUnitCents)} por {unit.one} ({Math.floor(savings.savingBps / 100)} %).</p>
                ) : null}
              </dl>
            ) : (
              <p className="text-muted">Cargá el precio para ver el cálculo.</p>
            )}
            <p className="flex items-start gap-2 text-xs text-muted">
              <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              El porcentaje se congela al publicar: si después cambia la configuración, este pool mantiene el suyo. Redondeo al centavo por {unit.one}.
            </p>
            {deadlineDate ? null : <p className="text-xs text-muted">Elegí la fecha límite.</p>}
          </div>
        </section>
        <FormMessage state={state} />
        <div className="flex flex-col gap-2">
          <SubmitButton name="intent" value="publicar" size="lg" className="w-full" pendingText="Guardando…" disabled={!canPublish}>
            Publicar pool
          </SubmitButton>
          <SubmitButton name="intent" value="guardar" variant="secondary" className="w-full" pendingText="Guardando…">
            Guardar borrador
          </SubmitButton>
          {!canPublish ? <p className="text-sm">Podés guardar borradores; vas a poder publicar cuando PEDILA apruebe tu cuenta.</p> : null}
        </div>
      </aside>
    </form>
  );
}

function Row({ label, value, strong, big }: { label: string; value: string; strong?: boolean; big?: boolean }) {
  return (
    <div className={big ? "flex flex-col" : "flex items-baseline justify-between gap-3"}>
      <dt className={big ? "font-bold" : undefined}>{label}</dt>
      <dd className={`whitespace-nowrap tabular-nums ${strong ? "font-black" : "font-semibold"} ${big ? "text-2xl" : ""}`}>{value}</dd>
    </div>
  );
}
