/**
 * Datos demo de PEDILA.
 *   npm run db:seed
 *
 * - No borra nada: si la base ya tiene usuarios, no hace cambios (para recargar el demo
 *   desde cero usá `npm run db:reset`, que recrea la base y vuelve a correr este seed).
 * - Corre en una sola transacción: si algo falla, no queda nada a medias.
 * - Los montos se calculan con las mismas funciones de dominio que usa la app.
 *
 * Credenciales demo (ver README): admin@pedila.com.ar / Pedila2026!  ·  resto: Demo2026!
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { ParticipationStatus, PoolStatus, SaleUnit } from "../src/generated/prisma/enums";
import { computeLine, computeUnitPricing, resolveCommission } from "../src/domain/commission";
import { cuitCheckDigit } from "../src/domain/cuit";
import { PROVINCES } from "./data/geo";

type Tx = Prisma.TransactionClient;

const url = new URL(process.env.DATABASE_URL ?? "");
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectionLimit: 2,
    allowPublicKeyRetrieval: true,
    initSql: "SET time_zone = '+00:00'",
  }),
});

const NOW = new Date();
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const days = (d: number) => hours(d * 24);
const pesos = (n: number) => Math.round(n * 100);

const GLOBAL_BPS = 800;
const ADMIN_PASSWORD = "Pedila2026!";
const DEMO_PASSWORD = "Demo2026!";

let cuitSeq = 10_000_000;
function cuit(prefix: "20" | "27" | "30" | "33"): string {
  for (;;) {
    const body = `${prefix}${String(cuitSeq++).padStart(8, "0")}`;
    const dv = cuitCheckDigit(body);
    if (dv !== null) return `${body}${dv}`;
  }
}

let eanSeq = 1_000;
function ean(): string {
  const body = `779${String(4_500_000 + eanSeq++).padStart(9, "0")}`;
  const digits = body.split("").map(Number).reverse();
  const sum = digits.reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Imagen ilustrativa (amarillo/negro) para cada producto demo, en WebP como las subidas reales. */
async function productImage(sku: string, name: string, category: string): Promise<{ key: string; thumbKey: string } | null> {
  try {
    const words = name.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const w of words) {
      if ((current + " " + w).trim().length > 16) {
        lines.push(current.trim());
        current = w;
      } else current += ` ${w}`;
    }
    if (current.trim()) lines.push(current.trim());
    const text = lines
      .slice(0, 4)
      .map((l, i) => `<text x="60" y="${330 + i * 78}" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="900" fill="#111111">${escapeXml(l)}</text>`)
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
      <rect width="800" height="800" fill="#FFF7CC"/>
      <rect x="24" y="24" width="752" height="752" rx="48" fill="none" stroke="#111111" stroke-width="12"/>
      <rect x="60" y="80" width="${Math.min(640, 40 + category.length * 26)}" height="84" rx="42" fill="#FFD600" stroke="#111111" stroke-width="6"/>
      <text x="90" y="138" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#111111">${escapeXml(category)}</text>
      ${text}
      <text x="60" y="730" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="900" fill="#111111">PEDILA.</text>
    </svg>`;
    const dir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads", "products/demo");
    await mkdir(dir, { recursive: true });
    const base = sharp(Buffer.from(svg));
    await writeFile(path.join(dir, `${sku.toLowerCase()}.webp`), await base.clone().resize(800).webp({ quality: 80 }).toBuffer());
    await writeFile(path.join(dir, `${sku.toLowerCase()}_thumb.webp`), await base.clone().resize(400).webp({ quality: 72 }).toBuffer());
    return { key: `products/demo/${sku.toLowerCase()}.webp`, thumbKey: `products/demo/${sku.toLowerCase()}_thumb.webp` };
  } catch (err) {
    console.warn(`  (sin imagen para ${sku}: ${(err as Error).message})`);
    return null;
  }
}

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log(`La base ya tiene ${existing} usuarios: el seed no hace cambios.`);
    console.log("Para recargar el demo desde cero: npm run db:reset  (borra TODOS los datos de esa base)");
    return;
  }
  console.log("Cargando datos demo de PEDILA…");
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await prisma.$transaction(
    async (tx) => {
      await seedAll(tx, { adminHash, demoHash });
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
  console.log("Listo. Credenciales en el README (sección Instalación local).");
}

interface SeedCtx {
  adminHash: string;
  demoHash: string;
}

async function seedAll(tx: Tx, ctx: SeedCtx) {
  // --- Configuración -----------------------------------------------------------
  await tx.platformConfig.create({
    data: {
      id: 1,
      globalCommissionBps: GLOBAL_BPS,
      commissionMode: "DESCONTAR_AL_PREVENTISTA",
      paymentWindowHours: 48,
      unpaidRule: "REABRIR",
      reopenExtensionHours: 48,
      expiredDecisionHours: 48,
      poolApprovalRequired: false,
    },
  });

  // --- Geografía ---------------------------------------------------------------
  for (const p of PROVINCES) {
    await tx.province.create({ data: { id: p.id, name: p.name } });
    await tx.locality.createMany({ data: p.localities.map((name) => ({ provinceId: p.id, name })) });
  }
  const localities = await tx.locality.findMany();
  const loc = (provinceId: number, name: string) => {
    const l = localities.find((x) => x.provinceId === provinceId && x.name === name);
    if (!l) throw new Error(`Localidad inexistente: ${name}`);
    return l.id;
  };
  const CABA = 2;
  const BA = 6;
  const CBA = 14;
  const SF = 82;

  // --- Categorías --------------------------------------------------------------
  const catData = [
    { name: "Bebidas", slug: "bebidas", icon: "bebidas", sortOrder: 1, commissionBps: 600 },
    { name: "Golosinas y alfajores", slug: "golosinas", icon: "golosinas", sortOrder: 2 },
    { name: "Galletitas y snacks", slug: "galletitas-snacks", icon: "snacks", sortOrder: 3 },
    { name: "Almacén", slug: "almacen", icon: "almacen", sortOrder: 4 },
    { name: "Infusiones", slug: "infusiones", icon: "infusiones", sortOrder: 5 },
    { name: "Limpieza", slug: "limpieza", icon: "limpieza", sortOrder: 6 },
    { name: "Perfumería e higiene", slug: "perfumeria", icon: "perfumeria", sortOrder: 7 },
  ];
  const cats: Record<string, { id: string; name: string; commissionBps: number | null }> = {};
  for (const c of catData) {
    const created = await tx.category.create({ data: c });
    cats[c.slug] = { id: created.id, name: created.name, commissionBps: created.commissionBps };
  }

  // --- Usuarios ----------------------------------------------------------------
  const admin = await tx.user.create({
    data: { email: "admin@pedila.com.ar", name: "Equipo PEDILA", role: "ADMIN", passwordHash: ctx.adminHash, lastLoginAt: hours(-2) },
  });

  async function distributor(i: number, d: {
    tradeName: string; legalName: string; name: string; provinceId: number; locality: string; street: string; number: string;
    status: "APROBADO" | "PENDIENTE"; commissionBps?: number; description: string; coverage: { provinceId: number; locality?: string }[];
    createdDaysAgo: number;
  }) {
    const user = await tx.user.create({
      data: {
        email: `preventista${i}@pedila.com.ar`,
        name: d.name,
        phone: `11 4${i}00-12${i}${i}`,
        role: "PREVENTISTA",
        passwordHash: ctx.demoHash,
        createdAt: days(-d.createdDaysAgo),
      },
    });
    return tx.business.create({
      data: {
        userId: user.id,
        legalName: d.legalName,
        tradeName: d.tradeName,
        cuit: cuit("30"),
        ivaCondition: "RESPONSABLE_INSCRIPTO",
        street: d.street,
        streetNumber: d.number,
        provinceId: d.provinceId,
        localityId: loc(d.provinceId, d.locality),
        phone: user.phone,
        description: d.description,
        distributorStatus: d.status,
        approvedAt: d.status === "APROBADO" ? days(-d.createdDaysAgo + 1) : null,
        approvedById: d.status === "APROBADO" ? admin.id : null,
        commissionBps: d.commissionBps ?? null,
        createdAt: days(-d.createdDaysAgo),
        coverage: {
          create: d.coverage.map((c) => ({ provinceId: c.provinceId, localityId: c.locality ? loc(c.provinceId, c.locality) : null })),
        },
      },
    });
  }

  const delSur = await distributor(1, {
    tradeName: "Distribuidora Del Sur",
    legalName: "Distribuidora Del Sur S.R.L.",
    name: "Marcela Gómez",
    provinceId: CABA,
    locality: "Parque Patricios",
    street: "Av. Caseros",
    number: "3120",
    status: "APROBADO",
    description: "Bebidas, almacén y limpieza para kioscos y despensas de CABA y zona sur. Reparto de lunes a sábado.",
    coverage: [{ provinceId: CABA }, { provinceId: BA, locality: "Avellaneda" }, { provinceId: BA, locality: "Lanús" }, { provinceId: BA, locality: "Lomas de Zamora" }, { provinceId: BA, locality: "Quilmes" }],
    createdDaysAgo: 120,
  });
  const mediterraneo = await distributor(2, {
    tradeName: "Mayorista Mediterráneo",
    legalName: "Mediterráneo Alimentos S.A.",
    name: "Javier Ferreyra",
    provinceId: CBA,
    locality: "Córdoba Capital",
    street: "Av. Colón",
    number: "4580",
    status: "APROBADO",
    commissionBps: 750,
    description: "Golosinas, bebidas y regionales cordobeses. Entregas en Córdoba Capital y alrededores.",
    coverage: [{ provinceId: CBA }],
    createdDaysAgo: 90,
  });
  await distributor(3, {
    tradeName: "Preventa Litoral",
    legalName: "Litoral Preventa S.A.S.",
    name: "Lucía Benítez",
    provinceId: SF,
    locality: "Rosario",
    street: "Bv. Oroño",
    number: "1550",
    status: "PENDIENTE",
    description: "Preventa de almacén y limpieza para Rosario y Gran Rosario.",
    coverage: [{ provinceId: SF }],
    createdDaysAgo: 1,
  });

  const commerceData = [
    { trade: "Kiosco La Esquina", legal: "Pérez Martín Ezequiel", name: "Martín Pérez", p: CABA, l: "Palermo", street: "Gorriti", n: "4890" },
    { trade: "Despensa Don Tito", legal: "Romano Héctor Alberto", name: "Héctor Romano", p: CABA, l: "Caballito", street: "Av. Rivadavia", n: "5120" },
    { trade: "Almacén Rosita", legal: "Fernández Rosa Inés", name: "Rosa Fernández", p: CABA, l: "Flores", street: "Av. Avellaneda", n: "2730" },
    { trade: "Maxikiosco 24 h", legal: "Maxi 24 S.R.L.", name: "Carla Ibáñez", p: CABA, l: "Almagro", street: "Av. Corrientes", n: "4011" },
    { trade: "Minimercado El Sol", legal: "Chen Wei", name: "Wei Chen", p: CABA, l: "Belgrano", street: "Av. Cabildo", n: "2201" },
    { trade: "Kiosco Lanús Centro", legal: "Ríos Daniela Soledad", name: "Daniela Ríos", p: BA, l: "Lanús", street: "9 de Julio", n: "1180" },
    { trade: "Despensa La Avellaneda", legal: "Sosa Jorge Luis", name: "Jorge Sosa", p: BA, l: "Avellaneda", street: "Av. Mitre", n: "980" },
    { trade: "Almacén Quilmes Oeste", legal: "Domínguez Silvia", name: "Silvia Domínguez", p: BA, l: "Quilmes", street: "Av. Calchaquí", n: "1450" },
    { trade: "Kiosco Nueva Córdoba", legal: "Paz Agustín", name: "Agustín Paz", p: CBA, l: "Córdoba Capital", street: "Obispo Trejo", n: "760" },
    { trade: "Despensa Güemes", legal: "Ledesma Natalia", name: "Natalia Ledesma", p: CBA, l: "Córdoba Capital", street: "Belgrano", n: "640" },
  ];
  const commerces: { id: string; userId: string; tradeName: string }[] = [];
  for (const [i, c] of commerceData.entries()) {
    const user = await tx.user.create({
      data: {
        email: `comercio${i + 1}@pedila.com.ar`,
        name: c.name,
        phone: `11 5${i}11-20${i}${i}`,
        role: "COMERCIO",
        passwordHash: ctx.demoHash,
        createdAt: days(-60 + i * 3),
        lastLoginAt: hours(-(i + 1) * 5),
      },
    });
    const b = await tx.business.create({
      data: {
        userId: user.id,
        legalName: c.legal,
        tradeName: c.trade,
        cuit: cuit(i % 2 ? "27" : "20"),
        ivaCondition: i === 3 || i === 4 ? "RESPONSABLE_INSCRIPTO" : "MONOTRIBUTO",
        street: c.street,
        streetNumber: c.n,
        postalCode: c.p === CABA ? "C1414ABC" : c.p === CBA ? "5000" : "1824",
        provinceId: c.p,
        localityId: loc(c.p, c.l),
        phone: user.phone,
        createdAt: user.createdAt,
      },
    });
    commerces.push({ id: b.id, userId: user.id, tradeName: b.tradeName });
  }
  const C = (n: number) => commerces[n - 1]!;

  // --- Historial de comisiones -------------------------------------------------
  await tx.commissionChange.createMany({
    data: [
      { scope: "GLOBAL", targetLabel: "Comisión global", oldValue: "7 %", newValue: "8 %", changedById: admin.id, createdAt: days(-30) },
      { scope: "CATEGORIA", targetId: cats.bebidas!.id, targetLabel: "Categoría Bebidas", oldValue: "sin override", newValue: "6 %", changedById: admin.id, createdAt: days(-20) },
      { scope: "PREVENTISTA", targetId: mediterraneo.id, targetLabel: "Preventista Mayorista Mediterráneo", oldValue: "sin override", newValue: "7,5 %", changedById: admin.id, createdAt: days(-15) },
    ],
  });

  // --- Productos -----------------------------------------------------------------
  type ProductSeed = { sku: string; name: string; brand: string; cat: string; unit: SaleUnit; perPack?: number; price: number; retail: number; minQty?: number; desc?: string };
  const delSurProducts: ProductSeed[] = [
    { sku: "DS-GAS-COLA-6", name: "Gaseosa cola 2,25 L pack x 6", brand: "Coca-Cola", cat: "bebidas", unit: "BULTO", perPack: 6, price: 21_000, retail: 28_800 },
    { sku: "DS-AGUA-2L-6", name: "Agua mineral sin gas 2 L pack x 6", brand: "Villavicencio", cat: "bebidas", unit: "BULTO", perPack: 6, price: 10_500, retail: 14_400 },
    { sku: "DS-CERV-473-6", name: "Cerveza rubia lata 473 ml pack x 6", brand: "Quilmes", cat: "bebidas", unit: "BULTO", perPack: 6, price: 9_600, retail: 13_200 },
    { sku: "DS-ALF-TRI-24", name: "Alfajor triple chocolate caja x 24", brand: "Jorgito", cat: "golosinas", unit: "BULTO", perPack: 24, price: 18_500, retail: 28_800 },
    { sku: "DS-CAR-1KG", name: "Caramelos masticables surtidos 1 kg", brand: "Arcor", cat: "golosinas", unit: "UNIDAD", price: 5_400, retail: 7_900 },
    { sku: "DS-GAL-AGUA-3", name: "Galletitas de agua paquete x 3", brand: "Criollitas", cat: "galletitas-snacks", unit: "UNIDAD", price: 1_450, retail: 2_000 },
    { sku: "DS-PAPAS-145", name: "Papas fritas clásicas 145 g", brand: "Lay's", cat: "galletitas-snacks", unit: "UNIDAD", price: 2_300, retail: 3_400 },
    { sku: "DS-YERBA-1KG", name: "Yerba mate con palo 1 kg", brand: "Playadito", cat: "infusiones", unit: "UNIDAD", price: 4_200, retail: 5_600 },
    { sku: "DS-CAFE-500", name: "Café molido torrado 500 g", brand: "La Morenita", cat: "infusiones", unit: "UNIDAD", price: 8_200, retail: 11_000 },
    { sku: "DS-AZUCAR-1KG", name: "Azúcar común tipo A 1 kg", brand: "Ledesma", cat: "almacen", unit: "UNIDAD", price: 1_250, retail: 1_600 },
    { sku: "DS-ACEITE-15", name: "Aceite de girasol 1,5 L", brand: "Natura", cat: "almacen", unit: "UNIDAD", price: 3_450, retail: 4_500 },
    { sku: "DS-FIDEOS-500", name: "Fideos spaghetti 500 g", brand: "Matarazzo", cat: "almacen", unit: "UNIDAD", price: 950, retail: 1_400 },
    { sku: "DS-ARROZ-1KG", name: "Arroz largo fino 1 kg", brand: "Gallo", cat: "almacen", unit: "UNIDAD", price: 1_700, retail: 2_300 },
    { sku: "DS-LAVAN-2L", name: "Lavandina concentrada 2 L", brand: "Ayudín", cat: "limpieza", unit: "UNIDAD", price: 1_350, retail: 1_900 },
    { sku: "DS-DETER-750", name: "Detergente limón 750 ml", brand: "Magistral", cat: "limpieza", unit: "UNIDAD", price: 1_750, retail: 2_500 },
    { sku: "DS-PAPEL-4", name: "Papel higiénico doble hoja x 4 rollos", brand: "Higienol", cat: "perfumeria", unit: "UNIDAD", price: 2_250, retail: 3_300 },
    { sku: "DS-JABON-3", name: "Jabón de tocador x 3", brand: "Rexona", cat: "perfumeria", unit: "UNIDAD", price: 2_700, retail: 3_900 },
  ];
  const medProducts: ProductSeed[] = [
    { sku: "MM-LIMA-6", name: "Gaseosa lima-limón 2,25 L pack x 6", brand: "Sprite", cat: "bebidas", unit: "BULTO", perPack: 6, price: 19_500, retail: 26_400 },
    { sku: "MM-FERNET-750", name: "Fernet 750 ml", brand: "Branca", cat: "bebidas", unit: "UNIDAD", price: 11_800, retail: 15_900 },
    { sku: "MM-ALF-CBA-12", name: "Alfajor cordobés glaseado caja x 12", brand: "Havanna", cat: "golosinas", unit: "BULTO", perPack: 12, price: 9_600, retail: 14_400 },
    { sku: "MM-GAL-RELL", name: "Galletitas dulces rellenas 118 g", brand: "Oreo", cat: "galletitas-snacks", unit: "UNIDAD", price: 950, retail: 1_300 },
    { sku: "MM-YERBA-1KG", name: "Yerba mate suave 1 kg", brand: "Taragüí", cat: "infusiones", unit: "UNIDAD", price: 4_300, retail: 5_700 },
    { sku: "MM-CHICLE-20", name: "Chicles menta caja x 20", brand: "Beldent", cat: "golosinas", unit: "BULTO", perPack: 20, price: 6_100, retail: 9_000 },
  ];
  const products: Record<string, { id: string; distributorId: string; categoryId: string; saleUnit: SaleUnit; name: string }> = {};
  async function createProducts(owner: { id: string }, list: ProductSeed[]) {
    for (const p of list) {
      const prod = await tx.product.create({
        data: {
          distributorId: owner.id,
          categoryId: cats[p.cat]!.id,
          name: p.name,
          brand: p.brand,
          description: p.desc ?? `${p.name}. Precio por ${p.unit === "BULTO" ? "bulto" : "unidad"}.`,
          sku: p.sku,
          ean: ean(),
          saleUnit: p.unit,
          unitsPerPack: p.perPack ?? 1,
          priceCents: BigInt(pesos(p.price)),
          retailPriceCents: BigInt(pesos(p.retail)),
          minOrderQty: p.minQty ?? (p.unit === "BULTO" ? 1 : 6),
        },
      });
      const img = await productImage(p.sku, p.name, cats[p.cat]!.name);
      if (img) await tx.productImage.create({ data: { productId: prod.id, ...img, width: 800, height: 800 } });
      products[p.sku] = { id: prod.id, distributorId: owner.id, categoryId: prod.categoryId, saleUnit: p.unit, name: p.name };
    }
  }
  await createProducts(delSur, delSurProducts);
  await createProducts(mediterraneo, medProducts);

  // --- Pools -----------------------------------------------------------------------
  const distributorBps: Record<string, number | null> = { [delSur.id]: null, [mediterraneo.id]: 750 };
  const catBps = (categoryId: string) => Object.values(cats).find((c) => c.id === categoryId)?.commissionBps ?? null;

  interface PartSeed {
    commerce: number;
    qty: number;
    status: ParticipationStatus;
  }
  interface PoolSeed {
    sku: string;
    title: string;
    description?: string;
    status: PoolStatus;
    price: number;
    retail: number;
    total: number;
    min: number;
    minPer: number;
    maxPer: number;
    closeOnMinimum?: boolean;
    deadlineAt: Date;
    publishedAt?: Date | null;
    zones: { provinceId: number; locality?: string }[];
    parts?: PartSeed[];
    extra?: Partial<Prisma.PoolUncheckedCreateInput>;
    paymentDueAt?: Date;
    settlement?: "PENDIENTE" | "LIQUIDADO";
    createdAt?: Date;
  }

  const ACTIVE: ParticipationStatus[] = ["COMPROMETIDA", "PENDIENTE_PAGO", "PAGADA", "ENTREGADA"];
  const poolIds: Record<string, string> = {};

  async function createPool(key: string, s: PoolSeed) {
    const product = products[s.sku]!;
    const resolved = resolveCommission({ globalBps: GLOBAL_BPS, categoryBps: catBps(product.categoryId), distributorBps: distributorBps[product.distributorId] ?? null });
    const pricing = computeUnitPricing(pesos(s.price), resolved.bps, "DESCONTAR_AL_PREVENTISTA");
    const parts = s.parts ?? [];
    const committed = parts.filter((p) => ACTIVE.includes(p.status)).reduce((a, p) => a + p.qty, 0);
    const paid = parts.filter((p) => p.status === "PAGADA" || p.status === "ENTREGADA").reduce((a, p) => a + p.qty, 0);
    const published = s.status !== "BORRADOR";
    const pool = await tx.pool.create({
      data: {
        distributorId: product.distributorId,
        productId: product.id,
        categoryId: product.categoryId,
        title: s.title,
        description: s.description ?? null,
        status: s.status,
        saleUnit: product.saleUnit,
        priceInputCents: BigInt(pricing.inputCents),
        unitPriceCents: BigInt(pricing.unitPriceCents),
        commissionUnitCents: BigInt(pricing.commissionUnitCents),
        netUnitCents: BigInt(pricing.netUnitCents),
        retailUnitPriceCents: BigInt(pesos(s.retail)),
        commissionBps: resolved.bps,
        commissionMode: "DESCONTAR_AL_PREVENTISTA",
        commissionSource: resolved.source,
        commissionFrozenAt: published ? (s.publishedAt ?? s.createdAt ?? days(-3)) : null,
        totalUnits: s.total,
        minUnitsToClose: s.min,
        minPerCommerce: s.minPer,
        maxPerCommerce: s.maxPer,
        committedUnits: committed,
        paidUnits: paid,
        closeOnMinimum: s.closeOnMinimum ?? true,
        paymentWindowHours: 48,
        unpaidRule: "REABRIR",
        deadlineAt: s.deadlineAt,
        originalDeadlineAt: published ? s.deadlineAt : null,
        publishedAt: s.status === "PENDIENTE_APROBACION" || !published ? null : (s.publishedAt ?? days(-3)),
        createdAt: s.createdAt ?? days(-4),
        notified80: committed * 100 >= s.min * 80,
        zones: {
          create: s.zones.map((z) => ({ provinceId: z.provinceId, localityId: z.locality ? loc(z.provinceId, z.locality) : null })),
        },
        ...s.extra,
      },
    });
    poolIds[key] = pool.id;
    for (const [i, p] of parts.entries()) {
      const amounts = computeLine(pricing, p.qty);
      const commerce = C(p.commerce);
      const paidAt = p.status === "PAGADA" || p.status === "ENTREGADA" ? (s.extra?.paidAt as Date | undefined) ?? hours(-20 + i) : null;
      const part = await tx.participation.create({
        data: {
          poolId: pool.id,
          commerceId: commerce.id,
          quantity: p.qty,
          unitPriceCents: BigInt(pricing.unitPriceCents),
          totalCents: BigInt(amounts.totalCents),
          commissionCents: BigInt(amounts.commissionCents),
          netCents: BigInt(amounts.netCents),
          status: p.status,
          paidAt,
          deliveredAt: p.status === "ENTREGADA" ? ((s.extra?.deliveredAt as Date | undefined) ?? days(-6)) : null,
          createdAt: new Date((s.publishedAt ?? days(-3)).getTime() + (i + 1) * 3_600_000),
        },
      });
      if (["PENDIENTE_PAGO", "PAGADA", "ENTREGADA"].includes(p.status)) {
        const approved = p.status !== "PENDIENTE_PAGO";
        await tx.payment.create({
          data: {
            kind: "POOL",
            commerceId: commerce.id,
            participationId: part.id,
            amountCents: BigInt(amounts.totalCents),
            commissionCents: BigInt(amounts.commissionCents),
            netCents: BigInt(amounts.netCents),
            provider: "simulado",
            status: approved ? "APROBADO" : "PENDIENTE",
            providerPreferenceId: `SIM-PREF-${part.id}`,
            providerPaymentId: approved ? `SIM-SEED-${part.id}` : null,
            providerStatus: approved ? "simulado:approved" : null,
            dueAt: s.paymentDueAt ?? hours(30),
            paidAt,
          },
        });
      }
    }
    // Línea de tiempo de estados en la auditoría
    const timeline: PoolStatus[] = (() => {
      switch (s.status) {
        case "BORRADOR": return [];
        case "PENDIENTE_APROBACION": return ["PENDIENTE_APROBACION"];
        case "ABIERTO": return ["ABIERTO"];
        case "COMPLETO": return ["ABIERTO", "COMPLETO"];
        case "CERRADO_PAGADO": return ["ABIERTO", "COMPLETO", "CERRADO_PAGADO"];
        case "EN_ENTREGA": return ["ABIERTO", "COMPLETO", "CERRADO_PAGADO", "EN_ENTREGA"];
        case "ENTREGADO": return ["ABIERTO", "COMPLETO", "CERRADO_PAGADO", "EN_ENTREGA", "ENTREGADO"];
        case "VENCIDO_SIN_COMPLETAR": return ["ABIERTO", "VENCIDO_SIN_COMPLETAR"];
        case "CANCELADO": return ["ABIERTO", "CANCELADO"];
      }
    })();
    let prev: PoolStatus = "BORRADOR";
    for (const [i, st] of timeline.entries()) {
      await tx.auditLog.create({
        data: {
          actorId: st === "ABIERTO" || st === "PENDIENTE_APROBACION" ? (await tx.business.findUniqueOrThrow({ where: { id: product.distributorId } })).userId : null,
          actorRole: st === "ABIERTO" || st === "PENDIENTE_APROBACION" ? "PREVENTISTA" : "SISTEMA",
          action: "pool.estado",
          entityType: "POOL",
          entityId: pool.id,
          summary: `${prev} → ${st}: datos demo`,
          createdAt: new Date((s.publishedAt ?? days(-3)).getTime() + i * 6 * 3_600_000),
        },
      });
      prev = st;
    }
    if (s.settlement) {
      const paidParts = await tx.participation.findMany({ where: { poolId: pool.id, status: { in: ["PAGADA", "ENTREGADA"] } } });
      await tx.settlement.create({
        data: {
          distributorId: product.distributorId,
          sourceType: "POOL",
          poolId: pool.id,
          grossCents: paidParts.reduce((a, p) => a + p.totalCents, 0n),
          commissionCents: paidParts.reduce((a, p) => a + p.commissionCents, 0n),
          netCents: paidParts.reduce((a, p) => a + p.netCents, 0n),
          status: s.settlement,
          reference: s.settlement === "LIQUIDADO" ? "Transferencia 000123-DEMO" : null,
          paidOutAt: s.settlement === "LIQUIDADO" ? days(-5) : null,
          paidOutById: s.settlement === "LIQUIDADO" ? admin.id : null,
          createdAt: (s.extra?.paidAt as Date | undefined) ?? days(-2),
        },
      });
    }
    return pool;
  }

  const SUR_ZONES = [{ provinceId: CABA }, { provinceId: BA, locality: "Avellaneda" }, { provinceId: BA, locality: "Lanús" }, { provinceId: BA, locality: "Quilmes" }];

  await createPool("gaseosa", {
    sku: "DS-GAS-COLA-6",
    title: "Pallet gaseosa cola 2,25 L (100 packs x 6)",
    description: "Pallet completo directo de fábrica. Precio por pack de 6 botellas.",
    status: "ABIERTO",
    price: 19_500,
    retail: 28_800,
    total: 100,
    min: 80,
    minPer: 2,
    maxPer: 20,
    deadlineAt: hours(20),
    publishedAt: days(-3),
    zones: SUR_ZONES,
    parts: [
      { commerce: 1, qty: 15, status: "COMPROMETIDA" },
      { commerce: 2, qty: 10, status: "COMPROMETIDA" },
      { commerce: 3, qty: 12, status: "COMPROMETIDA" },
      { commerce: 4, qty: 8, status: "COMPROMETIDA" },
      { commerce: 5, qty: 10, status: "COMPROMETIDA" },
      { commerce: 6, qty: 6, status: "COMPROMETIDA" },
      { commerce: 7, qty: 7, status: "COMPROMETIDA" },
    ],
    extra: { featured: true },
  });
  await createPool("alfajores", {
    sku: "DS-ALF-TRI-24",
    title: "Alfajores triples: 200 cajas x 24",
    status: "ABIERTO",
    price: 16_800,
    retail: 28_800,
    total: 200,
    min: 150,
    minPer: 2,
    maxPer: 30,
    deadlineAt: days(5),
    publishedAt: days(-2),
    zones: SUR_ZONES,
    parts: [
      { commerce: 1, qty: 10, status: "COMPROMETIDA" },
      { commerce: 2, qty: 20, status: "COMPROMETIDA" },
      { commerce: 4, qty: 15, status: "COMPROMETIDA" },
      { commerce: 8, qty: 15, status: "COMPROMETIDA" },
    ],
  });
  await createPool("yerba", {
    sku: "DS-YERBA-1KG",
    title: "Yerba mate 1 kg: pallet de 500 paquetes",
    status: "ABIERTO",
    price: 3_900,
    retail: 5_600,
    total: 500,
    min: 400,
    minPer: 10,
    maxPer: 100,
    deadlineAt: days(9),
    publishedAt: hours(-10),
    zones: [{ provinceId: CABA }],
    parts: [{ commerce: 3, qty: 30, status: "COMPROMETIDA" }],
  });
  await createPool("lima", {
    sku: "MM-LIMA-6",
    title: "Gaseosa lima-limón: 60 packs x 6 (Córdoba)",
    status: "ABIERTO",
    price: 18_000,
    retail: 26_400,
    total: 60,
    min: 40,
    minPer: 2,
    maxPer: 20,
    deadlineAt: days(3),
    publishedAt: days(-1),
    zones: [{ provinceId: CBA }],
    parts: [
      { commerce: 9, qty: 14, status: "COMPROMETIDA" },
      { commerce: 10, qty: 10, status: "COMPROMETIDA" },
    ],
    extra: { featured: true },
  });
  await createPool("papel", {
    sku: "DS-PAPEL-4",
    title: "Papel higiénico x 4: 300 packs (sigue sumando)",
    description: "Ya se llegó al mínimo: el pool sigue abierto hasta completar los 300 packs o la fecha límite.",
    status: "COMPLETO",
    price: 2_100,
    retail: 3_300,
    total: 300,
    min: 200,
    minPer: 10,
    maxPer: 60,
    closeOnMinimum: false,
    deadlineAt: days(2),
    publishedAt: days(-4),
    zones: SUR_ZONES,
    parts: [
      { commerce: 1, qty: 40, status: "COMPROMETIDA" },
      { commerce: 2, qty: 50, status: "COMPROMETIDA" },
      { commerce: 3, qty: 30, status: "COMPROMETIDA" },
      { commerce: 5, qty: 60, status: "COMPROMETIDA" },
      { commerce: 6, qty: 50, status: "COMPROMETIDA" },
    ],
    extra: { completedAt: hours(-10) },
  });
  await createPool("aceite", {
    sku: "DS-ACEITE-15",
    title: "Aceite de girasol 1,5 L: 240 botellas",
    status: "COMPLETO",
    price: 3_200,
    retail: 4_500,
    total: 240,
    min: 200,
    minPer: 12,
    maxPer: 60,
    deadlineAt: days(1),
    publishedAt: days(-5),
    zones: SUR_ZONES,
    parts: [
      { commerce: 1, qty: 48, status: "PAGADA" },
      { commerce: 2, qty: 60, status: "PAGADA" },
      { commerce: 4, qty: 36, status: "PENDIENTE_PAGO" },
      { commerce: 7, qty: 60, status: "PENDIENTE_PAGO" },
    ],
    paymentDueAt: hours(30),
    extra: { completedAt: hours(-18), closedAt: hours(-18) },
  });
  await createPool("azucar", {
    sku: "DS-AZUCAR-1KG",
    title: "Azúcar 1 kg: 600 paquetes",
    status: "CERRADO_PAGADO",
    price: 1_150,
    retail: 1_600,
    total: 600,
    min: 500,
    minPer: 20,
    maxPer: 150,
    deadlineAt: days(-2),
    publishedAt: days(-9),
    zones: SUR_ZONES,
    parts: [
      { commerce: 1, qty: 100, status: "PAGADA" },
      { commerce: 2, qty: 120, status: "PAGADA" },
      { commerce: 3, qty: 80, status: "PAGADA" },
      { commerce: 5, qty: 100, status: "PAGADA" },
      { commerce: 6, qty: 60, status: "PAGADA" },
      { commerce: 8, qty: 60, status: "PAGADA" },
    ],
    paymentDueAt: days(-1),
    settlement: "PENDIENTE",
    extra: { completedAt: days(-3), closedAt: days(-3), paidAt: days(-2), estimatedDeliveryAt: days(2) },
  });
  await createPool("galletitas", {
    sku: "DS-GAL-AGUA-3",
    title: "Galletitas de agua x 3: 300 paquetes",
    status: "EN_ENTREGA",
    price: 1_350,
    retail: 2_000,
    total: 300,
    min: 240,
    minPer: 20,
    maxPer: 80,
    deadlineAt: days(-5),
    publishedAt: days(-12),
    zones: SUR_ZONES,
    parts: [
      { commerce: 1, qty: 60, status: "PAGADA" },
      { commerce: 3, qty: 60, status: "PAGADA" },
      { commerce: 4, qty: 60, status: "PAGADA" },
      { commerce: 7, qty: 60, status: "PAGADA" },
    ],
    paymentDueAt: days(-3),
    settlement: "PENDIENTE",
    extra: { completedAt: days(-6), closedAt: days(-6), paidAt: days(-4), scheduledDeliveryAt: hours(20) },
  });
  await createPool("lavandina", {
    sku: "DS-LAVAN-2L",
    title: "Lavandina 2 L: 400 bidones",
    status: "ENTREGADO",
    price: 1_250,
    retail: 1_900,
    total: 400,
    min: 320,
    minPer: 20,
    maxPer: 100,
    deadlineAt: days(-14),
    publishedAt: days(-21),
    zones: SUR_ZONES,
    parts: [
      { commerce: 1, qty: 80, status: "ENTREGADA" },
      { commerce: 2, qty: 80, status: "ENTREGADA" },
      { commerce: 5, qty: 80, status: "ENTREGADA" },
      { commerce: 6, qty: 80, status: "ENTREGADA" },
    ],
    paymentDueAt: days(-12),
    settlement: "LIQUIDADO",
    extra: { completedAt: days(-15), closedAt: days(-15), paidAt: days(-13), scheduledDeliveryAt: days(-7), deliveredAt: days(-7) },
  });
  await createPool("agua", {
    sku: "DS-AGUA-2L-6",
    title: "Agua mineral 2 L: 150 packs x 6",
    status: "VENCIDO_SIN_COMPLETAR",
    price: 9_600,
    retail: 14_400,
    total: 150,
    min: 120,
    minPer: 5,
    maxPer: 30,
    deadlineAt: hours(-6),
    publishedAt: days(-7),
    zones: SUR_ZONES,
    parts: [
      { commerce: 2, qty: 15, status: "COMPROMETIDA" },
      { commerce: 4, qty: 20, status: "COMPROMETIDA" },
      { commerce: 8, qty: 10, status: "COMPROMETIDA" },
    ],
    extra: { expiredAt: hours(-6), decisionDeadlineAt: hours(42) },
  });
  await createPool("detergente", {
    sku: "DS-DETER-750",
    title: "Detergente 750 ml: 500 unidades",
    status: "CANCELADO",
    price: 1_600,
    retail: 2_500,
    total: 500,
    min: 400,
    minPer: 12,
    maxPer: 100,
    deadlineAt: days(-8),
    publishedAt: days(-16),
    zones: SUR_ZONES,
    parts: [{ commerce: 3, qty: 40, status: "CANCELADA" }],
    extra: { cancelledAt: days(-10), cancelReason: "El proveedor no confirmó el stock", committedUnits: 0 },
  });
  await createPool("cafe", {
    sku: "DS-CAFE-500",
    title: "Café molido 500 g: 200 paquetes",
    status: "BORRADOR",
    price: 7_500,
    retail: 11_000,
    total: 200,
    min: 150,
    minPer: 6,
    maxPer: 40,
    deadlineAt: days(10),
    zones: [{ provinceId: CABA }],
    createdAt: hours(-3),
  });
  await createPool("fideos", {
    sku: "DS-FIDEOS-500",
    title: "Fideos spaghetti 500 g: 1.000 paquetes",
    status: "PENDIENTE_APROBACION",
    price: 850,
    retail: 1_400,
    total: 1_000,
    min: 800,
    minPer: 20,
    maxPer: 200,
    deadlineAt: days(12),
    zones: SUR_ZONES,
    createdAt: hours(-5),
  });
  await createPool("alfacba", {
    sku: "MM-ALF-CBA-12",
    title: "Alfajor cordobés: 120 cajas x 12",
    status: "VENCIDO_SIN_COMPLETAR",
    price: 8_900,
    retail: 14_400,
    total: 120,
    min: 100,
    minPer: 2,
    maxPer: 30,
    deadlineAt: days(-18),
    publishedAt: days(-28),
    zones: [{ provinceId: CBA }],
    parts: [{ commerce: 9, qty: 12, status: "CANCELADA" }],
    extra: { expiredAt: days(-18), decisionDeadlineAt: days(-16), finalizedAt: days(-16), committedUnits: 0 },
  });

  // --- Pedidos de catálogo ------------------------------------------------------------
  async function order(commerceN: number, distributorId: string, items: { sku: string; qty: number }[], status: "PENDIENTE_PAGO" | "PAGADO" | "ENTREGADO", createdAt: Date) {
    let subtotal = 0;
    const rows = [];
    for (const it of items) {
      const prod = await tx.product.findFirstOrThrow({ where: { sku: it.sku, distributorId } });
      const pricing = computeUnitPricing(Number(prod.priceCents), 0, "DESCONTAR_AL_PREVENTISTA");
      const line = computeLine(pricing, it.qty);
      subtotal += line.totalCents;
      rows.push({
        productId: prod.id,
        name: prod.name,
        sku: prod.sku,
        saleUnit: prod.saleUnit,
        quantity: it.qty,
        unitPriceCents: prod.priceCents,
        totalCents: BigInt(line.totalCents),
        commissionCents: 0n,
        netCents: BigInt(line.netCents),
      });
    }
    const commerce = C(commerceN);
    const o = await tx.order.create({
      data: {
        commerceId: commerce.id,
        distributorId,
        status,
        subtotalCents: BigInt(subtotal),
        commissionCents: 0n,
        netCents: BigInt(subtotal),
        commissionBps: 0,
        createdAt,
        paidAt: status !== "PENDIENTE_PAGO" ? new Date(createdAt.getTime() + 2 * 3_600_000) : null,
        deliveredAt: status === "ENTREGADO" ? new Date(createdAt.getTime() + 48 * 3_600_000) : null,
        items: { create: rows },
      },
    });
    await tx.payment.create({
      data: {
        kind: "PEDIDO",
        commerceId: commerce.id,
        orderId: o.id,
        amountCents: BigInt(subtotal),
        commissionCents: 0n,
        netCents: BigInt(subtotal),
        provider: "simulado",
        status: status === "PENDIENTE_PAGO" ? "PENDIENTE" : "APROBADO",
        providerPaymentId: status === "PENDIENTE_PAGO" ? null : `SIM-SEED-${o.id}`,
        dueAt: new Date(createdAt.getTime() + 48 * 3_600_000),
        paidAt: status !== "PENDIENTE_PAGO" ? new Date(createdAt.getTime() + 2 * 3_600_000) : null,
      },
    });
    if (status !== "PENDIENTE_PAGO") {
      await tx.settlement.create({
        data: { distributorId, sourceType: "PEDIDO", orderId: o.id, grossCents: BigInt(subtotal), commissionCents: 0n, netCents: BigInt(subtotal), createdAt },
      });
    }
    return o;
  }
  await order(4, delSur.id, [{ sku: "DS-PAPAS-145", qty: 24 }, { sku: "DS-CAR-1KG", qty: 6 }], "PENDIENTE_PAGO", hours(-4));
  await order(6, delSur.id, [{ sku: "DS-CERV-473-6", qty: 5 }, { sku: "DS-JABON-3", qty: 12 }], "PAGADO", days(-1));
  const delivered = await order(9, mediterraneo.id, [{ sku: "MM-FERNET-750", qty: 6 }, { sku: "MM-GAL-RELL", qty: 24 }], "ENTREGADO", days(-6));

  // --- Calificaciones, disputa y notificaciones ---------------------------------------
  const lavParts = await tx.participation.findMany({ where: { poolId: poolIds.lavandina }, include: { commerce: true } });
  const ratingData = [
    { n: 1, stars: 5, comment: "Llegó todo perfecto y en horario. ¡Muy buen precio!" },
    { n: 2, stars: 4, comment: "Bien, aunque el repartidor llegó un poco tarde." },
    { n: 5, stars: 5, comment: "Excelente, repito seguro." },
  ];
  for (const r of ratingData) {
    const part = lavParts.find((p) => p.commerceId === C(r.n).id)!;
    await tx.rating.create({
      data: { commerceId: C(r.n).id, distributorId: delSur.id, poolId: poolIds.lavandina, participationId: part.id, stars: r.stars, comment: r.comment, createdAt: days(-6) },
    });
  }
  await tx.rating.create({ data: { commerceId: C(9).id, distributorId: mediterraneo.id, orderId: delivered.id, stars: 4, comment: "Todo OK.", createdAt: days(-4) } });
  await tx.business.update({ where: { id: delSur.id }, data: { ratingAvg: 14 / 3, ratingCount: 3 } });
  await tx.business.update({ where: { id: mediterraneo.id }, data: { ratingAvg: 4, ratingCount: 1 } });

  const disputed = lavParts.find((p) => p.commerceId === C(6).id)!;
  await tx.dispute.create({
    data: {
      openedById: C(6).userId,
      commerceId: C(6).id,
      distributorId: delSur.id,
      poolId: poolIds.lavandina,
      participationId: disputed.id,
      reason: "INCOMPLETO",
      description: "Pagué 80 bidones y me entregaron 76. Adjunto el remito firmado con la diferencia anotada.",
      createdAt: days(-5),
    },
  });

  const notifications: Prisma.NotificationCreateManyInput[] = [
    { userId: C(1).userId, type: "NUEVO_POOL_EN_ZONA", title: "Nuevo pool en tu zona: Alfajores triples", body: "Distribuidora Del Sur abrió un pool de alfajores triples a $ 16.800,00 la caja.", link: `/pools/${poolIds.alfajores}`, createdAt: days(-2) },
    { userId: C(1).userId, type: "POOL_80", title: '¡"Pallet gaseosa cola" ya está al 80 %!', body: "Faltan 12 packs para llegar al mínimo. Compartilo con otros comercios de tu zona.", link: `/pools/${poolIds.gaseosa}`, createdAt: hours(-3) },
    { userId: C(1).userId, type: "PAGO_APROBADO", title: "¡Recibimos tu pago!", body: "Pagaste tu parte del pool de aceite de girasol.", link: "/comercio/pools", createdAt: hours(-15), readAt: hours(-14) },
    { userId: C(4).userId, type: "LINK_DE_PAGO", title: "¡Se cerró el pool! Ya podés pagar", body: "El pool de aceite de girasol se cerró. Tenés 48 h para pagar tus 36 botellas.", link: "/comercio/pagos", createdAt: hours(-18) },
    { userId: C(2).userId, type: "POOL_VENCIDO", title: 'El pool "Agua mineral 2 L" venció sin completarse', body: "No se te cobra nada. El preventista puede extender la fecha o cerrar igual; te avisamos.", link: `/pools/${poolIds.agua}`, createdAt: hours(-6) },
    { userId: (await tx.business.findUniqueOrThrow({ where: { id: delSur.id } })).userId, type: "POOL_VENCIDO", title: 'Tu pool "Agua mineral 2 L" venció', body: "Llegó a 45 de 120 packs. Podés extender la fecha una vez o cerrar con lo alcanzado.", link: `/preventista/pools/${poolIds.agua}`, createdAt: hours(-6) },
    { userId: admin.id, type: "PREVENTISTA_PENDIENTE", title: "Nuevo preventista para aprobar", body: "Preventa Litoral se registró y espera aprobación.", link: "/admin/preventistas", createdAt: hours(-20) },
    { userId: admin.id, type: "POOL_PARA_APROBAR", title: "Hay un pool para aprobar", body: 'Distribuidora Del Sur envió "Fideos spaghetti 500 g".', link: "/admin/pools?estado=PENDIENTE_APROBACION", createdAt: hours(-5) },
  ];
  await tx.notification.createMany({ data: notifications });

  await tx.auditLog.create({
    data: { actorId: admin.id, actorRole: "ADMIN", action: "comision.config", entityType: "CONFIG", entityId: "1", summary: "Comisión global: 7 % → 8 %", createdAt: days(-30) },
  });
}

main()
  .catch((err) => {
    console.error("Error cargando el seed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
