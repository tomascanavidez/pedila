"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // La sesión se pide desde el navegador: así el layout raíz queda estático y las
  // páginas públicas se pueden cachear.
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={5 * 60}>
      {children}
    </SessionProvider>
  );
}
