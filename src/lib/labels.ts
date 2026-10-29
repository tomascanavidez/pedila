import type {
  DisputeStatus,
  OrderStatus,
  ParticipationStatus,
  PaymentStatus,
  PoolStatus,
  SaleUnit,
  SettlementStatus,
} from "@/generated/prisma/enums";

export const POOL_STATUS_LABEL: Record<PoolStatus, string> = {
  BORRADOR: "Borrador",
  PENDIENTE_APROBACION: "En revisión",
  ABIERTO: "Abierto",
  COMPLETO: "Completo",
  CERRADO_PAGADO: "Pagado",
  EN_ENTREGA: "En entrega",
  ENTREGADO: "Entregado",
  VENCIDO_SIN_COMPLETAR: "Vencido",
  CANCELADO: "Cancelado",
};

export const PARTICIPATION_STATUS_LABEL: Record<ParticipationStatus, string> = {
  COMPROMETIDA: "Comprometida",
  PENDIENTE_PAGO: "Falta pagar",
  PAGADA: "Pagada",
  ENTREGADA: "Entregada",
  RETIRADA: "Te retiraste",
  LIBERADA: "Liberada (no se pagó)",
  CANCELADA: "Cancelada",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  APROBADO: "Aprobado",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
  REINTEGRADO: "Reintegrado",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDIENTE_PAGO: "Falta pagar",
  PAGADO: "Pagado",
  EN_ENTREGA: "En entrega",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  PENDIENTE: "Pendiente",
  LIQUIDADO: "Liquidado",
};

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  ABIERTA: "Abierta",
  EN_REVISION: "En revisión",
  RESUELTA: "Resuelta",
  RECHAZADA: "Rechazada",
};

export const SALE_UNIT_LABEL: Record<SaleUnit, { one: string; many: string; short: string }> = {
  UNIDAD: { one: "unidad", many: "unidades", short: "u." },
  BULTO: { one: "bulto", many: "bultos", short: "bultos" },
};

export function unitsText(qty: number, unit: SaleUnit): string {
  const l = SALE_UNIT_LABEL[unit];
  return `${formatInt(qty)} ${qty === 1 ? l.one : l.many}`;
}

export const COMMISSION_SOURCE_LABEL = {
  GLOBAL: "comisión global",
  CATEGORIA: "comisión de la categoría",
  PREVENTISTA: "comisión acordada con tu cuenta",
} as const;

export const COMMISSION_MODE_LABEL = {
  DESCONTAR_AL_PREVENTISTA: "Se descuenta del precio del preventista",
  SUMAR_AL_COMERCIO: "Se suma al precio que ve el comercio",
} as const;

export const UNPAID_RULE_LABEL = {
  REABRIR: "Reabrir el pool con las unidades liberadas",
  CERRAR_CON_PAGADO: "Cerrar con lo que se pagó",
} as const;

/** Formato entero argentino: 12.345 */
export function formatInt(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
