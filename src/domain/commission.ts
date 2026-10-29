/**
 * Cálculo de comisiones PEDILA
 * ============================
 *
 * Resolución del porcentaje (prioridad): PREVENTISTA > CATEGORÍA > GLOBAL.
 *
 * Modos de cobro:
 *  (a) DESCONTAR_AL_PREVENTISTA (por defecto): el preventista carga el precio que
 *      paga el comercio (P). PEDILA descuenta su comisión:  c = round(P × %),  neto = P − c.
 *  (b) SUMAR_AL_COMERCIO: el preventista carga lo que quiere cobrar (N). PEDILA suma
 *      su comisión al precio que ve el comercio:  c = round(N × %),  precio = N + c.
 *
 * Regla de redondeo: la comisión se calcula POR UNIDAD, al centavo, con redondeo
 * "mitad hacia arriba" (ver money.ts). Los totales se obtienen multiplicando los
 * valores unitarios por la cantidad. Así el neto que el preventista ve al publicar
 * coincide exactamente con lo que cobra, sin diferencias de centavos entre la suma
 * de las participaciones y el total del pallet.
 */
import type { CommissionMode, CommissionSource } from "@/generated/prisma/enums";
import { DomainError } from "./errors";
import { applyBps, assertCents, multiplyCents, type Cents } from "./money";

export const MAX_COMMISSION_BPS = 5_000; // 50 %: tope de seguridad para evitar errores de carga.

export interface CommissionInputs {
  globalBps: number;
  categoryBps?: number | null;
  distributorBps?: number | null;
}

export interface ResolvedCommission {
  bps: number;
  source: CommissionSource;
}

export function assertValidBps(bps: number): number {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_COMMISSION_BPS) {
    throw new DomainError(
      "COMISION_INVALIDA",
      `La comisión debe estar entre 0 % y ${MAX_COMMISSION_BPS / 100} %, con hasta 2 decimales.`,
    );
  }
  return bps;
}

/** Prioridad: preventista > categoría > global. */
export function resolveCommission(inputs: CommissionInputs): ResolvedCommission {
  if (inputs.distributorBps !== null && inputs.distributorBps !== undefined) {
    return { bps: assertValidBps(inputs.distributorBps), source: "PREVENTISTA" };
  }
  if (inputs.categoryBps !== null && inputs.categoryBps !== undefined) {
    return { bps: assertValidBps(inputs.categoryBps), source: "CATEGORIA" };
  }
  return { bps: assertValidBps(inputs.globalBps), source: "GLOBAL" };
}

export interface UnitPricing {
  /** Lo que cargó el preventista. */
  inputCents: Cents;
  /** Lo que paga el comercio por unidad. */
  unitPriceCents: Cents;
  /** Comisión PEDILA por unidad. */
  commissionUnitCents: Cents;
  /** Lo que recibe el preventista por unidad. */
  netUnitCents: Cents;
  bps: number;
  mode: CommissionMode;
}

export function computeUnitPricing(inputCents: Cents, bps: number, mode: CommissionMode): UnitPricing {
  assertCents(inputCents, "precio");
  assertValidBps(bps);
  if (inputCents <= 0) throw new DomainError("PRECIO_INVALIDO", "El precio tiene que ser mayor a cero.");
  const commissionUnitCents = applyBps(inputCents, bps);
  if (mode === "DESCONTAR_AL_PREVENTISTA") {
    const netUnitCents = inputCents - commissionUnitCents;
    if (netUnitCents <= 0) {
      throw new DomainError("PRECIO_INVALIDO", "El precio es demasiado bajo para cubrir la comisión.");
    }
    return { inputCents, unitPriceCents: inputCents, commissionUnitCents, netUnitCents, bps, mode };
  }
  return {
    inputCents,
    unitPriceCents: inputCents + commissionUnitCents,
    commissionUnitCents,
    netUnitCents: inputCents,
    bps,
    mode,
  };
}

export interface LineAmounts {
  quantity: number;
  totalCents: Cents;
  commissionCents: Cents;
  netCents: Cents;
}

export function computeLine(
  pricing: Pick<UnitPricing, "unitPriceCents" | "commissionUnitCents" | "netUnitCents">,
  quantity: number,
): LineAmounts {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new DomainError("CANTIDAD_INVALIDA", "La cantidad tiene que ser un número entero.");
  }
  const totalCents = multiplyCents(pricing.unitPriceCents, quantity);
  const commissionCents = multiplyCents(pricing.commissionUnitCents, quantity);
  const netCents = multiplyCents(pricing.netUnitCents, quantity);
  // Invariante: total = comisión + neto (se verifica para detectar cualquier regresión).
  if (totalCents !== commissionCents + netCents) {
    throw new Error("Invariante de comisión rota: total ≠ comisión + neto");
  }
  return { quantity, totalCents, commissionCents, netCents };
}

export interface PoolCalculation {
  pricing: UnitPricing;
  /** Si se vende el total de unidades (por ejemplo, el pallet completo). */
  full: LineAmounts;
  /** Si se cierra con el mínimo. */
  minimum: LineAmounts;
}

/** Lo que muestra la calculadora en vivo al cargar un pool. */
export function computePoolCalculation(params: {
  inputCents: Cents;
  bps: number;
  mode: CommissionMode;
  totalUnits: number;
  minUnitsToClose: number;
}): PoolCalculation {
  const pricing = computeUnitPricing(params.inputCents, params.bps, params.mode);
  return {
    pricing,
    full: computeLine(pricing, params.totalUnits),
    minimum: computeLine(pricing, params.minUnitsToClose),
  };
}

export interface Savings {
  savingUnitCents: Cents;
  /** Ahorro en puntos básicos respecto del precio minorista (redondeo hacia abajo, para no exagerar). */
  savingBps: number;
}

export function computeSavings(unitPriceCents: Cents, retailUnitPriceCents: Cents): Savings {
  if (retailUnitPriceCents <= 0 || unitPriceCents >= retailUnitPriceCents) {
    return { savingUnitCents: 0, savingBps: 0 };
  }
  const savingUnitCents = retailUnitPriceCents - unitPriceCents;
  const savingBps = Number((BigInt(savingUnitCents) * 10_000n) / BigInt(retailUnitPriceCents));
  return { savingUnitCents, savingBps };
}

/** Porcentaje de ahorro entero para badges ("-23 %"). */
export function savingPercentLabel(s: Savings): string {
  return `${Math.floor(s.savingBps / 100)} %`;
}
