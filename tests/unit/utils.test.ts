import { describe, expect, it } from "vitest";
import { cuitCheckDigit, formatCuit, isValidCuit } from "@/domain/cuit";
import { isInZone, normalizeZones } from "@/domain/zones";
import { csvToObjects, parseCSV, toCSV } from "@/lib/csv";
import {
  dayKeyAR,
  formatCountdown,
  formatDateAR,
  formatDateTimeAR,
  monthKeyAR,
  parseLocalDateTimeAR,
  toLocalInputAR,
  weekKeyAR,
} from "@/lib/dates";
import { MemoryRateLimiter } from "@/lib/rate-limit";

describe("CUIT", () => {
  it("valida el dígito verificador", () => {
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(isValidCuit("20123456786")).toBe(true);
    expect(isValidCuit("30-71234567-1")).toBe(true);
    expect(isValidCuit("20-12345678-9")).toBe(false);
    expect(isValidCuit("99-12345678-6")).toBe(false);
    expect(isValidCuit("123")).toBe(false);
  });
  it("calcula y formatea", () => {
    expect(cuitCheckDigit("2012345678")).toBe(6);
    expect(formatCuit("20123456786")).toBe("20-12345678-6");
  });
});

describe("zonas", () => {
  const zones = [
    { provinceId: 2, localityId: null },
    { provinceId: 6, localityId: 10 },
  ];
  it("una zona sin localidad cubre toda la provincia", () => {
    expect(isInZone(zones, { provinceId: 2, localityId: 99 })).toBe(true);
  });
  it("una zona con localidad cubre solo esa localidad", () => {
    expect(isInZone(zones, { provinceId: 6, localityId: 10 })).toBe(true);
    expect(isInZone(zones, { provinceId: 6, localityId: 11 })).toBe(false);
    expect(isInZone(zones, { provinceId: 14, localityId: 10 })).toBe(false);
  });
  it("normaliza duplicados y localidades redundantes", () => {
    expect(
      normalizeZones([
        { provinceId: 2, localityId: null },
        { provinceId: 2, localityId: 5 },
        { provinceId: 6, localityId: 10 },
        { provinceId: 6, localityId: 10 },
      ]),
    ).toEqual([
      { provinceId: 2, localityId: null },
      { provinceId: 6, localityId: 10 },
    ]);
  });
});

describe("CSV", () => {
  it("exporta con ; y BOM, escapando comillas y separadores", () => {
    const out = toCSV([
      ["nombre", "monto"],
      ['Kiosco "El Sol"', "1.234,56"],
      ["a;b", 3],
    ]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain('"Kiosco ""El Sol"""');
    expect(out).toContain('"a;b";3');
  });

  it("neutraliza fórmulas (inyección CSV)", () => {
    const out = toCSV([["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(A1)", "normal"]], { bom: false });
    expect(out).toContain("'=HYPERLINK");
    expect(out).toContain("'+1");
    expect(out).toContain("'@SUM");
  });

  it("importa con comillas, saltos de línea y separador autodetectado", () => {
    const rows = parseCSV('sku;nombre;precio\r\nA1;"Alfajor; triple";1.234,50\r\nA2;"Línea\nnueva";10\r\n\r\n');
    expect(rows).toEqual([
      ["sku", "nombre", "precio"],
      ["A1", "Alfajor; triple", "1.234,50"],
      ["A2", "Línea\nnueva", "10"],
    ]);
    expect(parseCSV('a,b\n1,"x ""y"""')).toEqual([
      ["a", "b"],
      ["1", 'x "y"'],
    ]);
  });

  it("convierte a objetos normalizando encabezados", () => {
    const { records } = csvToObjects("SKU,Nombre,Unidades por bulto\nA1,Yerba,10");
    expect(records[0]).toEqual({ sku: "A1", nombre: "Yerba", unidades_por_bulto: "10" });
  });
});

describe("fechas en hora argentina", () => {
  const d = new Date("2026-10-23T02:30:00Z"); // 22/10 23:30 en Argentina (UTC-3)
  it("formatea en America/Argentina/Buenos_Aires", () => {
    expect(formatDateAR(d)).toBe("22/10/2026");
    expect(formatDateTimeAR(d)).toBe("22/10/2026 23:30");
    expect(dayKeyAR(d)).toBe("2026-10-22");
    expect(monthKeyAR(d)).toBe("2026-10");
  });
  it("interpreta inputs datetime-local como hora argentina", () => {
    expect(parseLocalDateTimeAR("2026-10-22T23:30")?.toISOString()).toBe("2026-10-23T02:30:00.000Z");
    expect(parseLocalDateTimeAR("2026-10-22")?.toISOString()).toBe("2026-10-22T03:00:00.000Z");
    expect(parseLocalDateTimeAR("2026-02-30")).toBeNull();
    expect(parseLocalDateTimeAR("cualquier cosa")).toBeNull();
    expect(toLocalInputAR(d)).toBe("2026-10-22T23:30");
  });
  it("calcula la semana (lunes) en hora argentina", () => {
    expect(weekKeyAR(new Date("2026-10-23T15:00:00Z"))).toBe("2026-10-19"); // viernes → lunes 19
    expect(weekKeyAR(new Date("2026-10-19T02:00:00Z"))).toBe("2026-10-12"); // domingo 18 a la noche en AR
  });
  it("arma la cuenta regresiva", () => {
    expect(formatCountdown(0)).toBe("cerrado");
    expect(formatCountdown(30_000)).toBe("menos de 1 min");
    expect(formatCountdown(12 * 60_000)).toBe("12 min");
    expect(formatCountdown((3 * 60 + 15) * 60_000)).toBe("3 h 15 min");
    expect(formatCountdown((2 * 24 + 4) * 3_600_000)).toBe("2 d 4 h");
  });
});

describe("rate limit en memoria", () => {
  it("bloquea al superar el límite y libera al terminar la ventana", () => {
    let t = 1_000;
    const rl = new MemoryRateLimiter(() => t);
    expect(rl.hit("ip", 2, 1_000).ok).toBe(true);
    expect(rl.hit("ip", 2, 1_000).ok).toBe(true);
    const blocked = rl.hit("ip", 2, 1_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(1_000);
    t += 1_001;
    expect(rl.hit("ip", 2, 1_000).ok).toBe(true);
  });
  it("las claves son independientes", () => {
    const rl = new MemoryRateLimiter(() => 0);
    rl.hit("a", 1, 1_000);
    expect(rl.hit("a", 1, 1_000).ok).toBe(false);
    expect(rl.hit("b", 1, 1_000).ok).toBe(true);
  });
});
