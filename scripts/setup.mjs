// Prepara el entorno local en un solo paso:
//   1. crea .env a partir de .env.example si no existe (con un AUTH_SECRET aleatorio)
//   2. genera el cliente Prisma
//   3. aplica las migraciones (prisma migrate deploy: no borra datos)
//   4. carga los datos demo si la base está vacía
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (!existsSync(".env")) {
  const example = readFileSync(".env.example", "utf8");
  writeFileSync(".env", example.replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET="${randomBytes(32).toString("base64")}"`));
  console.log("Creé .env a partir de .env.example. Revisá DATABASE_URL antes de seguir.");
}
run("npx prisma generate");
run("npx prisma migrate deploy");
run("npx prisma db seed");
console.log("\nListo. Levantá la app con: npm run dev:all  (web en http://localhost:3000 + worker)");
