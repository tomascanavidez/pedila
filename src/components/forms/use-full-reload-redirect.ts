"use client";

import { useEffect } from "react";
import type { ActionState } from "@/lib/action-state";

/**
 * Después de ingresar, registrarse o completar el perfil, la sesión cambió: se hace una
 * carga completa de la página (no una navegación del lado del cliente) para que toda la
 * interfaz, incluido el header, lea la sesión nueva.
 */
export function useFullReloadRedirect(state: ActionState): void {
  useEffect(() => {
    const to = state.ok ? state.data?.redirectTo : undefined;
    if (typeof to === "string" && to.startsWith("/") && !to.startsWith("//")) window.location.assign(to);
  }, [state]);
}
