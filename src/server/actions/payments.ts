"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { DomainError } from "@/domain/errors";
import { toCents } from "@/domain/money";
import type { ActionState } from "@/lib/action-state";
import { requireActionUser } from "../auth/guards";
import { db } from "../db";
import { simulatedPaymentsAllowed } from "../env";
import { applyProviderUpdate } from "../services/payments";
import { PUBLIC_POOL_TAG } from "../queries/public";
import { refreshPublic, runAction, str } from "./run";

/**
 * Checkout SIMULADO (solo desarrollo/demos): aplica el resultado por el mismo camino que
 * un webhook real de Mercado Pago. Deshabilitado en producción salvo ALLOW_SIMULATED_PAYMENTS.
 */
export async function simulatePaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { to?: string } = {};
  const state = await runAction(async () => {
    if (!simulatedPaymentsAllowed()) throw new DomainError("DESHABILITADO", "Los pagos simulados están deshabilitados.");
    const user = await requireActionUser(["COMERCIO", "ADMIN"]);
    const paymentId = str(fd, "paymentId");
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.provider !== "simulado") throw new DomainError("NO_ENCONTRADO", "Pago simulado inexistente.");
    if (user.role !== "ADMIN" && payment.commerceId !== user.businessId) throw new DomainError("SIN_PERMISO", "No es tu pago.");
    const approve = str(fd, "decision") === "aprobar";
    await applyProviderUpdate(
      paymentId,
      {
        providerPaymentId: `SIM-${randomBytes(6).toString("hex")}`,
        state: approve ? "APPROVED" : "REJECTED",
        providerStatus: approve ? "simulado:approved" : "simulado:rejected",
        externalReference: paymentId,
        amountCents: toCents(payment.amountCents),
        currency: "ARS",
        paidAt: approve ? new Date() : null,
      },
      { id: user.id, role: user.role },
    );
    // El pago puede cambiar el estado del pool (por ejemplo, a "Pagado"): se invalida el caché público.
    refreshPublic(PUBLIC_POOL_TAG);
    out.to = `/comercio/pagos/${paymentId}?resultado=${approve ? "aprobado" : "rechazado"}`;
  });
  if (out.to) redirect(out.to);
  return state;
}
