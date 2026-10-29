import "server-only";
import { randomBytes } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { DomainError } from "@/domain/errors";
import { getEnv } from "../env";
import { getStorage } from "./storage";

// En un VPS chico conviene que sharp use un solo hilo y no cachee en memoria.
sharp.concurrency(1);
sharp.cache(false);

export type DetectedImage = "jpeg" | "png" | "webp";

/** Detecta el tipo real por "magic bytes" (no confía en la extensión ni en el Content-Type). */
export function detectImageType(buf: Uint8Array): DetectedImage | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export interface StoredImage {
  key: string;
  thumbKey: string;
  width: number;
  height: number;
}

/**
 * Valida tamaño y tipo, redimensiona (máx. 1200 px) y comprime a WebP, más una
 * miniatura de 400 px. Elimina metadatos EXIF (incluida la ubicación GPS).
 */
export async function processAndStoreImage(input: Buffer, folder: "products" | "misc" = "products"): Promise<StoredImage> {
  const maxBytes = getEnv().UPLOAD_MAX_MB * 1024 * 1024;
  if (input.length === 0) throw new DomainError("ARCHIVO_VACIO", "El archivo está vacío.");
  if (input.length > maxBytes) {
    throw new DomainError("ARCHIVO_GRANDE", `La imagen supera el máximo de ${getEnv().UPLOAD_MAX_MB} MB.`);
  }
  if (!detectImageType(input)) {
    throw new DomainError("TIPO_INVALIDO", "Solo se aceptan imágenes JPG, PNG o WebP.");
  }
  const base = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" }).rotate();
  let large: { data: Buffer; info: OutputInfo };
  let thumb: Buffer;
  try {
    large = await base
      .clone()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    thumb = await base
      .clone()
      .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
  } catch {
    throw new DomainError("IMAGEN_INVALIDA", "No pudimos leer la imagen. Probá con otro archivo.");
  }
  const now = new Date();
  const id = randomBytes(12).toString("hex");
  const dir = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const key = `${dir}/${id}.webp`;
  const thumbKey = `${dir}/${id}_thumb.webp`;
  const storage = getStorage();
  await storage.put(key, large.data, "image/webp");
  await storage.put(thumbKey, thumb, "image/webp");
  return { key, thumbKey, width: large.info.width, height: large.info.height };
}
