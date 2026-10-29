import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { authConfig } from "./auth.config";
import { loginSchema } from "./lib/validation";
import { LIMITS, rateLimiter } from "./lib/rate-limit";
import { audit } from "./server/audit";
import { db } from "./server/db";
import { logger } from "./server/logger";
import { verifyPassword } from "./server/services/users";

class TooManyAttempts extends CredentialsSignin {
  override code = "demasiados_intentos";
}

class SuspendedAccount extends CredentialsSignin {
  override code = "cuenta_suspendida";
}

// Hash de relleno para que el tiempo de respuesta sea igual exista o no el email.
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.wBf0Zr1tn0J7IkM3Wxq4sJ0u3Lxa";

function clientIp(request: Request | undefined): string {
  const fwd = request?.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? request?.headers.get("x-real-ip") ?? "local").trim();
}

const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/** Recarga desde la base los datos del token como mucho cada 60 s (o al actualizar el perfil). */
const REFRESH_MS = 60_000;

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = clientIp(request);
        if (!rateLimiter.hit(`login:${ip}:${email}`, LIMITS.login.limit, LIMITS.login.windowMs).ok) {
          throw new TooManyAttempts();
        }
        const user = await db.user.findUnique({ where: { email } });
        const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) return null;
        if (user.status !== "ACTIVO") throw new SuspendedAccount();
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await audit(db, { id: user.id, role: user.role, ip }, { action: "usuario.login", entityType: "USER", entityId: user.id });
        rateLimiter.reset(`login:${ip}:${email}`);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    ...(googleEnabled ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })] : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email = profile?.email?.toLowerCase();
      if (!email || profile?.email_verified !== true) return "/ingresar?error=GoogleSinEmail";
      let user = await db.user.findUnique({ where: { email } });
      if (user && user.status !== "ACTIVO") return "/ingresar?error=cuenta_suspendida";
      if (!user) {
        // Cuenta nueva: se crea como comercio y se completa el negocio en /completar-perfil.
        user = await db.user.create({
          data: { email, name: profile.name ?? email, role: "COMERCIO", image: typeof profile.picture === "string" ? profile.picture : null },
        });
      }
      await db.account.upsert({
        where: { provider_providerAccountId: { provider: "google", providerAccountId: account.providerAccountId } },
        create: { userId: user.id, provider: "google", providerAccountId: account.providerAccountId },
        update: {},
      });
      return true;
    },
    async jwt({ token, user, account, trigger }) {
      if (account?.provider === "google" && token.email) {
        const u = await db.user.findUnique({ where: { email: token.email.toLowerCase() }, select: { id: true } });
        if (u) token.uid = u.id;
      } else if (user?.id) {
        token.uid = user.id;
      }
      if (!token.uid) return null;
      const stale = trigger === "update" || !token.refreshedAt || Date.now() - token.refreshedAt > REFRESH_MS;
      if (stale) {
        try {
          const u = await db.user.findUnique({
            where: { id: token.uid },
            include: { business: { select: { id: true, distributorStatus: true } } },
          });
          if (!u || u.status !== "ACTIVO") return null; // cierra la sesión de cuentas suspendidas o borradas
          token.role = u.role;
          token.name = u.name;
          token.email = u.email;
          token.bid = u.business?.id ?? null;
          token.dst = u.business?.distributorStatus ?? null;
          token.pc = u.role === "ADMIN" || Boolean(u.business);
          token.refreshedAt = Date.now();
        } catch (err) {
          // Si la base no responde se conserva el token anterior en lugar de cerrar la sesión.
          logger.warn("No se pudo refrescar la sesión", { err });
        }
      }
      return token;
    },
  },
});

export { googleEnabled };
