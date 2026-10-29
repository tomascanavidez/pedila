// Empaqueta el worker en un único archivo ESM (dist/worker.mjs).
// Las dependencias de node_modules quedan externas (se resuelven en el servidor);
// el código propio y el cliente Prisma generado (src/generated) se incluyen.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "src/worker/index.ts")],
  outfile: path.join(root, "dist/worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  // "server-only" solo tiene sentido dentro de Next: en el worker es un módulo vacío.
  alias: { "server-only": path.join(root, "src/lib/server-only-stub.ts") },
  tsconfig: path.join(root, "tsconfig.json"),
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  banner: { js: "// PEDILA worker - generado por scripts/build-worker.mjs" },
});
