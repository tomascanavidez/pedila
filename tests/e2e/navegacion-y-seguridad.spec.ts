import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("navegación pública", () => {
  test("el inicio muestra pools con progreso, ahorro y cuenta regresiva", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Comprá a precio de pallet/ })).toBeVisible();
    const first = page.locator("article").first();
    await expect(first.getByRole("progressbar")).toBeVisible();
    await expect(first).toContainText("Cierra en");
    await expect(first).toContainText(/\$ [\d.]+,\d{2}/);
  });

  test("filtra por categoría y ordena por cierre", async ({ page }) => {
    await page.goto("/?todas=1&orden=cierra-pronto");
    await page.getByRole("group", { name: "Categorías" }).getByRole("button", { name: "Bebidas" }).click();
    await expect(page).toHaveURL(/categoria=bebidas/);
    await expect(page.locator("article").first()).toContainText(/gaseosa/i);
  });

  test("la ficha de un pool invita a ingresar para sumarse", async ({ page }) => {
    await page.goto("/?todas=1");
    await page.locator("article a").first().click();
    await expect(page.getByRole("progressbar").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Ingresar y sumarme" })).toBeVisible();
  });

  test("cómo funciona muestra el ejemplo de comisión", async ({ page }) => {
    await page.goto("/como-funciona");
    await expect(page.getByText("$ 900.000,00")).toBeVisible();
    await expect(page.getByText("$ 72.000,00")).toBeVisible();
    await expect(page.getByText("$ 828.000,00")).toBeVisible();
  });

  test("el endpoint de salud responde", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
  });
});

test.describe("control de acceso", () => {
  test("las áreas privadas piden ingresar", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/ingresar\?callbackUrl=%2Fadmin/);
  });

  test("un comercio no puede entrar al panel de admin ni exportar datos", async ({ page }) => {
    await login(page, "comercio1@pedila.com.ar", "Demo2026!");
    await page.goto("/admin/usuarios");
    await expect(page).toHaveURL(/\/comercio/);
    const res = await page.request.get("/api/exportar/usuarios");
    expect(res.status()).toBe(403);
  });

  test("las API rechazan pedidos de otro origen (CSRF)", async ({ request }) => {
    const res = await request.post("/api/productos/x/imagenes", { headers: { Origin: "https://otro-sitio.example" } });
    expect(res.status()).toBe(403);
  });

  test("credenciales inválidas muestran un error claro", async ({ page }) => {
    await page.goto("/ingresar");
    await page.getByLabel("Email").fill("comercio1@pedila.com.ar");
    await page.getByLabel("Contraseña").fill("incorrecta-123");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
  });
});
