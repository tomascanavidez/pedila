import { expect, test } from "@playwright/test";
import { login, logout, RUN, validCuit } from "./helpers";

/**
 * Flujo principal de punta a punta, con los tres roles:
 * preventista publica un pool (calculadora en vivo) → un comercio nuevo se registra y
 * se suma hasta cerrarlo → paga (checkout simulado) → el preventista entrega → el
 * comercio califica. Cada corrida usa datos únicos, así que se puede repetir.
 */
test.describe.serial("pool de punta a punta", () => {
  const poolTitle = `E2E alfajores ${RUN}`;
  const commerce = { email: `kiosco-${RUN}@e2e.pedila`, password: "Kiosco2026!", name: "Kiosco E2E" };
  let poolUrl = "";

  test("el preventista crea y publica un pool con la calculadora en vivo", async ({ page }) => {
    await login(page, "preventista1@pedila.com.ar", "Demo2026!");
    await page.goto("/preventista/pools/nuevo");
    await page.getByLabel("Producto de tu catálogo").selectOption({ label: "Alfajor triple chocolate caja x 24 (bulto x 24)" });
    await page.getByLabel("Título del pool").fill(poolTitle);
    await page.getByLabel(/Precio por bulto/).fill("15.000");
    await page.getByLabel(/Precio minorista de referencia/).fill("28.800");
    await page.getByLabel(/Total de bultos/).fill("20");
    await page.getByLabel("Mínimo para cerrar").fill("10");
    await page.getByLabel("Mínimo por comercio").fill("5");
    await page.getByLabel("Máximo por comercio").fill("10");

    // 8 % global (Golosinas no tiene override): $ 15.000 → comisión $ 1.200, neto $ 13.800 por bulto.
    const calc = page.getByRole("complementary", { name: "Calculadora de comisión" });
    await expect(calc).toContainText("8 %");
    await expect(calc).toContainText("$ 1.200,00");
    await expect(calc).toContainText("$ 13.800,00");
    await expect(calc).toContainText("$ 300.000,00"); // total del pool (20 bultos)
    await expect(calc).toContainText("$ 276.000,00"); // neto si se vende todo

    await page.getByRole("button", { name: "Publicar pool" }).click();
    await expect(page.getByText("¡Pool publicado!")).toBeVisible();
    await expect(page.getByText("Abierto").first()).toBeVisible();
    await page.getByRole("link", { name: "Ver página pública" }).click();
    await page.waitForURL(/\/pools\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: poolTitle })).toBeVisible();
    poolUrl = new URL(page.url()).pathname;
    await logout(page);
  });

  test("un comercio nuevo se registra, se suma y cierra el pool", async ({ page }) => {
    await page.goto("/registro");
    await page.getByLabel("Nombre y apellido").fill(commerce.name);
    await page.getByLabel("Email").fill(commerce.email);
    await page.getByLabel("Celular / WhatsApp").fill("11 5555-0000");
    await page.getByRole("textbox", { name: "Contraseña", exact: true }).fill(commerce.password);
    await page.getByLabel("Repetí la contraseña").fill(commerce.password);
    await page.getByLabel("Nombre del negocio").fill(`Kiosco E2E ${RUN}`);
    await page.getByLabel("Razón social").fill(`Kiosco E2E ${RUN}`);
    await page.getByLabel("CUIT").fill(validCuit());
    await page.getByLabel("Condición frente al IVA").selectOption("MONOTRIBUTO");
    await page.getByLabel("Calle").fill("Gorriti");
    await page.getByLabel("Altura").fill("4800");
    await page.getByLabel("Provincia").selectOption({ label: "Ciudad Autónoma de Buenos Aires" });
    await page.getByLabel("Localidad").selectOption({ label: "Palermo" });
    await page.getByLabel(/Acepto las condiciones/).check();
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();
    await expect(page).toHaveURL(/bienvenida=1/);
    await expect(page.getByRole("heading", { name: "Pools en tu zona" })).toBeVisible();

    await page.goto(poolUrl);
    await expect(page.getByText("0 / 10 bultos")).toBeVisible();
    const qty = page.getByLabel("¿Cuántas bultos querés?");
    await qty.fill("10");
    await page.getByRole("button", { name: "Sumarme al pool" }).click();
    await expect(page.getByText(/el pool se cerró/i).first()).toBeVisible();
    await expect(page.getByText("10 / 10 bultos")).toBeVisible();
  });

  test("el comercio paga con el checkout simulado", async ({ page }) => {
    await login(page, commerce.email, commerce.password);
    await page.goto("/comercio/pagos");
    await page.getByRole("link", { name: "Pagar" }).first().click();
    await page.waitForURL(/\/comercio\/pagos\/[a-z0-9]+/);
    await expect(page.getByRole("heading", { name: "Pagar", exact: true })).toBeVisible();
    await expect(page.locator("p", { hasText: "$ 150.000,00" })).toBeVisible(); // 10 bultos x $ 15.000
    await page.getByRole("button", { name: /Pagar con/ }).click();
    await expect(page.getByRole("heading", { name: "Checkout de prueba" })).toBeVisible();
    await page.getByRole("button", { name: "Aprobar pago" }).click();
    await expect(page.getByText("Pago acreditado. ¡Gracias!")).toBeVisible();
    await page.goto(poolUrl);
    await expect(page.getByText("Pagado").first()).toBeVisible();
    await logout(page);
  });

  test("el preventista programa la entrega y la marca como entregada", async ({ page }) => {
    await login(page, "preventista1@pedila.com.ar", "Demo2026!");
    await page.goto("/preventista/pools?f=entregar");
    await page.getByRole("link", { name: poolTitle }).click();
    await expect(page.getByText("¡Pool pagado! Programá la entrega")).toBeVisible();
    await page.getByRole("button", { name: "Programar entrega" }).click();
    await expect(page.getByText("Entrega programada", { exact: true }).first()).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Marcar todo como entregado" }).click();
    await expect(page.getByText("Entregado").first()).toBeVisible();
    await logout(page);
  });

  test("el comercio califica la entrega", async ({ page }) => {
    await login(page, commerce.email, commerce.password);
    await page.goto("/comercio/entregas");
    const card = page.locator("li", { hasText: poolTitle });
    await card.locator("label", { hasText: "5 estrellas" }).click();
    await expect(card.getByRole("radio", { name: "5 estrellas" })).toBeChecked();
    await card.getByRole("button", { name: "Enviar calificación" }).click();
    // Al guardarse, la entrega pasa a mostrar la calificación en lugar del formulario.
    await expect(page.locator("li", { hasText: poolTitle })).toContainText("Tu calificación");
    await expect(page.locator("li", { hasText: poolTitle }).getByLabel("5 de 5 estrellas")).toBeVisible();
  });
});

test("el admin cambia la comisión global y queda en el historial", async ({ page }) => {
  await login(page, "admin@pedila.com.ar", "Pedila2026!");
  await page.goto("/admin/comisiones");
  const global = page.getByLabel("Comisión global (%)");
  await global.fill("9,5");
  await page.getByRole("button", { name: "Guardar" }).first().click();
  await expect(page.getByText("Comisión actualizada")).toBeVisible();
  await expect(page.getByRole("table", { name: "Historial de cambios de comisión" })).toContainText("9,5 %");
  // Se restaura el valor del demo.
  await global.fill("8");
  await page.getByRole("button", { name: "Guardar" }).first().click();
  await expect(page.getByText("Comisión actualizada")).toBeVisible();
  await expect(page.getByLabel("Comisión global (%)")).toHaveValue("8");
});
