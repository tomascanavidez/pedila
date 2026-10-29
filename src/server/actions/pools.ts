"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DomainError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { formatInt } from "@/lib/labels";
import { LIMITS } from "@/lib/rate-limit";
import { joinSchema, localDateTime, poolSchema } from "@/lib/validation";
import { requireActionUser } from "../auth/guards";
import { db } from "../db";
import { audit } from "../audit";
import {
  acceptCloseBelowMinimum,
  cancelPool,
  changeParticipation,
  extendPoolDeadline,
  markParticipationDelivered,
  markPoolDelivered,
  publishPool,
  reviewPool,
  savePoolDraft,
  schedulePoolDelivery,
} from "../services/pools";
import { PUBLIC_POOL_TAG } from "../queries/public";
import { enforceLimit, parseForm, refreshPublic, runAction, str } from "./run";

/** Sumarse / modificar / retirarse de un pool (comercio). */
export async function joinPoolAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["COMERCIO"]);
    enforceLimit(`join:${user.id}`, LIMITS.join);
    const { poolId, quantity } = parseForm(joinSchema, fd);
    const res = await changeParticipation(user, poolId, quantity);
    refreshPublic(PUBLIC_POOL_TAG);
    revalidatePath("/comercio/pools");
    const message =
      quantity === 0
        ? "Listo, te retiraste del pool."
        : res.closed
          ? "¡Te sumaste y el pool se cerró! Te mandamos el link de pago."
          : `¡Listo! Tenés ${formatInt(quantity)} unidades reservadas en este pool.`;
    return { ok: true, message, data: { quantity, committedUnits: res.committedUnits, status: res.status, closed: res.closed } };
  });
}

/** Guardar borrador (y opcionalmente publicar) un pool (preventista). */
export async function savePoolAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { target?: string } = {};
  const state = await runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    enforceLimit(`pool-save:${user.id}`, LIMITS.mutation);
    const data = parseForm(poolSchema, fd);
    const poolId = str(fd, "poolId") || undefined;
    const pool = await savePoolDraft(
      user,
      {
        productId: data.productId,
        title: data.title,
        description: data.description,
        priceInputCents: data.price,
        retailUnitPriceCents: data.retailPrice,
        totalUnits: data.totalUnits,
        minUnitsToClose: data.minUnitsToClose,
        minPerCommerce: data.minPerCommerce,
        maxPerCommerce: data.maxPerCommerce,
        closeOnMinimum: data.closeOnMinimum,
        deadlineAt: data.deadlineAt,
        estimatedDeliveryAt: data.estimatedDeliveryAt,
        zones: data.zones,
      },
      poolId,
    );
    if (str(fd, "intent") === "publicar") {
      const res = await publishPool(user, pool.id);
      refreshPublic(PUBLIC_POOL_TAG);
      out.target = `/preventista/pools/${pool.id}?publicado=${res.status === "ABIERTO" ? "1" : "revision"}`;
    } else {
      out.target = `/preventista/pools/${pool.id}?guardado=1`;
    }
  });
  if (out.target) redirect(out.target);
  return state;
}

const idSchema = z.object({ poolId: z.string().min(1).max(40) });

async function poolAction(fd: FormData, fn: (poolId: string) => Promise<void>, message: string): Promise<ActionState> {
  return runAction(async () => {
    const { poolId } = parseForm(idSchema, fd);
    await fn(poolId);
    refreshPublic(PUBLIC_POOL_TAG);
    revalidatePath(`/preventista/pools/${poolId}`);
    revalidatePath(`/admin/pools`);
  }, message);
}

export async function publishPoolAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    const { poolId } = parseForm(idSchema, fd);
    const res = await publishPool(user, poolId);
    refreshPublic(PUBLIC_POOL_TAG);
    revalidatePath(`/preventista/pools/${poolId}`);
    return {
      ok: true,
      message:
        res.status === "ABIERTO"
          ? `¡Pool publicado! La comisión quedó congelada en ${(res.commissionBps / 100).toString().replace(".", ",")} %.`
          : "Pool enviado a revisión. Te avisamos cuando PEDILA lo apruebe.",
    };
  });
}

export async function cancelPoolAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireActionUser(["PREVENTISTA", "ADMIN"]).catch(() => null);
  if (!user) return { ok: false, message: "Tu sesión venció." };
  const reason = str(fd, "reason").trim().slice(0, 300) || "Cancelado por el preventista";
  return poolAction(fd, (id) => cancelPool(user, id, reason), "El pool se canceló y avisamos a los comercios.");
}

export async function extendPoolAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    const { poolId, deadlineAt } = parseForm(idSchema.extend({ deadlineAt: localDateTime("la nueva fecha límite") }), fd);
    await extendPoolDeadline(user, poolId, deadlineAt);
    refreshPublic(PUBLIC_POOL_TAG);
    revalidatePath(`/preventista/pools/${poolId}`);
  }, "Extendiste la fecha. El pool volvió a estar abierto.");
}

export async function acceptBelowMinimumAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireActionUser(["PREVENTISTA"]).catch(() => null);
  if (!user) return { ok: false, message: "Tu sesión venció." };
  return poolAction(fd, (id) => acceptCloseBelowMinimum(user, id), "Cerraste el pool con lo alcanzado. Ya se emitieron los pagos.");
}

export async function scheduleDeliveryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    const { poolId, date } = parseForm(idSchema.extend({ date: localDateTime("la fecha de entrega") }), fd);
    await schedulePoolDelivery(user, poolId, date);
    revalidatePath(`/preventista/pools/${poolId}`);
    revalidatePath("/preventista/reparto");
  }, "Entrega programada. Avisamos a los comercios.");
}

export async function markParticipationDeliveredAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    const participationId = str(fd, "participationId");
    if (!participationId) throw new DomainError("DATOS", "Falta la participación.");
    await markParticipationDelivered(user, participationId);
    revalidatePath("/preventista/reparto");
    revalidatePath("/preventista/pools", "layout");
  }, "Marcado como entregado.");
}

export async function markPoolDeliveredAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireActionUser(["PREVENTISTA"]).catch(() => null);
  if (!user) return { ok: false, message: "Tu sesión venció." };
  return poolAction(fd, (id) => markPoolDelivered(user, id), "Todo el pool quedó marcado como entregado.");
}

/** Admin: aprobar o rechazar un pool pendiente. */
export async function reviewPoolAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireActionUser(["ADMIN"]).catch(() => null);
  if (!user) return { ok: false, message: "Sin permiso." };
  const approve = str(fd, "decision") === "aprobar";
  const note = str(fd, "note").trim().slice(0, 500) || null;
  return poolAction(fd, (id) => reviewPool(user, id, approve, note), approve ? "Pool aprobado y publicado." : "Pool devuelto al preventista.");
}

/** Admin: destacar / quitar de destacados. */
export async function toggleFeaturedAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["ADMIN"]);
    const { poolId } = parseForm(idSchema, fd);
    const pool = await db.pool.update({ where: { id: poolId }, data: { featured: str(fd, "featured") === "1" } });
    await audit(db, user, { action: "pool.destacar", entityType: "POOL", entityId: poolId, summary: pool.featured ? "destacado" : "no destacado" });
    refreshPublic(PUBLIC_POOL_TAG);
    revalidatePath("/admin/pools");
  }, "Actualizado.");
}
