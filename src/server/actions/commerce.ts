"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { unstable_update } from "@/auth";
import { DomainError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { LIMITS } from "@/lib/rate-limit";
import { cleanMultiline, passwordField, profileSchema } from "@/lib/validation";
import { requireActionUser } from "../auth/guards";
import { db } from "../db";
import { DISPUTE_REASONS, openDispute, rateDelivery, type DisputeReason } from "../services/feedback";
import { cancelOrder, createOrder } from "../services/orders";
import { ensureCheckout } from "../services/payments";
import { changePassword, updateBusinessProfile } from "../services/users";
import { enforceLimit, parseForm, runAction, str } from "./run";

/** Inicia el pago: crea la preferencia (si hace falta) y redirige al checkout. */
export async function startPaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { url?: string } = {};
  const state = await runAction(async () => {
    const user = await requireActionUser(["COMERCIO"]);
    enforceLimit(`pay:${user.id}`, LIMITS.mutation);
    const paymentId = str(fd, "paymentId");
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.commerceId !== user.businessId) throw new DomainError("NO_ENCONTRADO", "Pago inexistente.");
    out.url = await ensureCheckout(paymentId);
  });
  if (out.url) redirect(out.url);
  return state;
}

const cartSchema = z.object({
  distributorId: z.string().min(1).max(40),
  lines: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Carrito inválido." });
        return z.NEVER;
      }
    })
    .pipe(z.array(z.object({ productId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(10_000) })).min(1).max(100)),
  notes: z.string().max(500).optional(),
});

export async function createOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { paymentId?: string } = {};
  const state = await runAction(async () => {
    const user = await requireActionUser(["COMERCIO"]);
    enforceLimit(`order:${user.id}`, LIMITS.mutation);
    const data = parseForm(cartSchema, fd);
    const res = await createOrder(user, { distributorId: data.distributorId, lines: data.lines, notes: data.notes ? cleanMultiline(data.notes) : null });
    out.paymentId = res.paymentId;
  });
  if (out.paymentId) redirect(`/comercio/pagos/${out.paymentId}?pedido=1`);
  return state;
}

export async function cancelOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["COMERCIO", "PREVENTISTA", "ADMIN"]);
    const reason = str(fd, "reason").trim().slice(0, 300) || (user.role === "COMERCIO" ? "Cancelado por el comercio" : "Cancelado por el preventista");
    await cancelOrder(user, str(fd, "orderId"), reason);
    revalidatePath("/comercio/pedidos");
    revalidatePath("/preventista/pedidos");
  }, "Pedido cancelado.");
}

const rateSchema = z.object({
  participationId: z.string().max(40).optional(),
  orderId: z.string().max(40).optional(),
  stars: z.coerce.number().int().min(1, "Elegí de 1 a 5 estrellas.").max(5),
  comment: z.string().max(1000).optional(),
});

export async function rateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["COMERCIO"]);
    const d = parseForm(rateSchema, fd);
    await rateDelivery(user, {
      participationId: d.participationId || undefined,
      orderId: d.orderId || undefined,
      stars: d.stars,
      comment: d.comment ? cleanMultiline(d.comment) : null,
    });
    revalidatePath("/comercio/entregas");
  }, "¡Gracias por calificar!");
}

const disputeSchema = z.object({
  ref: z.string().regex(/^(p|o):[a-z0-9]{1,40}$/i, "Elegí la compra del reclamo."),
  reason: z.enum(Object.keys(DISPUTE_REASONS) as [DisputeReason, ...DisputeReason[]], "Elegí el motivo."),
  description: z.string().transform(cleanMultiline).pipe(z.string().min(10, "Contanos un poco más (mínimo 10 caracteres).").max(5000)),
});

export async function openDisputeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["COMERCIO"]);
    enforceLimit(`dispute:${user.id}`, LIMITS.mutation);
    const d = parseForm(disputeSchema, fd);
    const [kind, id] = d.ref.split(":") as ["p" | "o", string];
    await openDispute(user, { participationId: kind === "p" ? id : undefined, orderId: kind === "o" ? id : undefined, reason: d.reason, description: d.description });
    revalidatePath("/comercio/reclamos");
  }, "Recibimos tu reclamo. El equipo de PEDILA lo revisa y te responde por acá y por email.");
}

/** Edición de datos del negocio (comercio o preventista). */
export async function updateProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["COMERCIO", "PREVENTISTA"]);
    const d = parseForm(profileSchema, fd);
    await updateBusinessProfile(user, {
      name: d.name,
      phone: d.phone,
      legalName: d.legalName,
      tradeName: d.tradeName,
      ivaCondition: d.ivaCondition,
      street: d.street,
      streetNumber: d.streetNumber,
      floorApt: d.floorApt,
      postalCode: d.postalCode,
      provinceId: d.provinceId,
      localityId: d.localityId,
      description: d.description,
      coverage: d.coverage,
    });
    await unstable_update({});
    revalidatePath("/", "layout");
  }, "Guardamos los cambios.");
}

const passwordSchema = z
  .object({ current: z.string().max(200), password: passwordField, passwordConfirm: z.string() })
  .refine((d) => d.password === d.passwordConfirm, { message: "Las contraseñas no coinciden.", path: ["passwordConfirm"] });

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(null);
    enforceLimit(`pwd:${user.id}`, LIMITS.passwordReset);
    const d = parseForm(passwordSchema, fd);
    await changePassword(user, d.current, d.password);
  }, "Cambiaste tu contraseña.");
}

export async function markNotificationsReadAction(): Promise<void> {
  const user = await requireActionUser(null);
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notificaciones");
}
