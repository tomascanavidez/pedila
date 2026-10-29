"use client";

import { Bell, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

const PUBLIC_LINKS = [
  { href: "/", label: "Pools" },
  { href: "/catalogo", label: "Catálogo" },
  { href: "/como-funciona", label: "Cómo funciona" },
];

function panelFor(role: string | undefined): string {
  if (role === "ADMIN") return "/admin";
  if (role === "PREVENTISTA") return "/preventista";
  return "/comercio";
}

/** Consulta liviana de notificaciones sin leer (cada 60 s, solo con la pestaña visible). */
function useUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notificaciones/no-leidas", { cache: "no-store" });
        if (res.ok && !stopped) setCount(((await res.json()) as { count: number }).count);
      } catch {
        /* sin conexión: se reintenta en el próximo ciclo */
      }
    };
    void load();
    const id = window.setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled]);
  return count;
}

export function SiteHeader() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const user = session?.user;
  const unread = useUnreadCount(Boolean(user));

  // Cierra el menú al navegar ("ajustar estado durante el render", sin efecto).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper no-print">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Logo />
        <nav aria-label="Principal" className="ml-6 hidden items-center gap-1 md:flex">
          {PUBLIC_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={pathname === l.href ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 font-semibold hover:bg-brand-soft",
                pathname === l.href && "bg-brand",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/notificaciones"
                className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-ink hover:bg-brand-soft"
                aria-label={unread > 0 ? `Notificaciones: ${unread} sin leer` : "Notificaciones"}
              >
                <Bell aria-hidden="true" className="h-5 w-5" />
                {unread > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 min-w-[22px] rounded-full border-2 border-ink bg-brand px-1 text-center text-xs font-black">
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : null}
              </Link>
              <Link href={panelFor(user.role)} className={buttonClass("primary", "sm", "hidden sm:inline-flex min-h-[44px]")}>
                <LayoutDashboard aria-hidden="true" className="h-4 w-4" />
                Mi panel
              </Link>
            </>
          ) : status === "loading" ? (
            <span className="h-11 w-24" aria-hidden="true" />
          ) : (
            <>
              <Link href="/ingresar" className={buttonClass("secondary", "sm", "min-h-[44px]")}>
                Ingresar
              </Link>
              <Link href="/registro" className={buttonClass("primary", "sm", "hidden min-h-[44px] sm:inline-flex")}>
                Registrate
              </Link>
            </>
          )}
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-ink hover:bg-brand-soft"
            aria-expanded={open}
            aria-controls="menu-principal"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <div id="menu-principal" className="border-t-2 border-ink bg-paper">
          <nav aria-label="Menú" className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {PUBLIC_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-lg px-3 py-3 text-lg font-semibold hover:bg-brand-soft">
                {l.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link href={panelFor(user.role)} className="rounded-lg px-3 py-3 text-lg font-semibold hover:bg-brand-soft">
                  Mi panel
                </Link>
                <p className="px-3 pt-2 text-sm text-muted">Ingresaste como {user.email}</p>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="flex items-center gap-2 rounded-lg px-3 py-3 text-left text-lg font-semibold hover:bg-brand-soft"
                >
                  <LogOut aria-hidden="true" className="h-5 w-5" /> Salir
                </button>
              </>
            ) : (
              <Link href="/registro" className={buttonClass("primary", "lg", "mt-2")}>
                Registrá tu negocio
              </Link>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
