/**
 * Fechas en zona horaria de Argentina.
 * La base guarda UTC; todo lo que se muestra o se carga en formularios usa
 * America/Argentina/Buenos_Aires. El formato se arma a mano a partir de
 * formatToParts para que servidor y navegador generen el mismo texto.
 */
export const AR_TZ = "America/Argentina/Buenos_Aires";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AR_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function arParts(date: Date): Parts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAYS[map.weekday ?? "Sun"] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Desfase de Argentina respecto de UTC en minutos para ese instante (hoy: -180). */
export function arOffsetMinutes(date: Date): number {
  const p = arParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** "23/10/2026" */
export function formatDateAR(date: Date): string {
  const p = arParts(date);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** "23/10/2026 18:30" */
export function formatDateTimeAR(date: Date): string {
  const p = arParts(date);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "jueves 23 de octubre, 18:30 h" */
export function formatLongDateTimeAR(date: Date): string {
  const p = arParts(date);
  return `${DAY_NAMES[p.weekday]} ${p.day} de ${MONTH_NAMES[p.month - 1]}, ${pad(p.hour)}:${pad(p.minute)} h`;
}

export function monthNameAR(month1to12: number): string {
  return MONTH_NAMES[month1to12 - 1] ?? "";
}

/** Valor para <input type="datetime-local"> en hora argentina: "2026-10-23T18:30". */
export function toLocalInputAR(date: Date): string {
  const p = arParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Valor para <input type="date">: "2026-10-23". */
export function toDateInputAR(date: Date): string {
  return dayKeyAR(date);
}

/** Interpreta "2026-10-23T18:30" (o "2026-10-23") como hora argentina y devuelve el instante UTC. */
export function parseLocalDateTimeAR(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(naive)) return null;
  // Primera aproximación con el offset en ese instante; se corrige una vez por si
  // la zona tuviera horario de verano (Argentina hoy no lo usa).
  let offset = arOffsetMinutes(new Date(naive));
  let result = new Date(naive - offset * 60_000);
  offset = arOffsetMinutes(result);
  result = new Date(naive - offset * 60_000);
  const check = arParts(result);
  if (check.year !== Number(y) || check.month !== Number(mo) || check.day !== Number(d)) return null;
  return result;
}

/** Clave de día en hora argentina: "2026-10-23". */
export function dayKeyAR(date: Date): string {
  const p = arParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Clave de mes: "2026-10". */
export function monthKeyAR(date: Date): string {
  const p = arParts(date);
  return `${p.year}-${pad(p.month)}`;
}

/** Clave de semana: fecha (AR) del lunes de esa semana, "2026-10-19". */
export function weekKeyAR(date: Date): string {
  const p = arParts(date);
  const daysSinceMonday = (p.weekday + 6) % 7;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - daysSinceMonday));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** Inicio del día (00:00 hora argentina) como instante UTC. */
export function startOfDayAR(date: Date): Date {
  return parseLocalDateTimeAR(dayKeyAR(date)) ?? date;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Texto de cuenta regresiva: "2 d 4 h", "3 h 15 min", "12 min", "menos de 1 min". */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "cerrado";
  const totalMin = Math.floor(msLeft / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return "menos de 1 min";
}

/** ¿La fecha ya pasó? (para decidir qué mostrar en páginas renderizadas por pedido). */
export function isPast(date: Date): boolean {
  return date.getTime() <= Date.now();
}

/** ¿Pasaron menos de `ms` milisegundos desde la fecha? */
export function isWithin(date: Date, ms: number): boolean {
  return Date.now() - date.getTime() < ms;
}
