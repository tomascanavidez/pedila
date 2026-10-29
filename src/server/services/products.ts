import "server-only";
import type { SaleUnit } from "@/generated/prisma/enums";
import { DomainError, FieldErrors } from "@/domain/errors";
import { parseARS } from "@/domain/money";
import { csvToObjects } from "@/lib/csv";
import { audit } from "../audit";
import { db } from "../db";
import { getStorage } from "../storage/storage";
import type { StoredImage } from "../storage/images";
import { withTx } from "../tx";
import { assertOwnerOrAdmin, requireBusiness, type UserActor } from "./actor";

export interface ProductInput {
  name: string;
  brand: string | null;
  description: string | null;
  sku: string;
  ean: string | null;
  categoryId: string;
  saleUnit: SaleUnit;
  unitsPerPack: number;
  priceCents: number;
  retailPriceCents: number | null;
  minOrderQty: number;
  active: boolean;
}

export function isValidEan(ean: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(ean)) return false;
  const digits = ean.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

async function assertCategory(categoryId: string) {
  const cat = await db.category.findUnique({ where: { id: categoryId } });
  if (!cat || !cat.active) throw new FieldErrors({ categoryId: "Elegí una categoría válida." });
}

export async function saveProduct(actor: UserActor, input: ProductInput, productId?: string) {
  const distributorId = requireBusiness(actor);
  await assertCategory(input.categoryId);
  if (input.ean && !isValidEan(input.ean)) throw new FieldErrors({ ean: "El código EAN no es válido." });
  const data = {
    ...input,
    priceCents: BigInt(input.priceCents),
    retailPriceCents: input.retailPriceCents === null ? null : BigInt(input.retailPriceCents),
    unitsPerPack: input.saleUnit === "BULTO" ? input.unitsPerPack : 1,
  };
  try {
    if (productId) {
      const existing = await db.product.findUnique({ where: { id: productId } });
      if (!existing) throw new DomainError("NO_ENCONTRADO", "Producto inexistente.");
      assertOwnerOrAdmin(actor, existing.distributorId);
      const updated = await db.product.update({ where: { id: productId }, data });
      await audit(db, actor, { action: "producto.editar", entityType: "PRODUCT", entityId: productId, summary: input.name });
      return updated;
    }
    const created = await db.product.create({ data: { ...data, distributorId } });
    await audit(db, actor, { action: "producto.crear", entityType: "PRODUCT", entityId: created.id, summary: input.name });
    return created;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new FieldErrors({ sku: "Ya tenés otro producto con ese SKU." });
    throw err;
  }
}

export async function deleteProduct(actor: UserActor, productId: string): Promise<"borrado" | "desactivado"> {
  const product = await db.product.findUnique({ where: { id: productId }, include: { _count: { select: { pools: true, orderItems: true } }, images: true } });
  if (!product) throw new DomainError("NO_ENCONTRADO", "Producto inexistente.");
  assertOwnerOrAdmin(actor, product.distributorId);
  if (product._count.pools > 0 || product._count.orderItems > 0) {
    // Tiene historial: se desactiva para no romper pools ni pedidos existentes.
    await db.product.update({ where: { id: productId }, data: { active: false } });
    await audit(db, actor, { action: "producto.desactivar", entityType: "PRODUCT", entityId: productId, summary: product.name });
    return "desactivado";
  }
  await db.product.delete({ where: { id: productId } });
  const storage = getStorage();
  for (const img of product.images) {
    await storage.remove(img.key).catch(() => undefined);
    await storage.remove(img.thumbKey).catch(() => undefined);
  }
  await audit(db, actor, { action: "producto.borrar", entityType: "PRODUCT", entityId: productId, summary: product.name });
  return "borrado";
}

export async function addProductImage(actor: UserActor, productId: string, image: StoredImage) {
  const product = await db.product.findUnique({ where: { id: productId }, include: { _count: { select: { images: true } } } });
  if (!product) throw new DomainError("NO_ENCONTRADO", "Producto inexistente.");
  assertOwnerOrAdmin(actor, product.distributorId);
  if (product._count.images >= 6) throw new DomainError("MAX_IMAGENES", "Cada producto puede tener hasta 6 imágenes.");
  return db.productImage.create({ data: { productId, ...image, sortOrder: product._count.images } });
}

export async function removeProductImage(actor: UserActor, imageId: string) {
  const img = await db.productImage.findUnique({ where: { id: imageId }, include: { product: true } });
  if (!img) return;
  assertOwnerOrAdmin(actor, img.product.distributorId);
  await db.productImage.delete({ where: { id: imageId } });
  const storage = getStorage();
  await storage.remove(img.key).catch(() => undefined);
  await storage.remove(img.thumbKey).catch(() => undefined);
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
}

/**
 * Importación por CSV (separador "," o ";"). Columnas:
 *   sku*, nombre*, categoria* (nombre o slug), precio* (ej. 1.234,56), precio_minorista,
 *   marca, ean, unidad (UNIDAD|BULTO), unidades_por_bulto, pedido_minimo, descripcion, activo (si|no)
 * Si el SKU ya existe se actualiza; si no, se crea.
 */
export async function importProductsCsv(actor: UserActor, text: string): Promise<ImportResult> {
  const distributorId = requireBusiness(actor);
  const { headers, records } = csvToObjects(text);
  const required = ["sku", "nombre", "categoria", "precio"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) throw new DomainError("CSV_INVALIDO", `Faltan columnas obligatorias: ${missing.join(", ")}.`);
  if (records.length > 2_000) throw new DomainError("CSV_GRANDE", "Máximo 2.000 productos por archivo.");
  const categories = await db.category.findMany({ where: { active: true } });
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const findCategory = (v: string) => categories.find((c) => norm(c.name) === norm(v) || c.slug === norm(v).replace(/\s+/g, "-"));

  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  const rows: { line: number; input: ProductInput }[] = [];
  records.forEach((r, idx) => {
    const line = idx + 2;
    const sku = (r.sku ?? "").slice(0, 60);
    const name = (r.nombre ?? "").slice(0, 160);
    const price = parseARS(r.precio ?? "");
    const retail = r.precio_minorista ? parseARS(r.precio_minorista) : null;
    const cat = findCategory(r.categoria ?? "");
    const unit = (r.unidad ?? "UNIDAD").toUpperCase();
    const perPack = Number(r.unidades_por_bulto || 1);
    const minQty = Number(r.pedido_minimo || 1);
    const ean = (r.ean ?? "").replace(/\s/g, "") || null;
    const problems: string[] = [];
    if (!sku) problems.push("falta sku");
    if (!name) problems.push("falta nombre");
    if (price === null || price <= 0) problems.push("precio inválido");
    if (r.precio_minorista && retail === null) problems.push("precio_minorista inválido");
    if (!cat) problems.push(`categoría "${r.categoria}" inexistente`);
    if (unit !== "UNIDAD" && unit !== "BULTO") problems.push("unidad debe ser UNIDAD o BULTO");
    if (!Number.isInteger(perPack) || perPack < 1) problems.push("unidades_por_bulto inválido");
    if (!Number.isInteger(minQty) || minQty < 1) problems.push("pedido_minimo inválido");
    if (ean && !isValidEan(ean)) problems.push("EAN inválido");
    if (problems.length) {
      result.errors.push({ line, message: problems.join("; ") });
      return;
    }
    rows.push({
      line,
      input: {
        sku,
        name,
        brand: r.marca?.slice(0, 80) || null,
        description: r.descripcion?.slice(0, 2000) || null,
        ean,
        categoryId: cat!.id,
        saleUnit: unit as SaleUnit,
        unitsPerPack: unit === "BULTO" ? perPack : 1,
        priceCents: price!,
        retailPriceCents: retail,
        minOrderQty: minQty,
        active: !["no", "false", "0"].includes(norm(r.activo ?? "si")),
      },
    });
  });

  await withTx(async (tx) => {
    for (const { input } of rows) {
      const existing = await tx.product.findUnique({ where: { distributorId_sku: { distributorId, sku: input.sku } } });
      const data = {
        ...input,
        priceCents: BigInt(input.priceCents),
        retailPriceCents: input.retailPriceCents === null ? null : BigInt(input.retailPriceCents),
      };
      if (existing) {
        await tx.product.update({ where: { id: existing.id }, data });
        result.updated++;
      } else {
        await tx.product.create({ data: { ...data, distributorId } });
        result.created++;
      }
    }
    await audit(tx, actor, {
      action: "producto.importar",
      entityType: "BUSINESS",
      entityId: distributorId,
      summary: `CSV: ${result.created} nuevos, ${result.updated} actualizados, ${result.errors.length} con error`,
    });
  });
  return result;
}
