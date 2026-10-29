import { randomUUID } from "node:crypto";
import { cuitCheckDigit } from "@/domain/cuit";
import { db } from "@/server/db";
import type { UserActor } from "@/server/services/actor";
import type { PoolFormInput } from "@/server/services/pools";

/** Genera un CUIT válido (y prácticamente único) para tests. */
export function fakeCuit(prefix = "30"): string {
  for (;;) {
    const body = prefix + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const dv = cuitCheckDigit(body);
    if (dv !== null) return `${body}${dv}`;
  }
}

export async function ensureGeo() {
  const province = await db.province.upsert({ where: { id: 2 }, create: { id: 2, name: "Ciudad Autónoma de Buenos Aires" }, update: {} });
  const other = await db.province.upsert({ where: { id: 14 }, create: { id: 14, name: "Córdoba" }, update: {} });
  const locality = await db.locality.upsert({
    where: { provinceId_name: { provinceId: 2, name: "Palermo" } },
    create: { provinceId: 2, name: "Palermo" },
    update: {},
  });
  const otherLocality = await db.locality.upsert({
    where: { provinceId_name: { provinceId: 14, name: "Córdoba Capital" } },
    create: { provinceId: 14, name: "Córdoba Capital" },
    update: {},
  });
  await db.platformConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  return { province, other, locality, otherLocality };
}

export async function ensureCategory(name = "Bebidas", commissionBps: number | null = null) {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return db.category.upsert({ where: { slug }, create: { name, slug, commissionBps }, update: { commissionBps } });
}

export async function createUserWithBusiness(
  role: "ADMIN" | "PREVENTISTA" | "COMERCIO",
  opts: { provinceId?: number; localityId?: number; approved?: boolean; name?: string } = {},
): Promise<UserActor> {
  const geo = await ensureGeo();
  const id = randomUUID().slice(0, 8);
  const user = await db.user.create({
    data: {
      email: `${role.toLowerCase()}-${id}@test.pedila`,
      name: opts.name ?? `${role} ${id}`,
      role,
      passwordHash: "x",
    },
  });
  if (role === "ADMIN") return { id: user.id, role, businessId: null };
  const business = await db.business.create({
    data: {
      userId: user.id,
      legalName: `${opts.name ?? role} ${id} SRL`,
      tradeName: `${opts.name ?? role} ${id}`,
      cuit: fakeCuit(role === "PREVENTISTA" ? "30" : "20"),
      ivaCondition: "MONOTRIBUTO",
      street: "Av. Siempreviva",
      streetNumber: "742",
      provinceId: opts.provinceId ?? geo.province.id,
      localityId: opts.localityId ?? geo.locality.id,
      distributorStatus: role === "PREVENTISTA" ? (opts.approved === false ? "PENDIENTE" : "APROBADO") : null,
      coverage: role === "PREVENTISTA" ? { create: [{ provinceId: geo.province.id }] } : undefined,
    },
  });
  return { id: user.id, role, businessId: business.id };
}

export async function createProduct(distributor: UserActor, categoryId: string) {
  return db.product.create({
    data: {
      distributorId: distributor.businessId!,
      categoryId,
      name: "Gaseosa cola 2,25 L",
      sku: `SKU-${randomUUID().slice(0, 8)}`,
      priceCents: 150_000n,
      retailPriceCents: 199_900n,
    },
  });
}

export function poolInput(productId: string, overrides: Partial<PoolFormInput> = {}): PoolFormInput {
  return {
    productId,
    title: "Pallet gaseosa cola x 600",
    description: null,
    priceInputCents: 150_000,
    retailUnitPriceCents: 199_900,
    totalUnits: 600,
    minUnitsToClose: 480,
    minPerCommerce: 10,
    maxPerCommerce: 120,
    closeOnMinimum: true,
    deadlineAt: new Date(Date.now() + 3 * 86_400_000),
    estimatedDeliveryAt: new Date(Date.now() + 6 * 86_400_000),
    zones: [{ provinceId: 2, localityId: null }],
    ...overrides,
  };
}

export async function setConfig(data: Parameters<typeof db.platformConfig.update>[0]["data"]) {
  await db.platformConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  await db.platformConfig.update({ where: { id: 1 }, data });
}
