import "server-only";
import type { CommissionMode, UnpaidRule } from "@/generated/prisma/enums";
import { assertValidBps, resolveCommission, type ResolvedCommission } from "@/domain/commission";
import { DomainError } from "@/domain/errors";
import { formatBps } from "@/domain/money";
import { audit } from "../audit";
import { getPlatformConfig } from "../config";
import { db } from "../db";
import { withTx, type Tx } from "../tx";
import type { UserActor } from "./actor";

export interface ApplicableCommission extends ResolvedCommission {
  mode: CommissionMode;
}

/** Comisión aplicable hoy a un preventista y una categoría (prioridad preventista > categoría > global). */
export async function getApplicableCommission(
  client: Tx | typeof db,
  distributorId: string,
  categoryId: string,
): Promise<ApplicableCommission> {
  const [config, category, distributor] = await Promise.all([
    getPlatformConfig(client),
    client.category.findUnique({ where: { id: categoryId }, select: { commissionBps: true } }),
    client.business.findUnique({ where: { id: distributorId }, select: { commissionBps: true } }),
  ]);
  const resolved = resolveCommission({
    globalBps: config.globalCommissionBps,
    categoryBps: category?.commissionBps ?? null,
    distributorBps: distributor?.commissionBps ?? null,
  });
  return { ...resolved, mode: config.commissionMode };
}

/** Matriz para la calculadora en vivo del formulario de pools. */
export async function getCommissionMatrix(distributorId: string) {
  const [config, categories, distributor] = await Promise.all([
    getPlatformConfig(),
    db.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.business.findUnique({ where: { id: distributorId }, select: { commissionBps: true } }),
  ]);
  return {
    mode: config.commissionMode,
    globalBps: config.globalCommissionBps,
    distributorBps: distributor?.commissionBps ?? null,
    byCategory: Object.fromEntries(
      categories.map((c) => [
        c.id,
        resolveCommission({
          globalBps: config.globalCommissionBps,
          categoryBps: c.commissionBps,
          distributorBps: distributor?.commissionBps ?? null,
        }),
      ]),
    ) as Record<string, ResolvedCommission>,
  };
}

const MODE_LABEL: Record<CommissionMode, string> = {
  DESCONTAR_AL_PREVENTISTA: "Se descuenta del precio del preventista",
  SUMAR_AL_COMERCIO: "Se suma al precio del comercio",
};

const bpsLabel = (bps: number | null | undefined) => (bps === null || bps === undefined ? "sin override" : formatBps(bps));

export interface CommissionSettingsInput {
  globalBps: number;
  mode: CommissionMode;
  catalogCommissionEnabled: boolean;
}

export async function updateCommissionSettings(actor: UserActor, input: CommissionSettingsInput): Promise<void> {
  assertValidBps(input.globalBps);
  await withTx(async (tx) => {
    const before = await getPlatformConfig(tx);
    await tx.platformConfig.update({
      where: { id: 1 },
      data: {
        globalCommissionBps: input.globalBps,
        commissionMode: input.mode,
        catalogCommissionEnabled: input.catalogCommissionEnabled,
        updatedById: actor.id,
      },
    });
    const changes: { scope: string; label: string; old: string; next: string }[] = [];
    if (before.globalCommissionBps !== input.globalBps) {
      changes.push({ scope: "GLOBAL", label: "Comisión global", old: formatBps(before.globalCommissionBps), next: formatBps(input.globalBps) });
    }
    if (before.commissionMode !== input.mode) {
      changes.push({ scope: "MODO", label: "Modo de cobro", old: MODE_LABEL[before.commissionMode], next: MODE_LABEL[input.mode] });
    }
    if (before.catalogCommissionEnabled !== input.catalogCommissionEnabled) {
      changes.push({
        scope: "CATALOGO",
        label: "Comisión en pedidos de catálogo",
        old: before.catalogCommissionEnabled ? "activada" : "desactivada",
        next: input.catalogCommissionEnabled ? "activada" : "desactivada",
      });
    }
    for (const c of changes) {
      await tx.commissionChange.create({
        data: { scope: c.scope, targetLabel: c.label, oldValue: c.old, newValue: c.next, changedById: actor.id },
      });
    }
    if (changes.length) {
      await audit(tx, actor, {
        action: "comision.config",
        entityType: "CONFIG",
        entityId: "1",
        summary: changes.map((c) => `${c.label}: ${c.old} → ${c.next}`).join(" | "),
        before: { globalCommissionBps: before.globalCommissionBps, commissionMode: before.commissionMode },
        after: input,
      });
    }
  });
}

export async function setCategoryCommission(actor: UserActor, categoryId: string, bps: number | null): Promise<void> {
  if (bps !== null) assertValidBps(bps);
  await withTx(async (tx) => {
    const cat = await tx.category.findUnique({ where: { id: categoryId } });
    if (!cat) throw new DomainError("NO_ENCONTRADO", "Categoría inexistente.");
    if (cat.commissionBps === bps) return;
    await tx.category.update({ where: { id: categoryId }, data: { commissionBps: bps } });
    await tx.commissionChange.create({
      data: {
        scope: "CATEGORIA",
        targetId: categoryId,
        targetLabel: `Categoría ${cat.name}`,
        oldValue: bpsLabel(cat.commissionBps),
        newValue: bpsLabel(bps),
        changedById: actor.id,
      },
    });
    await audit(tx, actor, {
      action: "comision.categoria",
      entityType: "CATEGORY",
      entityId: categoryId,
      summary: `${cat.name}: ${bpsLabel(cat.commissionBps)} → ${bpsLabel(bps)}`,
    });
  });
}

export async function setDistributorCommission(actor: UserActor, businessId: string, bps: number | null): Promise<void> {
  if (bps !== null) assertValidBps(bps);
  await withTx(async (tx) => {
    const b = await tx.business.findUnique({ where: { id: businessId }, include: { user: { select: { role: true } } } });
    if (!b || b.user.role !== "PREVENTISTA") throw new DomainError("NO_ENCONTRADO", "Preventista inexistente.");
    if (b.commissionBps === bps) return;
    await tx.business.update({ where: { id: businessId }, data: { commissionBps: bps } });
    await tx.commissionChange.create({
      data: {
        scope: "PREVENTISTA",
        targetId: businessId,
        targetLabel: `Preventista ${b.tradeName}`,
        oldValue: bpsLabel(b.commissionBps),
        newValue: bpsLabel(bps),
        changedById: actor.id,
      },
    });
    await audit(tx, actor, {
      action: "comision.preventista",
      entityType: "BUSINESS",
      entityId: businessId,
      summary: `${b.tradeName}: ${bpsLabel(b.commissionBps)} → ${bpsLabel(bps)}`,
    });
  });
}

export interface OperationalSettingsInput {
  paymentWindowHours: number;
  unpaidRule: UnpaidRule;
  reopenExtensionHours: number;
  expiredDecisionHours: number;
  poolApprovalRequired: boolean;
}

export async function updateOperationalSettings(actor: UserActor, input: OperationalSettingsInput): Promise<void> {
  const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!inRange(input.paymentWindowHours, 1, 240)) throw new DomainError("CONFIG", "El plazo de pago debe estar entre 1 y 240 horas.");
  if (!inRange(input.reopenExtensionHours, 1, 720)) throw new DomainError("CONFIG", "La extensión al reabrir debe estar entre 1 y 720 horas.");
  if (!inRange(input.expiredDecisionHours, 1, 720)) throw new DomainError("CONFIG", "La ventana de decisión debe estar entre 1 y 720 horas.");
  await withTx(async (tx) => {
    const before = await getPlatformConfig(tx);
    await tx.platformConfig.update({ where: { id: 1 }, data: { ...input, updatedById: actor.id } });
    await audit(tx, actor, {
      action: "config.operativa",
      entityType: "CONFIG",
      entityId: "1",
      summary: "Cambio de plazos y reglas operativas",
      before: {
        paymentWindowHours: before.paymentWindowHours,
        unpaidRule: before.unpaidRule,
        reopenExtensionHours: before.reopenExtensionHours,
        expiredDecisionHours: before.expiredDecisionHours,
        poolApprovalRequired: before.poolApprovalRequired,
      },
      after: input,
    });
  });
}
