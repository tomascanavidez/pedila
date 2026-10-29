import { describe, expect, it } from "vitest";
import {
  applyBps,
  centsToInput,
  divRoundHalfUp,
  formatARS,
  formatBps,
  multiplyCents,
  parseARS,
  parsePercentToBps,
  toCents,
} from "@/domain/money";

describe("formatARS", () => {
  it("usa el formato argentino $ 12.345,67", () => {
    expect(formatARS(1_234_567)).toBe("$ 12.345,67");
    expect(formatARS(0)).toBe("$ 0,00");
    expect(formatARS(5)).toBe("$ 0,05");
    expect(formatARS(100)).toBe("$ 1,00");
    expect(formatARS(123_456_789_012)).toBe("$ 1.234.567.890,12");
  });

  it("muestra negativos con signo", () => {
    expect(formatARS(-150)).toBe("-$ 1,50");
  });

  it("sin decimales redondea half-up", () => {
    expect(formatARS(1_234_550, { decimals: false })).toBe("$ 12.346");
    expect(formatARS(1_234_549, { decimals: false })).toBe("$ 12.345");
  });

  it("rechaza montos no enteros", () => {
    expect(() => formatARS(10.5)).toThrow();
  });
});

describe("parseARS", () => {
  it.each([
    ["1234", 123_400],
    ["1234,5", 123_450],
    ["1.234,56", 123_456],
    ["1234.56", 123_456],
    ["$ 1.234,56", 123_456],
    ["12.345", 1_234_500],
    ["0,01", 1],
    ["  850  ", 85_000],
  ])("interpreta %s", (input, expected) => {
    expect(parseARS(input)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3", "12,345", "1.5.6,7", "-10", "1,234"])("rechaza %s", (input) => {
    // "1,234" tiene 3 decimales → inválido (la coma es decimal en formato AR)
    expect(parseARS(input)).toBeNull();
  });
});

describe("centsToInput", () => {
  it("formatea para inputs editables", () => {
    expect(centsToInput(123_400)).toBe("1234");
    expect(centsToInput(123_405)).toBe("1234,05");
  });
});

describe("redondeo", () => {
  it("divRoundHalfUp redondea la mitad hacia arriba", () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1n); // 0,5 → 1
    expect(divRoundHalfUp(4n, 10n)).toBe(0n); // 0,4 → 0
    expect(divRoundHalfUp(15n, 10n)).toBe(2n); // 1,5 → 2
    expect(divRoundHalfUp(25n, 10n)).toBe(3n); // 2,5 → 3 (no es redondeo bancario)
    expect(divRoundHalfUp(0n, 7n)).toBe(0n);
  });

  it("applyBps aplica puntos básicos con half-up", () => {
    expect(applyBps(10_000, 800)).toBe(800); // 8 % de $100
    expect(applyBps(12_345, 850)).toBe(1_049); // 1049,325 → 1049
    expect(applyBps(150, 1_000)).toBe(15);
    expect(applyBps(5, 1_000)).toBe(1); // 0,5 → 1
    expect(applyBps(4, 1_000)).toBe(0); // 0,4 → 0
    expect(applyBps(999_999_999_999, 250)).toBe(25_000_000_000); // 24.999.999.999,975 → 25.000.000.000
  });

  it("multiplyCents controla el rango", () => {
    expect(multiplyCents(150_000, 600)).toBe(90_000_000);
    expect(() => multiplyCents(Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });

  it("toCents convierte BigInt de la base", () => {
    expect(toCents(123n)).toBe(123);
    expect(toCents(null)).toBe(0);
    expect(() => toCents(2n ** 60n)).toThrow();
  });
});

describe("porcentajes", () => {
  it("formatBps", () => {
    expect(formatBps(800)).toBe("8 %");
    expect(formatBps(850)).toBe("8,5 %");
    expect(formatBps(825)).toBe("8,25 %");
    expect(formatBps(5)).toBe("0,05 %");
  });

  it("parsePercentToBps", () => {
    expect(parsePercentToBps("8")).toBe(800);
    expect(parsePercentToBps("8,5")).toBe(850);
    expect(parsePercentToBps("8.25")).toBe(825);
    expect(parsePercentToBps("8,5 %")).toBe(850);
    expect(parsePercentToBps("8,555")).toBeNull();
    expect(parsePercentToBps("abc")).toBeNull();
  });
});
