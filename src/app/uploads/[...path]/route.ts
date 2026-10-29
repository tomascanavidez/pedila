import { Readable } from "node:stream";
import { isSafeKey, getStorage } from "@/server/storage/storage";

/**
 * Sirve las imágenes subidas desde UPLOAD_DIR. En producción conviene que nginx sirva
 * /uploads directamente (ver deploy/nginx.conf); esta ruta queda como respaldo.
 */
export async function GET(_req: Request, ctx: RouteContext<"/uploads/[...path]">) {
  const { path } = await ctx.params;
  const key = path.join("/");
  if (!isSafeKey(key)) return new Response("No encontrado", { status: 404 });
  const file = await getStorage().open(key);
  if (!file) return new Response("No encontrado", { status: 404 });
  const type = key.endsWith(".webp") ? "image/webp" : key.endsWith(".png") ? "image/png" : "image/jpeg";
  return new Response(Readable.toWeb(file.stream) as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=2592000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
