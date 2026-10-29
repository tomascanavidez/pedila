import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { IvaCondition, Role, UserStatus } from "@/generated/prisma/enums";
import { normalizeCuit } from "@/domain/cuit";
import { DomainError, FieldErrors } from "@/domain/errors";
import { normalizeZones, type ZoneRef } from "@/domain/zones";
import { audit, SYSTEM_ACTOR } from "../audit";
import { db } from "../db";
import { getEnv } from "../env";
import { enqueue } from "../jobs/queue";
import { adminUserIds, NOTIFICATION_TYPES, notify } from "../notifications/notify";
import { renderEmail } from "../notifications/templates";
import { withTx, type Tx } from "../tx";
import type { UserActor } from "./actor";

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export interface BusinessInput {
  legalName: string;
  tradeName: string;
  cuit: string;
  ivaCondition: IvaCondition;
  street: string;
  streetNumber: string;
  floorApt: string | null;
  postalCode: string | null;
  provinceId: number;
  localityId: number;
  phone: string | null;
  description: string | null;
  coverage: ZoneRef[];
}

async function assertLocation(tx: Tx, provinceId: number, localityId: number) {
  const loc = await tx.locality.findUnique({ where: { id: localityId } });
  if (!loc || loc.provinceId !== provinceId) throw new FieldErrors({ localityId: "Elegí una localidad de la provincia seleccionada." });
}

async function createBusinessInTx(tx: Tx, userId: string, role: Role, input: BusinessInput) {
  await assertLocation(tx, input.provinceId, input.localityId);
  const cuit = normalizeCuit(input.cuit);
  if (await tx.business.findUnique({ where: { cuit } })) {
    throw new FieldErrors({ cuit: "Ya hay un negocio registrado con ese CUIT." });
  }
  const coverage = role === "PREVENTISTA" ? normalizeZones(input.coverage) : [];
  if (role === "PREVENTISTA" && coverage.length === 0) {
    throw new FieldErrors({ coverage: "Indicá al menos una zona donde repartís." });
  }
  return tx.business.create({
    data: {
      userId,
      legalName: input.legalName,
      tradeName: input.tradeName,
      cuit,
      ivaCondition: input.ivaCondition,
      street: input.street,
      streetNumber: input.streetNumber,
      floorApt: input.floorApt,
      postalCode: input.postalCode,
      provinceId: input.provinceId,
      localityId: input.localityId,
      phone: input.phone,
      description: input.description,
      distributorStatus: role === "PREVENTISTA" ? "PENDIENTE" : null,
      coverage: coverage.length ? { create: coverage } : undefined,
    },
  });
}

async function notifyNewDistributor(tx: Tx, tradeName: string) {
  await notify(tx, {
    userIds: await adminUserIds(tx),
    type: NOTIFICATION_TYPES.PREVENTISTA_PENDIENTE,
    title: "Nuevo preventista para aprobar",
    body: `${tradeName} se registró y espera aprobación para publicar.`,
    link: "/admin/preventistas",
  });
}

export interface RegisterInput {
  role: "COMERCIO" | "PREVENTISTA";
  name: string;
  email: string;
  password: string;
  phone: string | null;
  business: BusinessInput;
}

export async function registerUser(input: RegisterInput, ip: string | null): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  return withTx(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) {
      throw new FieldErrors({ email: "Ya existe una cuenta con ese email. Ingresá o recuperá tu contraseña." });
    }
    const user = await tx.user.create({
      data: { email, name: input.name, phone: input.phone, passwordHash, role: input.role },
    });
    const business = await createBusinessInTx(tx, user.id, input.role, input.business);
    await audit(tx, { id: user.id, role: input.role, ip }, {
      action: "usuario.registro",
      entityType: "USER",
      entityId: user.id,
      summary: `${input.role} ${business.tradeName}`,
    });
    if (input.role === "PREVENTISTA") await notifyNewDistributor(tx, business.tradeName);
    return { userId: user.id };
  });
}

/** Para usuarios que entraron con Google y todavía no cargaron su negocio. */
export async function completeProfile(userId: string, role: "COMERCIO" | "PREVENTISTA", phone: string | null, business: BusinessInput) {
  await withTx(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { business: true } });
    if (user.business) throw new DomainError("YA_COMPLETO", "Tu perfil ya está completo.");
    if (user.role === "ADMIN") throw new DomainError("NO_APLICA", "Los administradores no tienen negocio.");
    await tx.user.update({ where: { id: userId }, data: { role, phone } });
    const b = await createBusinessInTx(tx, userId, role, business);
    await audit(tx, { id: userId, role }, { action: "usuario.perfil_completo", entityType: "USER", entityId: userId, summary: b.tradeName });
    if (role === "PREVENTISTA") await notifyNewDistributor(tx, b.tradeName);
  });
}

export async function updateBusinessProfile(actor: UserActor, input: Omit<BusinessInput, "cuit"> & { name: string; phone: string | null }) {
  if (!actor.businessId) throw new DomainError("PERFIL_INCOMPLETO", "No tenés un negocio cargado.");
  await withTx(async (tx) => {
    await assertLocation(tx, input.provinceId, input.localityId);
    const before = await tx.business.findUniqueOrThrow({ where: { id: actor.businessId! } });
    await tx.user.update({ where: { id: actor.id }, data: { name: input.name, phone: input.phone } });
    await tx.business.update({
      where: { id: actor.businessId! },
      data: {
        legalName: input.legalName,
        tradeName: input.tradeName,
        ivaCondition: input.ivaCondition,
        street: input.street,
        streetNumber: input.streetNumber,
        floorApt: input.floorApt,
        postalCode: input.postalCode,
        provinceId: input.provinceId,
        localityId: input.localityId,
        phone: input.phone,
        description: input.description,
      },
    });
    if (actor.role === "PREVENTISTA") {
      const coverage = normalizeZones(input.coverage);
      if (coverage.length === 0) throw new FieldErrors({ coverage: "Indicá al menos una zona donde repartís." });
      await tx.distributorCoverage.deleteMany({ where: { businessId: actor.businessId! } });
      await tx.distributorCoverage.createMany({ data: coverage.map((z) => ({ ...z, businessId: actor.businessId! })) });
    }
    await audit(tx, actor, {
      action: "negocio.editar",
      entityType: "BUSINESS",
      entityId: actor.businessId!,
      summary: input.tradeName,
      before: { tradeName: before.tradeName, localityId: before.localityId },
      after: { tradeName: input.tradeName, localityId: input.localityId },
    });
  });
}

export async function reviewDistributor(actor: UserActor, businessId: string, approve: boolean, reason: string | null) {
  await withTx(async (tx) => {
    const b = await tx.business.findUnique({ where: { id: businessId }, include: { user: true } });
    if (!b || b.user.role !== "PREVENTISTA") throw new DomainError("NO_ENCONTRADO", "Preventista inexistente.");
    await tx.business.update({
      where: { id: businessId },
      data: approve
        ? { distributorStatus: "APROBADO", approvedAt: new Date(), approvedById: actor.id, rejectionReason: null }
        : { distributorStatus: "RECHAZADO", rejectionReason: reason?.slice(0, 500) ?? null },
    });
    await audit(tx, actor, {
      action: approve ? "preventista.aprobar" : "preventista.rechazar",
      entityType: "BUSINESS",
      entityId: businessId,
      summary: `${b.tradeName}${reason ? `: ${reason}` : ""}`,
      before: { distributorStatus: b.distributorStatus },
      after: { distributorStatus: approve ? "APROBADO" : "RECHAZADO" },
    });
    await notify(tx, {
      userIds: [b.userId],
      type: approve ? NOTIFICATION_TYPES.CUENTA_APROBADA : NOTIFICATION_TYPES.CUENTA_RECHAZADA,
      title: approve ? "¡Tu cuenta de preventista fue aprobada!" : "Tu cuenta de preventista no fue aprobada",
      body: approve
        ? "Ya podés cargar tu catálogo y publicar pools de compra."
        : `Motivo: ${reason ?? "sin detalle"}. Escribinos si necesitás más información.`,
      link: "/preventista",
    });
  });
}

export async function setUserStatus(actor: UserActor, userId: string, status: UserStatus) {
  if (actor.id === userId) throw new DomainError("NO_PERMITIDO", "No podés cambiar el estado de tu propia cuenta.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("NO_ENCONTRADO", "Usuario inexistente.");
  await db.user.update({ where: { id: userId }, data: { status } });
  await audit(db, actor, {
    action: status === "SUSPENDIDO" ? "usuario.suspender" : "usuario.reactivar",
    entityType: "USER",
    entityId: userId,
    summary: user.email,
  });
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Siempre responde igual exista o no el email (no revela qué cuentas existen). */
export async function requestPasswordReset(emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVO") return;
  const token = randomBytes(32).toString("base64url");
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) },
  });
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  const content = renderEmail({
    title: "Recuperá tu contraseña",
    body: "Recibimos un pedido para cambiar tu contraseña de PEDILA. El link vence en 1 hora. Si no fuiste vos, ignorá este correo.",
    ctaLabel: "Elegir una contraseña nueva",
    ctaUrl: `${appUrl}/recuperar/${token}`,
    appUrl,
  });
  await enqueue(db, "SEND_EMAIL", { to: user.email, ...content });
  await audit(db, SYSTEM_ACTOR, { action: "usuario.reset_solicitado", entityType: "USER", entityId: user.id });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new DomainError("TOKEN_INVALIDO", "El link venció o ya se usó. Pedí uno nuevo.");
  }
  const passwordHash = await hashPassword(newPassword);
  await withTx(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } });
    await audit(tx, { id: record.userId, role: null }, { action: "usuario.reset_completado", entityType: "USER", entityId: record.userId });
  });
}

export async function changePassword(actor: UserActor, current: string, next: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) {
    throw new FieldErrors({ current: "La contraseña actual no coincide." });
  }
  await db.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(next) } });
  await audit(db, actor, { action: "usuario.cambio_clave", entityType: "USER", entityId: actor.id });
}
