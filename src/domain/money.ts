/**
 * Dinero en PEDILA
 * ================
 * - Todos los montos se representan como ENTEROS en centavos (tipo `Cents`).
 * - En la base se guardan como BIGINT; en la lógica se usan `number` enteros, que son
 *   exactos hasta 2^53 (≈ $ 90 billones), muy por encima de cualquier monto real.
 * - Ninguna operación usa floats sobre pesos. Las divisiones se hacen con BigInt y
 *   una regla de redondeo explícita.
 *
 * Regla de redondeo (única en todo el sistema): "mitad hacia arriba" (half-up) al
 * centavo, para montos no negativos. Ejemplo: 12,5 centavos → 13; 12,4999 → 12.
 */

export type Cents = number;

export const MAX_CENTS = Number.MAX_SAFE_INTEGER;

export function assertCents(value: number, label = "monto"): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} debe ser un entero de centavos (recibido: ${value})`);
  }
  return value;
}

/** Convierte un valor leído de la base (BigInt) o un number a centavos seguros. */
export function toCents(value: bigint | number | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  if (typeof value === "bigint") {
    if (value > BigInt(MAX_CENTS) || value < -BigInt(MAX_CENTS)) {
      throw new RangeError("Monto fuera de rango seguro");
    }
    return Number(value);
  }
  return assertCents(value);
}

/**
 * División entera con redondeo half-up: round(numerator / denominator).
 * Solo para numerador >= 0 y denominador > 0 (los montos de PEDILA nunca son negativos).
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("El denominador debe ser positivo");
  if (numerator < 0n) throw new RangeError("El numerador no puede ser negativo");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Aplica un porcentaje en puntos básicos (1 % = 100 bps) con redondeo half-up. */
export function applyBps(amount: Cents, bps: number): Cents {
  assertCents(amount);
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError("bps inválido");
  return Number(divRoundHalfUp(BigInt(amount) * BigInt(bps), 10_000n));
}

export function multiplyCents(unit: Cents, quantity: number): Cents {
  assertCents(unit);
  if (!Number.isInteger(quantity) || quantity < 0) throw new RangeError("Cantidad inválida");
  const result = BigInt(unit) * BigInt(quantity);
  if (result > BigInt(MAX_CENTS)) throw new RangeError("Monto fuera de rango seguro");
  return Number(result);
}

export function sumCents(values: readonly Cents[]): Cents {
  return assertCents(values.reduce((acc, v) => acc + v, 0));
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Formato de moneda argentino: `$ 12.345,67`.
 * Se implementa a mano (sin Intl) para que el servidor y el navegador muestren
 * exactamente el mismo texto y no haya diferencias de hidratación.
 */
export function formatARS(cents: Cents, opts: { decimals?: boolean } = {}): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const pesos = Math.floor(abs / 100);
  const cent = abs % 100;
  const showDecimals = opts.decimals ?? true;
  const body = showDecimals
    ? `${groupThousands(String(pesos))},${String(cent).padStart(2, "0")}`
    : groupThousands(String(cent >= 50 ? pesos + 1 : pesos));
  return `${negative ? "-" : ""}$ ${body}`;
}

/**
 * Interpreta un precio ingresado por una persona y lo convierte a centavos.
 * Acepta: "1234", "1234,5", "1.234,56", "1234.56", "$ 1.234,56".
 * Regla: si hay coma, la coma es el separador decimal y los puntos son de miles
 * (formato argentino). Si no hay coma y hay un único punto seguido de 1 o 2 dígitos,
 * ese punto es decimal. Devuelve null si el texto no es un monto válido.
 */
export function parseARS(input: string): Cents | null {
  let s = input.trim().replace(/^\$\s*/, "").replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) {
    const [intRaw = "", ...rest] = s.split(",");
    if (rest.length !== 1) return null;
    // La parte entera puede venir sin separadores o agrupada de a 3 con puntos.
    if (!/^\d+$/.test(intRaw) && !/^\d{1,3}(\.\d{3})+$/.test(intRaw)) return null;
    s = `${intRaw.replace(/\./g, "")}.${rest[0]}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ""] = s.split(".");
  const cents = BigInt(intPart ?? "0") * 100n + BigInt(decPart.padEnd(2, "0") || "0");
  if (cents > BigInt(MAX_CENTS)) return null;
  return Number(cents);
}

/** Centavos → texto editable en un input ("1234,56"). */
export function centsToInput(cents: Cents): string {
  const pesos = Math.floor(cents / 100);
  const cent = cents % 100;
  return cent === 0 ? String(pesos) : `${pesos},${String(cent).padStart(2, "0")}`;
}

/** Puntos básicos → texto de porcentaje argentino ("8,5 %"). */
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole} %`;
  const fracStr = String(frac).padStart(2, "0").replace(/0$/, "");
  return `${whole},${fracStr} %`;
}

/** "8,5" | "8.5" | "8" → 850 bps. Hasta 2 decimales. Devuelve null si es inválido. */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim().replace("%", "").trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [i, d = ""] = s.split(".");
  return Number(i) * 100 + Number(d.padEnd(2, "0"));
}
