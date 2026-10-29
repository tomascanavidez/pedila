// Completa el build "standalone" de Next: copia los estáticos (.next/static) y public/
// dentro de .next/standalone, que es lo único que necesita el servidor para correr.
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next/standalone");

try {
  await stat(standalone);
} catch {
  console.error("No existe .next/standalone: corré `next build` primero.");
  process.exit(1);
}
await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
console.log("Standalone listo: .next/standalone (con .next/static y public).");
