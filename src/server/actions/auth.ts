"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, signIn, signOut, unstable_update } from "@/auth";
import { DomainError } from "@/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { LIMITS } from "@/lib/rate-limit";
import { completeProfileSchema, loginSchema, registerSchema, resetPasswordSchema, resetRequestSchema } from "@/lib/validation";
import { clientIp, homeFor, safeCallbackUrl } from "../auth/guards";
import { db } from "../db";
import { completeProfile, registerUser, requestPasswordReset, resetPassword } from "../services/users";
import { enforceLimit, parseForm, runAction, str } from "./run";

function loginErrorMessage(err: AuthError): string {
  const code = (err as AuthError & { code?: string }).code;
  if (code === "demasiados_intentos") return "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
  if (code === "cuenta_suspendida") return "Tu cuenta está suspendida. Escribinos para revisarla.";
  return "Email o contraseña incorrectos.";
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: str(fd, "email"), password: str(fd, "password"), callbackUrl: str(fd, "callbackUrl") });
  if (!parsed.success) return { ok: false, message: "Completá tu email y contraseña." };
  let destination = safeCallbackUrl(parsed.data.callbackUrl, "");
  try {
    await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, message: loginErrorMessage(err) };
    throw err;
  }
  if (!destination) {
    const user = await db.user.findUnique({ where: { email: parsed.data.email }, select: { role: true } });
    destination = user ? homeFor(user.role) : "/";
  }
  // El navegador hace una carga completa (ver useFullReloadRedirect) para que toda la
  // interfaz, incluido el header, lea la sesión nueva.
  return { ok: true, message: "Ingresando…", data: { redirectTo: destination } };
}

export async function googleLoginAction(fd: FormData): Promise<void> {
  await signIn("google", { redirectTo: safeCallbackUrl(str(fd, "callbackUrl"), "/") });
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

export async function registerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { role?: "COMERCIO" | "PREVENTISTA"; email?: string; password?: string } = {};
  const state = await runAction(async () => {
    const ip = await clientIp();
    enforceLimit(`register:${ip ?? "local"}`, LIMITS.register);
    const data = parseForm(registerSchema, fd);
    await registerUser(
      {
        role: data.role,
        name: data.name,
        email: data.email,
        password: data.password,
        phone: data.phone,
        business: {
          legalName: data.legalName,
          tradeName: data.tradeName,
          cuit: data.cuit,
          ivaCondition: data.ivaCondition,
          street: data.street,
          streetNumber: data.streetNumber,
          floorApt: data.floorApt,
          postalCode: data.postalCode,
          provinceId: data.provinceId,
          localityId: data.localityId,
          phone: data.phone,
          description: data.description,
          coverage: data.coverage,
        },
      },
      ip,
    );
    out.role = data.role;
    out.email = data.email;
    out.password = data.password;
  });
  if (!out.role) return state;
  try {
    await signIn("credentials", { email: out.email, password: out.password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) return { ok: true, message: "Cuenta creada.", data: { redirectTo: "/ingresar?registrado=1" } };
    throw err;
  }
  return {
    ok: true,
    message: "¡Cuenta creada! Entrando…",
    data: { redirectTo: out.role === "PREVENTISTA" ? "/preventista?bienvenida=1" : "/?bienvenida=1" },
  };
}

export async function completeProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out: { done?: string } = {};
  const state = await runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new DomainError("SIN_SESION", "Tu sesión venció. Ingresá de nuevo.");
    const data = parseForm(completeProfileSchema, fd);
    await completeProfile(session.user.id, data.role, data.phone, {
      legalName: data.legalName,
      tradeName: data.tradeName,
      cuit: data.cuit,
      ivaCondition: data.ivaCondition,
      street: data.street,
      streetNumber: data.streetNumber,
      floorApt: data.floorApt,
      postalCode: data.postalCode,
      provinceId: data.provinceId,
      localityId: data.localityId,
      phone: data.phone,
      description: data.description,
      coverage: data.coverage,
    });
    await unstable_update({});
    out.done = homeFor(data.role);
  });
  if (out.done) return { ok: true, message: "¡Listo! Entrando…", data: { redirectTo: out.done } };
  return state;
}

export async function requestResetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ip = await clientIp();
    enforceLimit(`reset:${ip ?? "local"}`, LIMITS.passwordReset);
    const { email } = parseForm(resetRequestSchema, fd);
    await requestPasswordReset(email);
    return { ok: true, message: "Si el email está registrado, te mandamos un link para elegir una contraseña nueva. Revisá también la carpeta de spam." };
  });
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const out = { done: false };
  const state = await runAction(async () => {
    const ip = await clientIp();
    enforceLimit(`reset-confirm:${ip ?? "local"}`, LIMITS.passwordReset);
    const data = parseForm(resetPasswordSchema, fd);
    await resetPassword(data.token, data.password);
    out.done = true;
  });
  if (out.done) redirect("/ingresar?clave=1");
  return state;
}
