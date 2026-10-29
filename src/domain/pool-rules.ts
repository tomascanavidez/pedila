/**
 * Reglas de los pools de compra (lógica pura, sin base de datos).
 *
 * Máquina de estados:
 *
 *   BORRADOR → PENDIENTE_APROBACION (si el admin exige aprobación) → ABIERTO
 *   ABIERTO → COMPLETO (se alcanzó el mínimo)
 *   COMPLETO → CERRADO_PAGADO → EN_ENTREGA → ENTREGADO
 *   ABIERTO → VENCIDO_SIN_COMPLETAR (llegó la fecha límite sin el mínimo)
 *   VENCIDO_SIN_COMPLETAR → ABIERTO (el preventista extiende la fecha, una sola vez)
 *   VENCIDO_SIN_COMPLETAR → COMPLETO (el preventista acepta cerrar con lo alcanzado)
 *   COMPLETO → ABIERTO (regla REABRIR: alguien no pagó y no se llega al mínimo)
 *   cualquier estado no final → CANCELADO
 *
 * "COMPLETO" tiene dos fases: sigue sumando (closedAt = null, solo si el preventista
 * eligió no cerrar al llegar al mínimo) y cerrado esperando pagos (closedAt != null).
 */
import type { ParticipationStatus, PoolStatus, UnpaidRule } from "@/generated/prisma/enums";
import { DomainError } from "./errors";

export const POOL_TRANSITIONS: Readonly<Record<PoolStatus, readonly PoolStatus[]>> = {
  BORRADOR: ["PENDIENTE_APROBACION", "ABIERTO", "CANCELADO"],
  PENDIENTE_APROBACION: ["ABIERTO", "BORRADOR", "CANCELADO"],
  ABIERTO: ["COMPLETO", "VENCIDO_SIN_COMPLETAR", "CANCELADO"],
  COMPLETO: ["CERRADO_PAGADO", "ABIERTO", "CANCELADO"],
  VENCIDO_SIN_COMPLETAR: ["ABIERTO", "COMPLETO", "CANCELADO"],
  CERRADO_PAGADO: ["EN_ENTREGA", "ENTREGADO", "CANCELADO"],
  EN_ENTREGA: ["ENTREGADO"],
  ENTREGADO: [],
  CANCELADO: [],
};

export const PARTICIPATION_TRANSITIONS: Readonly<Record<ParticipationStatus, readonly ParticipationStatus[]>> = {
  COMPROMETIDA: ["PENDIENTE_PAGO", "RETIRADA", "CANCELADA"],
  PENDIENTE_PAGO: ["PAGADA", "LIBERADA", "CANCELADA"],
  PAGADA: ["ENTREGADA", "CANCELADA"],
  ENTREGADA: [],
  RETIRADA: ["COMPROMETIDA"],
  LIBERADA: ["COMPROMETIDA"],
  CANCELADA: [],
};

/** Estados de participación que ocupan unidades del pool. */
export const ACTIVE_PARTICIPATION_STATUSES: readonly ParticipationStatus[] = [
  "COMPROMETIDA",
  "PENDIENTE_PAGO",
  "PAGADA",
  "ENTREGADA",
];

export const FINAL_POOL_STATUSES: readonly PoolStatus[] = ["ENTREGADO", "CANCELADO"];

export function canTransition(from: PoolStatus, to: PoolStatus): boolean {
  return POOL_TRANSITIONS[from].includes(to);
}

export function assertPoolTransition(from: PoolStatus, to: PoolStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError("TRANSICION_INVALIDA", `No se puede pasar un pool de ${from} a ${to}.`);
  }
}

export function canTransitionParticipation(from: ParticipationStatus, to: ParticipationStatus): boolean {
  return PARTICIPATION_TRANSITIONS[from].includes(to);
}

export function assertParticipationTransition(from: ParticipationStatus, to: ParticipationStatus): void {
  if (!canTransitionParticipation(from, to)) {
    throw new DomainError("TRANSICION_INVALIDA", `No se puede pasar una participación de ${from} a ${to}.`);
  }
}

export function isActiveParticipation(status: ParticipationStatus): boolean {
  return ACTIVE_PARTICIPATION_STATUSES.includes(status);
}

/** Lo mínimo que la lógica necesita saber de un pool. */
export interface PoolSnapshot {
  status: PoolStatus;
  totalUnits: number;
  minUnitsToClose: number;
  minPerCommerce: number;
  maxPerCommerce: number;
  committedUnits: number;
  closeOnMinimum: boolean;
  deadlineAt: Date;
  closedAt: Date | null;
  notified80: boolean;
}

export function isAcceptingJoins(pool: Pick<PoolSnapshot, "status" | "closedAt" | "deadlineAt">, now: Date): boolean {
  const open = pool.status === "ABIERTO" || (pool.status === "COMPLETO" && pool.closedAt === null);
  return open && pool.deadlineAt.getTime() > now.getTime();
}

export function availableUnits(pool: Pick<PoolSnapshot, "totalUnits" | "committedUnits">): number {
  return Math.max(0, pool.totalUnits - pool.committedUnits);
}

export interface Progress {
  committed: number;
  minimum: number;
  total: number;
  /** % sobre el mínimo para cerrar (0–100), lo que muestra la barra. */
  percentOfMinimum: number;
  /** % sobre el total de unidades (0–100). */
  percentOfTotal: number;
  remainingToMinimum: number;
  available: number;
}

export function computeProgress(committed: number, minimum: number, total: number): Progress {
  const pct = (a: number, b: number) => (b <= 0 ? 0 : Math.min(100, Math.floor((a * 100) / b)));
  return {
    committed,
    minimum,
    total,
    percentOfMinimum: pct(committed, minimum),
    percentOfTotal: pct(committed, total),
    remainingToMinimum: Math.max(0, minimum - committed),
    available: Math.max(0, total - committed),
  };
}

export interface ParticipationChange {
  /** Cantidad actual activa del comercio en el pool (0 si no participa). */
  currentQty: number;
  /** Cantidad deseada (0 = retirarse). */
  newQty: number;
  now: Date;
}

/**
 * Valida un alta, modificación o baja de participación. Devuelve la diferencia de
 * unidades a sumar (puede ser negativa). Debe llamarse con el pool bloqueado (FOR UPDATE).
 */
export function validateParticipationChange(pool: PoolSnapshot, change: ParticipationChange): number {
  const { currentQty, newQty, now } = change;
  if (!Number.isInteger(newQty) || newQty < 0) {
    throw new DomainError("CANTIDAD_INVALIDA", "La cantidad tiene que ser un número entero.");
  }
  if (!isAcceptingJoins(pool, now)) {
    throw new DomainError("POOL_NO_DISPONIBLE", "Este pool ya no acepta cambios.");
  }
  const delta = newQty - currentQty;
  if (delta === 0) {
    throw new DomainError("SIN_CAMBIOS", "Ya tenés esa cantidad en el pool.");
  }
  if (delta < 0 && pool.status !== "ABIERTO") {
    throw new DomainError(
      "POOL_COMPLETO",
      "El pool ya llegó al mínimo: podés sumar unidades, pero no bajar ni retirarte.",
    );
  }
  if (newQty === 0) return delta;
  if (newQty < pool.minPerCommerce) {
    throw new DomainError("CANTIDAD_MINIMA", `El mínimo por comercio es ${pool.minPerCommerce} unidades.`);
  }
  if (newQty > pool.maxPerCommerce) {
    throw new DomainError("CANTIDAD_MAXIMA", `El máximo por comercio es ${pool.maxPerCommerce} unidades.`);
  }
  if (delta > availableUnits(pool)) {
    const left = availableUnits(pool);
    throw new DomainError(
      "SIN_UNIDADES",
      left === 0 ? "No quedan unidades disponibles en este pool." : `Solo quedan ${left} unidades disponibles.`,
    );
  }
  return delta;
}

export interface AfterCommitDecision {
  nextStatus: PoolStatus;
  reachedMinimum: boolean;
  shouldClose: boolean;
  crossed80: boolean;
}

/** Qué pasa con el pool después de cambiar las unidades comprometidas. */
export function decideAfterCommit(pool: PoolSnapshot, newCommitted: number): AfterCommitDecision {
  const reachedMinimum = pool.status === "ABIERTO" && newCommitted >= pool.minUnitsToClose;
  const nextStatus: PoolStatus = reachedMinimum ? "COMPLETO" : pool.status;
  const isComplete = nextStatus === "COMPLETO" && pool.closedAt === null;
  const shouldClose = isComplete && (pool.closeOnMinimum || newCommitted >= pool.totalUnits);
  const crossed80 =
    !pool.notified80 &&
    !reachedMinimum &&
    nextStatus === "ABIERTO" &&
    newCommitted * 100 >= pool.minUnitsToClose * 80;
  return { nextStatus, reachedMinimum, shouldClose, crossed80 };
}

export type DeadlineDecision = "NONE" | "EXPIRE" | "CLOSE";

/** Lo que hace el job programado cuando pasa la fecha límite. */
export function decideOnDeadline(
  pool: Pick<PoolSnapshot, "status" | "deadlineAt" | "closedAt">,
  now: Date,
): DeadlineDecision {
  if (pool.deadlineAt.getTime() > now.getTime()) return "NONE";
  if (pool.status === "ABIERTO") return "EXPIRE";
  if (pool.status === "COMPLETO" && pool.closedAt === null) return "CLOSE";
  return "NONE";
}

export type SettleDecision = "WAIT" | "MARK_PAID" | "REOPEN" | "CANCEL";

/**
 * Con el pool cerrado, decide qué hacer cuando ya no quedan pagos pendientes.
 *  - Si lo pagado alcanza el mínimo → CERRADO_PAGADO.
 *  - Regla CERRAR_CON_PAGADO (o el preventista aceptó cerrar por debajo del mínimo):
 *    se cierra con lo pagado; si nadie pagó, se cancela.
 *  - Regla REABRIR: el pool vuelve a ABIERTO con las unidades liberadas.
 */
export function decideAfterPayments(params: {
  unpaidRule: UnpaidRule;
  acceptedBelowMinimum: boolean;
  minUnitsToClose: number;
  paidUnits: number;
  pendingPaymentUnits: number;
}): SettleDecision {
  if (params.pendingPaymentUnits > 0) return "WAIT";
  const rule: UnpaidRule = params.acceptedBelowMinimum ? "CERRAR_CON_PAGADO" : params.unpaidRule;
  if (params.paidUnits >= params.minUnitsToClose && params.paidUnits > 0) return "MARK_PAID";
  if (rule === "CERRAR_CON_PAGADO") return params.paidUnits > 0 ? "MARK_PAID" : "CANCEL";
  return "REOPEN";
}

/** Nueva fecha límite al reabrir por falta de pago: nunca se acorta. */
export function reopenDeadline(currentDeadline: Date, now: Date, extensionHours: number): Date {
  const minimum = now.getTime() + extensionHours * 3_600_000;
  return new Date(Math.max(currentDeadline.getTime(), minimum));
}

export interface ExpiredPoolState {
  status: PoolStatus;
  extendedOnce: boolean;
  finalizedAt: Date | null;
  decisionDeadlineAt: Date | null;
  committedUnits: number;
}

function inDecisionWindow(pool: ExpiredPoolState, now: Date): boolean {
  return (
    pool.status === "VENCIDO_SIN_COMPLETAR" &&
    pool.finalizedAt === null &&
    pool.decisionDeadlineAt !== null &&
    pool.decisionDeadlineAt.getTime() > now.getTime()
  );
}

export function canExtendDeadline(pool: ExpiredPoolState, now: Date): boolean {
  return inDecisionWindow(pool, now) && !pool.extendedOnce;
}

export function canAcceptBelowMinimum(pool: ExpiredPoolState, now: Date): boolean {
  return inDecisionWindow(pool, now) && pool.committedUnits > 0;
}

export const MAX_EXTENSION_DAYS = 30;

export function assertValidExtension(newDeadline: Date, now: Date): void {
  const min = now.getTime() + 3_600_000;
  const max = now.getTime() + MAX_EXTENSION_DAYS * 86_400_000;
  if (newDeadline.getTime() < min || newDeadline.getTime() > max) {
    throw new DomainError(
      "FECHA_INVALIDA",
      `La nueva fecha tiene que ser al menos 1 hora a futuro y como máximo a ${MAX_EXTENSION_DAYS} días.`,
    );
  }
}

export interface PoolDefinition {
  totalUnits: number;
  minUnitsToClose: number;
  minPerCommerce: number;
  maxPerCommerce: number;
  deadlineAt: Date;
  estimatedDeliveryAt: Date | null;
  unitPriceCents: number;
  retailUnitPriceCents: number;
}

export const MAX_POOL_UNITS = 1_000_000;
export const MAX_POOL_DAYS = 90;

/** Validaciones de negocio al crear o publicar un pool. Devuelve la lista de errores por campo. */
export function validatePoolDefinition(def: PoolDefinition, now: Date): Record<string, string> {
  const errors: Record<string, string> = {};
  const isPosInt = (n: number) => Number.isInteger(n) && n > 0;
  if (!isPosInt(def.totalUnits) || def.totalUnits > MAX_POOL_UNITS) {
    errors.totalUnits = "Ingresá un total de unidades válido.";
  }
  if (!isPosInt(def.minUnitsToClose) || def.minUnitsToClose > def.totalUnits) {
    errors.minUnitsToClose = "El mínimo para cerrar tiene que ser mayor a 0 y no superar el total.";
  }
  if (!isPosInt(def.minPerCommerce)) {
    errors.minPerCommerce = "El mínimo por comercio tiene que ser al menos 1.";
  }
  if (!isPosInt(def.maxPerCommerce) || def.maxPerCommerce < def.minPerCommerce || def.maxPerCommerce > def.totalUnits) {
    errors.maxPerCommerce = "El máximo por comercio tiene que estar entre el mínimo por comercio y el total.";
  }
  const deadline = def.deadlineAt.getTime();
  if (Number.isNaN(deadline) || deadline < now.getTime() + 3_600_000) {
    errors.deadlineAt = "La fecha límite tiene que ser al menos 1 hora a futuro.";
  } else if (deadline > now.getTime() + MAX_POOL_DAYS * 86_400_000) {
    errors.deadlineAt = `La fecha límite no puede superar los ${MAX_POOL_DAYS} días.`;
  }
  if (def.estimatedDeliveryAt && def.estimatedDeliveryAt.getTime() < deadline) {
    errors.estimatedDeliveryAt = "La entrega estimada tiene que ser posterior a la fecha límite.";
  }
  if (def.retailUnitPriceCents < def.unitPriceCents) {
    errors.retailUnitPriceCents = "El precio minorista de referencia tiene que ser mayor o igual al precio del pool.";
  }
  return errors;
}
