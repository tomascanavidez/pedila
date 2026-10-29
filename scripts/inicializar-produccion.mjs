// =============================================================================
// PEDILA — datos base para PRODUCCIÓN (sin datos demo).
//
//   node scripts/inicializar-produccion.mjs --admin-email admin@tudominio.com.ar --admin-nombre "Tu Nombre"
//
// Carga (solo lo que falta, nunca borra ni pisa):
//   - la configuración inicial (comisión global 8 %, plazos por defecto)
//   - las 24 provincias (código INDEC) y las localidades de prisma/data/geo.json
//   - las categorías de prisma/data/categorias.json
//   - un usuario ADMIN (si se pasa --admin-email y no existe). Si no pasás --admin-clave,
//     se genera una contraseña aleatoria y se muestra UNA sola vez.
//
// Es JavaScript plano (no necesita tsx ni compilar): funciona en el servidor después
// del deploy. Usa DATABASE_URL del .env de la carpeta actual.
// =============================================================================
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mariadb from "mariadb";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const geo = JSON.parse(readFileSync(path.join(root, "prisma/data/geo.json"), "utf8"));
const categories = JSON.parse(readFileSync(path.join(root, "prisma/data/categorias.json"), "utf8"));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const adminEmail = arg("admin-email")?.trim().toLowerCase();
const adminName = arg("admin-nombre") ?? "Administración PEDILA";
let adminPassword = arg("admin-clave");

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL (corré el script desde la carpeta de la app, donde está el .env).");
  process.exit(1);
}
if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  console.error("El email del admin no es válido.");
  process.exit(1);
}
if (adminPassword && (adminPassword.length < 8 || !/[a-z]/i.test(adminPassword) || !/\d/.test(adminPassword))) {
  console.error("La clave del admin necesita al menos 8 caracteres, con letras y números.");
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
const conn = await mariadb.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  allowPublicKeyRetrieval: true,
});

try {
  await conn.query("SET time_zone = '+00:00'");
  await conn.beginTransaction();

  const cfg = await conn.query(
    "INSERT IGNORE INTO `PlatformConfig` (id, globalCommissionBps, commissionMode, catalogCommissionEnabled, paymentWindowHours, unpaidRule, reopenExtensionHours, expiredDecisionHours, poolApprovalRequired, updatedAt) VALUES (1, 800, 'DESCONTAR_AL_PREVENTISTA', false, 48, 'REABRIR', 48, 48, false, NOW(3))",
  );

  let provinces = 0;
  let localities = 0;
  for (const p of geo) {
    provinces += Number((await conn.query("INSERT IGNORE INTO `Province` (id, name) VALUES (?, ?)", [p.id, p.name])).affectedRows);
    for (const l of p.localities) {
      localities += Number((await conn.query("INSERT IGNORE INTO `Locality` (name, provinceId, active) VALUES (?, ?, true)", [l, p.id])).affectedRows);
    }
  }

  let cats = 0;
  for (const c of categories) {
    cats += Number(
      (
        await conn.query(
          "INSERT IGNORE INTO `Category` (id, name, slug, icon, sortOrder, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, true, NOW(3), NOW(3))",
          [randomUUID(), c.name, c.slug, c.icon ?? null, c.sortOrder ?? 0],
        )
      ).affectedRows,
    );
  }

  let adminMsg = "sin cambios (no se pidió crear un admin)";
  if (adminEmail) {
    const existing = await conn.query("SELECT id, role FROM `User` WHERE email = ?", [adminEmail]);
    if (existing.length > 0) {
      adminMsg = `ya existía ${adminEmail} (rol ${existing[0].role}); no se modificó`;
    } else {
      const generated = !adminPassword;
      adminPassword ??= randomBytes(9).toString("base64url") + "7";
      const hash = await bcrypt.hash(adminPassword, 10);
      await conn.query(
        "INSERT INTO `User` (id, email, name, passwordHash, role, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVO', NOW(3), NOW(3))",
        [randomUUID(), adminEmail, adminName, hash],
      );
      adminMsg = generated
        ? `creado ${adminEmail} con la clave temporal: ${adminPassword}  (cambiala al ingresar)`
        : `creado ${adminEmail}`;
    }
  }

  await conn.commit();
  console.log("Datos base de PEDILA:");
  console.log(`  configuración: ${Number(cfg.affectedRows) ? "creada" : "ya existía"}`);
  console.log(`  provincias nuevas: ${provinces} · localidades nuevas: ${localities} · categorías nuevas: ${cats}`);
  console.log(`  admin: ${adminMsg}`);
} catch (err) {
  await conn.rollback().catch(() => undefined);
  console.error("No se pudo inicializar:", err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
