import "dotenv/config";
import { defineConfig } from "prisma/config";

// Configuración de la CLI de Prisma (migraciones y seed).
// La app en tiempo de ejecución NO usa este archivo: arma la conexión en src/server/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
});
