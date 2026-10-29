import type { NextAuthConfig } from "next-auth";

/**
 * Configuración base de Auth.js SIN dependencias de base de datos.
 * La usa el proxy (src/proxy.ts) para leer el JWT en cada request sin tocar MySQL.
 * La configuración completa (proveedores, callbacks con DB) está en src/auth.ts.
 */
export const authConfig = {
  pages: { signIn: "/ingresar", error: "/ingresar" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  providers: [],
  callbacks: {
    // En el proxy el token se usa tal cual (lo refresca src/auth.ts).
    jwt: ({ token }) => token,
    session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid;
        session.user.role = token.role;
        session.user.businessId = token.bid ?? null;
        session.user.distributorStatus = token.dst ?? null;
        session.user.profileComplete = Boolean(token.pc);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
