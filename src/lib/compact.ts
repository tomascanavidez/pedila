/** Formatos compactos para ejes y tooltips: "$ 1,2 M", "$ 350 mil", "12". */
export function compactARS(cents: number): string {
  const pesos = cents / 100;
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");
  if (Math.abs(pesos) >= 1_000_000) return `$ ${fmt(pesos / 1_000_000)} M`;
  if (Math.abs(pesos) >= 1_000) return `$ ${fmt(pesos / 1_000)} mil`;
  return `$ ${Math.round(pesos)}`;
}

export function compactInt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toString().replace(".", ",")} M`;
  if (Math.abs(n) >= 1_000) return `${(Math.round(n / 100) / 10).toString().replace(".", ",")} mil`;
  return String(Math.round(n));
}
