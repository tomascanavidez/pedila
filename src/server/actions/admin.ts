"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { cleanLine, cleanMultiline, commissionSettingsSchema, operationalSettingsSchema, optionalPercentField } from "@/lib/validation";
import { audit } from "../audit";
import { requireActionUser } from "../auth/guards";
import { db } from "../db";
import { setCategoryCommission, setDistributorCommission, updateCommissionSettings, updateOperationalSettings } from "../services/commissions";
import { resolveDispute } from "../services/feedback";
import { markSettlementPaidOut } from "../services/settlements";
import { reviewDistributor, setUserStatus } from "../services/users";
import { parseForm, refreshPublic, runAction, str } from "./run";

const admin = () => requireActionUser(["ADMIN"]);

export async function updateCommissionSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const d = parseForm(commissionSettingsSchema, fd);
    await updateCommissionSettings(user, { globalBps: d.globalPercent, mode: d.mode, catalogCommissionEnabled: d.catalogCommissionEnabled });
    refreshPublic("catalog");
    revalidatePath("/admin/comisiones");
  }, "Comisión actualizada. Los pools ya publicados conservan su porcentaje.");
}

const overrideSchema = z.object({ targetId: z.string().min(1).max(40), percent: optionalPercentField });

export async function setCategoryCommissionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const d = parseForm(overrideSchema, fd);
    await setCategoryCommission(user, d.targetId, d.percent);
    revalidatePath("/admin/comisiones");
  }, "Override de categoría guardado.");
}

export async function setDistributorCommissionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const d = parseForm(overrideSchema, fd);
    await setDistributorCommission(user, d.targetId, d.percent);
    revalidatePath("/admin/comisiones");
  }, "Override de preventista guardado.");
}

export async function updateOperationalSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const d = parseForm(operationalSettingsSchema, fd);
    await updateOperationalSettings(user, d);
    revalidatePath("/admin/configuracion");
  }, "Configuración guardada. Aplica a los pools que se publiquen desde ahora.");
}

export async function reviewDistributorAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const approve = str(fd, "decision") === "aprobar";
    const reason = cleanLine(str(fd, "reason")).slice(0, 500) || null;
    if (!approve && !reason) throw new DomainError("DATOS", "Indicá el motivo del rechazo.");
    await reviewDistributor(user, str(fd, "businessId"), approve, reason);
    refreshPublic("distributors", "catalog");
    revalidatePath("/admin/preventistas");
  }, "Listo, avisamos al preventista.");
}

export async function setUserStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const status = str(fd, "status") === "SUSPENDIDO" ? "SUSPENDIDO" : "ACTIVO";
    await setUserStatus(user, str(fd, "userId"), status);
    refreshPublic("distributors", "catalog");
    revalidatePath("/admin/usuarios");
  }, "Estado actualizado.");
}

const categorySchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().transform(cleanLine).pipe(z.string().min(2, "Nombre muy corto.").max(80)),
  slug: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9-]{2,80}$/, "El slug admite minúsculas, números y guiones.")),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: z.string().optional().transform((v) => v === "on" || v === "true"),
});

export async function saveCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const d = parseForm(categorySchema, fd);
    try {
      const cat = d.id
        ? await db.category.update({ where: { id: d.id }, data: { name: d.name, slug: d.slug, sortOrder: d.sortOrder, active: d.active } })
        : await db.category.create({ data: { name: d.name, slug: d.slug, sortOrder: d.sortOrder, active: true } });
      await audit(db, user, { action: d.id ? "categoria.editar" : "categoria.crear", entityType: "CATEGORY", entityId: cat.id, summary: cat.name });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new DomainError("DUPLICADO", "Ya existe una categoría con ese nombre o slug.");
      throw err;
    }
    refreshPublic("categories", "catalog", "pools");
    revalidatePath("/admin/categorias");
  }, "Categoría guardada.");
}

const localitySchema = z.object({
  provinceId: z.coerce.number().int().min(1),
  name: z.string().transform(cleanLine).pipe(z.string().min(2, "Nombre muy corto.").max(120)),
});

export async function createLocalityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const d = parseForm(localitySchema, fd);
    try {
      const loc = await db.locality.create({ data: d });
      await audit(db, user, { action: "zona.crear", entityType: "LOCALITY", entityId: String(loc.id), summary: d.name });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new DomainError("DUPLICADO", "Esa localidad ya existe en la provincia.");
      throw err;
    }
    refreshPublic("geo");
    revalidatePath("/admin/zonas");
  }, "Localidad agregada.");
}

export async function toggleLocalityAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const id = Number(str(fd, "id"));
    const loc = await db.locality.update({ where: { id }, data: { active: str(fd, "active") === "1" } });
    await audit(db, user, { action: "zona.estado", entityType: "LOCALITY", entityId: String(id), summary: `${loc.name}: ${loc.active ? "activa" : "inactiva"}` });
    refreshPublic("geo");
    revalidatePath("/admin/zonas");
  }, "Localidad actualizada.");
}

export async function resolveDisputeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const status = str(fd, "status");
    if (!["EN_REVISION", "RESUELTA", "RECHAZADA"].includes(status)) throw new DomainError("DATOS", "Estado inválido.");
    const resolution = cleanMultiline(str(fd, "resolution"));
    if (resolution.length < 5) throw new DomainError("DATOS", "Escribí la resolución.");
    await resolveDispute(user, str(fd, "disputeId"), status as "EN_REVISION" | "RESUELTA" | "RECHAZADA", resolution);
    revalidatePath("/admin/disputas");
  }, "Reclamo actualizado.");
}

export async function markSettlementPaidAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const reference = cleanLine(str(fd, "reference"));
    if (reference.length < 3) throw new DomainError("DATOS", "Indicá la referencia de la transferencia.");
    await markSettlementPaidOut(user, str(fd, "settlementId"), { reference, notes: cleanLine(str(fd, "notes")) || null });
    revalidatePath("/admin/liquidaciones");
  }, "Liquidación marcada como pagada.");
}

export async function retryJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await admin();
    const id = str(fd, "jobId");
    await db.job.update({ where: { id }, data: { status: "PENDIENTE", runAt: new Date(), attempts: 0, lastError: null } });
    await audit(db, user, { action: "tarea.reintentar", entityType: "JOB", entityId: id });
    revalidatePath("/admin/tareas");
  }, "La tarea se reintenta en el próximo ciclo del worker.");
}
