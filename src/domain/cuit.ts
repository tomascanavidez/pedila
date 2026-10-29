/**
 * Validación de CUIT/CUIL argentino (11 dígitos con dígito verificador módulo 11).
 * Acepta "20-12345678-9", "20 12345678 9" o "20123456789".
 */
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;
const VALID_PREFIXES = new Set(["20", "23", "24", "25", "26", "27", "30", "33", "34"]);

export function normalizeCuit(input: string): string {
  return input.replace(/[\s.-]/g, "");
}

export function cuitCheckDigit(first10: string): number | null {
  if (!/^\d{10}$/.test(first10)) return null;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first10[i]), 0);
  const mod = 11 - (sum % 11);
  if (mod === 11) return 0;
  if (mod === 10) return null; // combinación que AFIP no emite con ese prefijo
  return mod;
}

export function isValidCuit(input: string): boolean {
  const cuit = normalizeCuit(input);
  if (!/^\d{11}$/.test(cuit)) return false;
  if (!VALID_PREFIXES.has(cuit.slice(0, 2))) return false;
  const expected = cuitCheckDigit(cuit.slice(0, 10));
  return expected !== null && expected === Number(cuit[10]);
}

export function formatCuit(cuit: string): string {
  const c = normalizeCuit(cuit);
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : cuit;
}
