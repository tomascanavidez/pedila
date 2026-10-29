import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { getEnv } from "../env";

/**
 * Almacenamiento de archivos subidos. Hoy: disco local (UPLOAD_DIR).
 * Para pasar a S3 (u otro compatible) alcanza con implementar esta interfaz y
 * devolverla en getStorage(); el resto de la app no cambia.
 */
export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  open(key: string): Promise<{ stream: Readable; size: number } | null>;
  publicUrl(key: string): string;
}

/** Solo permite claves simples ("products/2026/10/abc.webp"): evita path traversal. */
export function isSafeKey(key: string): boolean {
  return /^[a-z0-9][a-z0-9/_-]*\.(webp|jpg|png)$/i.test(key) && !key.includes("..") && !key.includes("//");
}

export class LocalDiskStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!isSafeKey(key)) throw new Error("Clave de archivo inválida");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Ruta fuera del directorio de uploads");
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { mode: 0o644 });
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async open(key: string): Promise<{ stream: Readable; size: number } | null> {
    try {
      const full = this.resolve(key);
      const s = await stat(full);
      if (!s.isFile()) return null;
      return { stream: createReadStream(full), size: s.size };
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    return `/uploads/${key}`;
  }
}

let storage: StorageAdapter | null = null;

/**
 * Carpeta de uploads. En producción conviene una ruta absoluta (fuera de la carpeta de
 * cada release). Si es relativa, se toma desde la raíz del proyecto, incluso cuando el
 * servidor standalone cambia el directorio de trabajo a .next/standalone.
 */
export function uploadRoot(): string {
  const dir = getEnv().UPLOAD_DIR;
  if (path.isAbsolute(dir)) return dir;
  const cwd = process.cwd();
  const base = cwd.endsWith(path.join(".next", "standalone")) ? path.resolve(cwd, "..", "..") : cwd;
  return path.resolve(base, dir);
}

export function getStorage(): StorageAdapter {
  storage ??= new LocalDiskStorage(uploadRoot());
  return storage;
}

/** URL pública de una clave guardada (o null). */
export function uploadUrl(key: string | null | undefined): string | null {
  return key ? `/uploads/${key}` : null;
}
