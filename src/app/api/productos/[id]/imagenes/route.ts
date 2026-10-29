import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { DomainError } from "@/domain/errors";
import { LIMITS } from "@/lib/rate-limit";
import { requireActionUser } from "@/server/auth/guards";
import { getEnv } from "@/server/env";
import { jsonError, limited } from "@/server/http";
import { addProductImage } from "@/server/services/products";
import { processAndStoreImage } from "@/server/storage/images";
import { getStorage } from "@/server/storage/storage";

/**
 * Subida de imágenes de producto (multipart/form-data, campo "file").
 * Valida rol y dueño, tamaño (UPLOAD_MAX_MB) y tipo real por contenido; guarda WebP.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/productos/[id]/imagenes">) {
  try {
    const user = await requireActionUser(["PREVENTISTA"]);
    const blocked = limited(`upload:${user.id}`, LIMITS.upload);
    if (blocked) return blocked;
    const maxBytes = getEnv().UPLOAD_MAX_MB * 1024 * 1024;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > maxBytes + 64 * 1024) {
      return NextResponse.json({ error: `La imagen supera el máximo de ${getEnv().UPLOAD_MAX_MB} MB.` }, { status: 413 });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new DomainError("ARCHIVO", "Falta el archivo.");
    if (file.size > maxBytes) throw new DomainError("ARCHIVO_GRANDE", `La imagen supera el máximo de ${getEnv().UPLOAD_MAX_MB} MB.`);
    const { id } = await ctx.params;
    const stored = await processAndStoreImage(Buffer.from(await file.arrayBuffer()), "products");
    try {
      const img = await addProductImage(user, id, stored);
      revalidateTag("catalog", { expire: 0 });
      revalidateTag("pools", { expire: 0 });
      return NextResponse.json({ id: img.id, url: `/uploads/${img.thumbKey}` });
    } catch (err) {
      // Si no se pudo asociar (sin permiso, límite de imágenes), se borra lo guardado.
      await getStorage().remove(stored.key).catch(() => undefined);
      await getStorage().remove(stored.thumbKey).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    return jsonError(err);
  }
}
