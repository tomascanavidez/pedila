import "server-only";
import { unstable_cache } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import type { PoolStatus, SaleUnit } from "@/generated/prisma/enums";
import { computeSavings } from "@/domain/commission";
import { toCents } from "@/domain/money";
import { computeProgress, type Progress } from "@/domain/pool-rules";
import { db } from "../db";
import { uploadUrl } from "../storage/storage";

/**
 * Consultas de páginas públicas. Se cachean con unstable_cache (TTL corto + tags) y
 * devuelven objetos planos (fechas como ISO string) porque el caché serializa a JSON.
 */
export const PUBLIC_POOL_TAG = "pools";

export interface PoolCardDTO {
  id: string;
  title: string;
  productName: string;
  brand: string | null;
  categoryName: string;
  categorySlug: string;
  distributorId: string;
  distributorName: string;
  ratingAvg: number | null;
  ratingCount: number;
  unitPriceCents: number;
  retailUnitPriceCents: number;
  savingBps: number;
  saleUnit: SaleUnit;
  unitsPerPack: number;
  totalUnits: number;
  minUnitsToClose: number;
  committedUnits: number;
  minPerCommerce: number;
  deadlineAt: string;
  status: PoolStatus;
  closed: boolean;
  featured: boolean;
  zonesLabel: string;
  imageUrl: string | null;
}

export type PoolSort = "destacados" | "cierra-pronto" | "mayor-ahorro" | "nuevos";

export interface PoolFilters {
  provinceId?: number;
  localityId?: number;
  category?: string;
  sort?: PoolSort;
  q?: string;
  distributorId?: string;
}

const poolCardInclude = {
  product: { select: { name: true, brand: true, unitsPerPack: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { thumbKey: true } } } },
  category: { select: { name: true, slug: true } },
  distributor: { select: { id: true, tradeName: true, ratingAvg: true, ratingCount: true } },
  zones: { include: { province: { select: { name: true } }, locality: { select: { name: true } } } },
} satisfies Prisma.PoolInclude;

type PoolWithCard = Prisma.PoolGetPayload<{ include: typeof poolCardInclude }>;

function zonesLabel(zones: PoolWithCard["zones"]): string {
  const names = zones.map((z) => (z.locality ? z.locality.name : `Toda ${z.province.name}`));
  if (names.length <= 2) return names.join(" y ");
  return `${names.slice(0, 2).join(", ")} y ${names.length - 2} más`;
}

export function toPoolCard(p: PoolWithCard): PoolCardDTO {
  const unit = toCents(p.unitPriceCents);
  const retail = toCents(p.retailUnitPriceCents);
  return {
    id: p.id,
    title: p.title,
    productName: p.product.name,
    brand: p.product.brand,
    categoryName: p.category.name,
    categorySlug: p.category.slug,
    distributorId: p.distributor.id,
    distributorName: p.distributor.tradeName,
    ratingAvg: p.distributor.ratingAvg,
    ratingCount: p.distributor.ratingCount,
    unitPriceCents: unit,
    retailUnitPriceCents: retail,
    savingBps: computeSavings(unit, retail).savingBps,
    saleUnit: p.saleUnit,
    unitsPerPack: p.product.unitsPerPack,
    totalUnits: p.totalUnits,
    minUnitsToClose: p.minUnitsToClose,
    committedUnits: p.committedUnits,
    minPerCommerce: p.minPerCommerce,
    deadlineAt: p.deadlineAt.toISOString(),
    status: p.status,
    closed: p.closedAt !== null,
    featured: p.featured,
    zonesLabel: zonesLabel(p.zones),
    imageUrl: uploadUrl(p.product.images[0]?.thumbKey),
  };
}

async function queryOpenPools(f: PoolFilters): Promise<PoolCardDTO[]> {
  const and: Prisma.PoolWhereInput[] = [
    { OR: [{ status: "ABIERTO" }, { status: "COMPLETO", closedAt: null }] },
    { deadlineAt: { gt: new Date() } },
  ];
  if (f.category) and.push({ category: { slug: f.category } });
  if (f.distributorId) and.push({ distributorId: f.distributorId });
  if (f.q) {
    and.push({ OR: [{ title: { contains: f.q } }, { product: { name: { contains: f.q } } }, { product: { brand: { contains: f.q } } }] });
  }
  if (f.provinceId) {
    // Un pool llega a una localidad si la incluye o si cubre toda la provincia.
    and.push({
      zones: {
        some: f.localityId
          ? { provinceId: f.provinceId, OR: [{ localityId: null }, { localityId: f.localityId }] }
          : { provinceId: f.provinceId },
      },
    });
  }
  const where: Prisma.PoolWhereInput = { AND: and };
  const orderBy: Prisma.PoolOrderByWithRelationInput[] =
    f.sort === "cierra-pronto"
      ? [{ deadlineAt: "asc" }]
      : f.sort === "nuevos"
        ? [{ publishedAt: "desc" }]
        : [{ featured: "desc" }, { deadlineAt: "asc" }];
  const rows = await db.pool.findMany({ where, orderBy, take: 60, include: poolCardInclude });
  const cards = rows.map(toPoolCard);
  if (f.sort === "mayor-ahorro") cards.sort((a, b) => b.savingBps - a.savingBps);
  return cards;
}

export const listOpenPools = unstable_cache(queryOpenPools, ["open-pools"], { revalidate: 30, tags: [PUBLIC_POOL_TAG] });

export interface PoolDetailDTO extends PoolCardDTO {
  description: string | null;
  maxPerCommerce: number;
  closeOnMinimum: boolean;
  estimatedDeliveryAt: string | null;
  scheduledDeliveryAt: string | null;
  paymentWindowHours: number;
  zones: { provinceId: number; localityId: number | null; label: string }[];
  images: { url: string; thumbUrl: string; width: number; height: number }[];
  sku: string;
  ean: string | null;
  productDescription: string | null;
  distributorLocality: string;
  distributorProvince: string;
  publishedAt: string | null;
}

async function queryPoolDetail(id: string): Promise<PoolDetailDTO | null> {
  const p = await db.pool.findUnique({
    where: { id },
    include: {
      ...poolCardInclude,
      product: {
        select: {
          name: true,
          brand: true,
          sku: true,
          ean: true,
          description: true,
          unitsPerPack: true,
          images: { orderBy: { sortOrder: "asc" }, select: { key: true, thumbKey: true, width: true, height: true } },
        },
      },
      distributor: {
        select: {
          id: true,
          tradeName: true,
          ratingAvg: true,
          ratingCount: true,
          locality: { select: { name: true } },
          province: { select: { name: true } },
        },
      },
    },
  });
  if (!p || p.status === "BORRADOR" || p.status === "PENDIENTE_APROBACION") return null;
  const card = toPoolCard({
    ...p,
    product: { ...p.product, images: p.product.images.map((i) => ({ thumbKey: i.thumbKey })) },
  });
  return {
    ...card,
    description: p.description,
    maxPerCommerce: p.maxPerCommerce,
    closeOnMinimum: p.closeOnMinimum,
    estimatedDeliveryAt: p.estimatedDeliveryAt?.toISOString() ?? null,
    scheduledDeliveryAt: p.scheduledDeliveryAt?.toISOString() ?? null,
    paymentWindowHours: p.paymentWindowHours,
    zones: p.zones.map((z) => ({
      provinceId: z.provinceId,
      localityId: z.localityId,
      label: z.locality ? `${z.locality.name} (${z.province.name})` : `Toda la provincia de ${z.province.name}`,
    })),
    images: p.product.images.map((i) => ({ url: uploadUrl(i.key)!, thumbUrl: uploadUrl(i.thumbKey)!, width: i.width, height: i.height })),
    sku: p.product.sku,
    ean: p.product.ean,
    productDescription: p.product.description,
    distributorLocality: p.distributor.locality.name,
    distributorProvince: p.distributor.province.name,
    publishedAt: p.publishedAt?.toISOString() ?? null,
  };
}

export const getPoolDetail = unstable_cache(queryPoolDetail, ["pool-detail"], { revalidate: 60, tags: [PUBLIC_POOL_TAG] });

export interface ProgressDTO extends Progress {
  status: PoolStatus;
  closed: boolean;
  deadlineAt: string;
  acceptingJoins: boolean;
}

// Micro-caché en memoria (2 s) para que muchos navegadores consultando el progreso
// no generen una consulta a MySQL cada uno.
const progressCache = new Map<string, { at: number; value: ProgressDTO | null }>();

export async function getPoolProgress(id: string): Promise<ProgressDTO | null> {
  const hit = progressCache.get(id);
  if (hit && Date.now() - hit.at < 2_000) return hit.value;
  const p = await db.pool.findUnique({
    where: { id },
    select: { status: true, committedUnits: true, minUnitsToClose: true, totalUnits: true, closedAt: true, deadlineAt: true },
  });
  const value: ProgressDTO | null =
    p && p.status !== "BORRADOR" && p.status !== "PENDIENTE_APROBACION"
      ? {
          ...computeProgress(p.committedUnits, p.minUnitsToClose, p.totalUnits),
          status: p.status,
          closed: p.closedAt !== null,
          deadlineAt: p.deadlineAt.toISOString(),
          acceptingJoins:
            (p.status === "ABIERTO" || (p.status === "COMPLETO" && p.closedAt === null)) && p.deadlineAt.getTime() > Date.now(),
        }
      : null;
  if (progressCache.size > 5_000) progressCache.clear();
  progressCache.set(id, { at: Date.now(), value });
  return value;
}

export const listCategories = unstable_cache(
  () => db.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, icon: true } }),
  ["categories"],
  { revalidate: 300, tags: ["categories"] },
);

export const listGeo = unstable_cache(
  async () => {
    const provinces = await db.province.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, localities: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
    });
    return provinces;
  },
  ["geo"],
  { revalidate: 600, tags: ["geo"] },
);

export type GeoTree = Awaited<ReturnType<typeof listGeo>>;

export interface CatalogFilters {
  category?: string;
  distributorId?: string;
  q?: string;
  page?: number;
}

export const listCatalog = unstable_cache(
  async (f: CatalogFilters) => {
    const pageSize = 24;
    const page = Math.max(1, f.page ?? 1);
    const where: Prisma.ProductWhereInput = {
      active: true,
      distributor: { distributorStatus: "APROBADO", user: { status: "ACTIVO" } },
      ...(f.category ? { category: { slug: f.category } } : {}),
      ...(f.distributorId ? { distributorId: f.distributorId } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q } }, { brand: { contains: f.q } }, { sku: { contains: f.q } }, { ean: f.q }] } : {}),
    };
    const [total, rows] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({
        where,
        orderBy: [{ name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { name: true, slug: true, commissionBps: true } },
          distributor: { select: { id: true, tradeName: true, ratingAvg: true, ratingCount: true, commissionBps: true } },
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { thumbKey: true } },
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        sku: p.sku,
        saleUnit: p.saleUnit,
        unitsPerPack: p.unitsPerPack,
        priceCents: toCents(p.priceCents),
        retailPriceCents: p.retailPriceCents === null ? null : toCents(p.retailPriceCents),
        minOrderQty: p.minOrderQty,
        categoryId: p.categoryId,
        categoryName: p.category.name,
        distributorId: p.distributor.id,
        distributorName: p.distributor.tradeName,
        ratingAvg: p.distributor.ratingAvg,
        categoryBps: p.category.commissionBps,
        distributorBps: p.distributor.commissionBps,
        imageUrl: uploadUrl(p.images[0]?.thumbKey),
      })),
    };
  },
  ["catalog"],
  { revalidate: 60, tags: ["catalog"] },
);

export const listApprovedDistributors = unstable_cache(
  () =>
    db.business.findMany({
      where: { distributorStatus: "APROBADO", user: { status: "ACTIVO" } },
      orderBy: { tradeName: "asc" },
      select: { id: true, tradeName: true },
    }),
  ["distributors-list"],
  { revalidate: 300, tags: ["distributors"] },
);

export const getDistributorPublic = unstable_cache(
  async (id: string) => {
    const b = await db.business.findUnique({
      where: { id },
      include: {
        user: { select: { role: true, status: true } },
        locality: { select: { name: true } },
        province: { select: { name: true } },
        coverage: { include: { province: { select: { name: true } }, locality: { select: { name: true } } } },
        ratingsReceived: { orderBy: { createdAt: "desc" }, take: 10, include: { commerce: { select: { tradeName: true } } } },
      },
    });
    if (!b || b.user.role !== "PREVENTISTA" || b.distributorStatus !== "APROBADO" || b.user.status !== "ACTIVO") return null;
    return {
      id: b.id,
      tradeName: b.tradeName,
      description: b.description,
      location: `${b.locality.name}, ${b.province.name}`,
      ratingAvg: b.ratingAvg,
      ratingCount: b.ratingCount,
      since: b.createdAt.toISOString(),
      coverage: b.coverage.map((c) => (c.locality ? `${c.locality.name} (${c.province.name})` : `Toda ${c.province.name}`)),
      ratings: b.ratingsReceived.map((r) => ({
        stars: r.stars,
        comment: r.comment,
        commerce: r.commerce.tradeName,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  },
  ["distributor-public"],
  { revalidate: 120, tags: ["distributors"] },
);
