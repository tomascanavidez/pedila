"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { LIMITS } from "@/lib/rate-limit";
import { localDateTime, productSchema } from "@/lib/validation";
import { z } from "zod";
import { requireActionUser } from "../auth/guards";
import { respondDispute } from "../services/feedback";
import { markOrderDelivered, scheduleOrderDelivery } from "../services/orders";
import { deleteProduct, importProductsCsv, removeProductImage, saveProduct } from "../services/products";
import { enforceLimit, parseForm, refreshPublic, runAction, str } from "./run";

export async function saveProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { id?: string; created?: boolean } = {};
  const state = await runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    enforceLimit(`product:${user.id}`, LIMITS.mutation);
    const d = parseForm(productSchema, fd);
    const productId = str(fd, "productId") || undefined;
    const p = await saveProduct(
      user,
      {
        name: d.name,
        brand: d.brand,
        description: d.description,
        sku: d.sku,
        ean: d.ean,
        categoryId: d.categoryId,
        saleUnit: d.saleUnit,
        unitsPerPack: d.unitsPerPack,
        priceCents: d.price,
        retailPriceCents: d.retailPrice,
        minOrderQty: d.minOrderQty,
        active: d.active,
      },
      productId,
    );
    refreshPublic("catalog");
    revalidatePath("/preventista/productos");
    out.id = p.id;
    out.created = !productId;
  }, "Producto guardado.");
  if (out.created && out.id) redirect(`/preventista/productos/${out.id}?nuevo=1`);
  return state;
}

export async function deleteProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { done?: boolean } = {};
  const state = await runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    const result = await deleteProduct(user, str(fd, "productId"));
    refreshPublic("catalog");
    revalidatePath("/preventista/productos");
    if (result === "desactivado") return { ok: true, message: "El producto tiene pools o pedidos: lo desactivamos en lugar de borrarlo." };
    out.done = true;
  });
  if (out.done) redirect("/preventista/productos?borrado=1");
  return state;
}

export async function removeProductImageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    await removeProductImage(user, str(fd, "imageId"));
    refreshPublic("catalog");
    revalidatePath("/preventista/productos", "layout");
  }, "Imagen eliminada.");
}

export async function importProductsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    enforceLimit(`import:${user.id}`, LIMITS.upload);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("ARCHIVO", "Elegí un archivo CSV.");
    if (file.size > 2 * 1024 * 1024) throw new DomainError("ARCHIVO", "El CSV puede pesar hasta 2 MB.");
    if (!/\.(csv|txt)$/i.test(file.name)) throw new DomainError("ARCHIVO", "El archivo tiene que ser .csv.");
    const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
    const res = await importProductsCsv(user, text);
    refreshPublic("catalog");
    revalidatePath("/preventista/productos");
    return {
      ok: res.errors.length === 0,
      message: `Importación terminada: ${res.created} nuevos, ${res.updated} actualizados${res.errors.length ? `, ${res.errors.length} filas con errores` : ""}.`,
      data: { errors: res.errors.slice(0, 50) },
    };
  });
}

export async function scheduleOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    const { orderId, date } = parseForm(z.object({ orderId: z.string().min(1).max(40), date: localDateTime("la fecha de entrega") }), fd);
    await scheduleOrderDelivery(user, orderId, date);
    revalidatePath("/preventista/pedidos");
    revalidatePath("/preventista/reparto");
  }, "Entrega programada.");
}

export async function markOrderDeliveredAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    await markOrderDelivered(user, str(fd, "orderId"));
    revalidatePath("/preventista/pedidos");
    revalidatePath("/preventista/reparto");
  }, "Pedido entregado.");
}

export async function respondDisputeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireActionUser(["PREVENTISTA"]);
    const text = str(fd, "response").trim();
    if (text.length < 5) throw new DomainError("DATOS", "Escribí una respuesta.");
    await respondDispute(user, str(fd, "disputeId"), text);
    revalidatePath("/preventista");
  }, "Respuesta enviada.");
}
