import "server-only";
import type { Tx } from "../tx";

/**
 * Bloqueos de fila (SELECT ... FOR UPDATE).
 * Es el único SQL crudo dependiente del motor: MySQL/MariaDB usa comillas invertidas.
 * Para PostgreSQL alcanza con cambiar `Pool` por "Pool" (comillas dobles).
 *
 * Regla para evitar deadlocks: siempre se bloquea primero el pool y después se
 * tocan sus participaciones y pagos.
 */
export async function lockPool(tx: Tx, poolId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`Pool\` WHERE id = ${poolId} FOR UPDATE`;
  return rows.length > 0;
}

export async function lockOrder(tx: Tx, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`Order\` WHERE id = ${orderId} FOR UPDATE`;
  return rows.length > 0;
}

export async function lockPayment(tx: Tx, paymentId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`Payment\` WHERE id = ${paymentId} FOR UPDATE`;
  return rows.length > 0;
}
