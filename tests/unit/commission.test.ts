import { describe, expect, it } from "vitest";
import {
  computeLine,
  computePoolCalculation,
  computeSavings,
  computeUnitPricing,
  resolveCommission,
  savingPercentLabel,
} from "@/domain/commission";
import { DomainError } from "@/domain/errors";

describe("resolveCommission: prioridad preventista > categoría > global", () => {
  it("usa la global si no hay overrides", () => {
    expect(resolveCommission({ globalBps: 800 })).toEqual({ bps: 800, source: "GLOBAL" });
    expect(resolveCommission({ globalBps: 800, categoryBps: null, distributorBps: null })).toEqual({
      bps: 800,
      source: "GLOBAL",
    });
  });

  it("la categoría pisa a la global", () => {
    expect(resolveCommission({ globalBps: 800, categoryBps: 600 })).toEqual({ bps: 600, source: "CATEGORIA" });
  });

  it("el preventista pisa a la categoría y a la global", () => {
    expect(resolveCommission({ globalBps: 800, categoryBps: 600, distributorBps: 750 })).toEqual({
      bps: 750,
      source: "PREVENTISTA",
    });
  });

  it("un override en 0 % es válido y se respeta", () => {
    expect(resolveCommission({ globalBps: 800, categoryBps: 0 })).toEqual({ bps: 0, source: "CATEGORIA" });
    expect(resolveCommission({ globalBps: 800, categoryBps: 600, distributorBps: 0 })).toEqual({
      bps: 0,
      source: "PREVENTISTA",
    });
  });

  it("rechaza porcentajes fuera de rango", () => {
    expect(() => resolveCommission({ globalBps: -1 })).toThrow(DomainError);
    expect(() => resolveCommission({ globalBps: 5_001 })).toThrow(DomainError);
    expect(() => resolveCommission({ globalBps: 8.5 })).toThrow(DomainError);
  });
});

describe("computeUnitPricing", () => {
  it("modo (a) descuenta la comisión del precio del preventista", () => {
    const p = computeUnitPricing(150_000, 800, "DESCONTAR_AL_PREVENTISTA");
    expect(p.unitPriceCents).toBe(150_000); // el comercio paga lo que cargó el preventista
    expect(p.commissionUnitCents).toBe(12_000);
    expect(p.netUnitCents).toBe(138_000);
  });

  it("modo (b) suma la comisión al precio que ve el comercio", () => {
    const p = computeUnitPricing(150_000, 800, "SUMAR_AL_COMERCIO");
    expect(p.unitPriceCents).toBe(162_000);
    expect(p.commissionUnitCents).toBe(12_000);
    expect(p.netUnitCents).toBe(150_000); // el preventista recibe lo que cargó
  });

  it("redondea la comisión por unidad half-up", () => {
    // $ 123,45 al 8,5 % = 10,49325 → $ 10,49
    expect(computeUnitPricing(12_345, 850, "DESCONTAR_AL_PREVENTISTA").commissionUnitCents).toBe(1_049);
    // $ 1,50 al 10 % = 0,15 exacto
    expect(computeUnitPricing(150, 1_000, "DESCONTAR_AL_PREVENTISTA").commissionUnitCents).toBe(15);
    // $ 0,05 al 10 % = 0,005 → 0,01 (mitad hacia arriba)
    expect(computeUnitPricing(5, 1_000, "SUMAR_AL_COMERCIO").commissionUnitCents).toBe(1);
  });

  it("con 0 % el neto es igual al precio", () => {
    const p = computeUnitPricing(99_999, 0, "DESCONTAR_AL_PREVENTISTA");
    expect(p.commissionUnitCents).toBe(0);
    expect(p.netUnitCents).toBe(99_999);
  });

  it("rechaza precios no positivos o que no cubren la comisión", () => {
    expect(() => computeUnitPricing(0, 800, "DESCONTAR_AL_PREVENTISTA")).toThrow(DomainError);
    expect(() => computeUnitPricing(1, 5_000, "DESCONTAR_AL_PREVENTISTA")).toThrow(DomainError); // 0,5 → 1 → neto 0
  });
});

describe("computeLine y computePoolCalculation", () => {
  it("ejemplo del README: pallet de 600 u. a $ 1.500 con 8 %", () => {
    const calc = computePoolCalculation({
      inputCents: 150_000,
      bps: 800,
      mode: "DESCONTAR_AL_PREVENTISTA",
      totalUnits: 600,
      minUnitsToClose: 480,
    });
    expect(calc.full.totalCents).toBe(90_000_000); // $ 900.000
    expect(calc.full.commissionCents).toBe(7_200_000); // $ 72.000
    expect(calc.full.netCents).toBe(82_800_000); // $ 828.000
    expect(calc.minimum.totalCents).toBe(72_000_000);
    expect(calc.minimum.netCents).toBe(66_240_000);
  });

  it("la suma de participaciones coincide exactamente con el total del pallet", () => {
    const pricing = computeUnitPricing(12_345, 850, "DESCONTAR_AL_PREVENTISTA");
    const quantities = [10, 7, 33, 1, 49, 100];
    const lines = quantities.map((q) => computeLine(pricing, q));
    const total = computeLine(pricing, quantities.reduce((a, b) => a + b, 0));
    expect(lines.reduce((a, l) => a + l.commissionCents, 0)).toBe(total.commissionCents);
    expect(lines.reduce((a, l) => a + l.netCents, 0)).toBe(total.netCents);
    expect(lines.reduce((a, l) => a + l.totalCents, 0)).toBe(total.totalCents);
  });

  it("mantiene la invariante total = comisión + neto en muchos casos", () => {
    for (let price = 1_001; price < 500_000; price += 7_919) {
      for (const bps of [0, 1, 99, 250, 800, 850, 1_234, 5_000]) {
        for (const mode of ["DESCONTAR_AL_PREVENTISTA", "SUMAR_AL_COMERCIO"] as const) {
          const line = computeLine(computeUnitPricing(price, bps, mode), 37);
          expect(line.totalCents).toBe(line.commissionCents + line.netCents);
        }
      }
    }
  });

  it("rechaza cantidades no enteras", () => {
    const pricing = computeUnitPricing(1_000, 800, "DESCONTAR_AL_PREVENTISTA");
    expect(() => computeLine(pricing, 1.5)).toThrow(DomainError);
    expect(() => computeLine(pricing, -1)).toThrow(DomainError);
  });
});

describe("computeSavings", () => {
  it("calcula el ahorro respecto del minorista (redondeo hacia abajo)", () => {
    const s = computeSavings(150_000, 199_900);
    expect(s.savingUnitCents).toBe(49_900);
    expect(s.savingBps).toBe(2_496); // 24,96 %
    expect(savingPercentLabel(s)).toBe("24 %");
  });

  it("sin ahorro si el minorista no es mayor", () => {
    expect(computeSavings(1_000, 1_000)).toEqual({ savingUnitCents: 0, savingBps: 0 });
    expect(computeSavings(1_000, 0)).toEqual({ savingUnitCents: 0, savingBps: 0 });
  });
});
