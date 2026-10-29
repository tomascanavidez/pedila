import { expect, type Page } from "@playwright/test";
import { cuitCheckDigit } from "../../src/domain/cuit";

export const RUN = Date.now().toString(36);

export function validCuit(prefix = "20"): string {
  for (;;) {
    const body = prefix + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const dv = cuitCheckDigit(body);
    if (dv !== null) return `${body}${dv}`;
  }
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/ingresar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).not.toHaveURL(/\/ingresar/);
}

export async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
}
