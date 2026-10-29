import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Providers } from "@/components/layout/providers";
import { SiteHeader } from "@/components/layout/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PEDILA — Comprá como mayorista, aunque seas chico", template: "%s · PEDILA" },
  description:
    "Sumate a pools de compra con otros comercios de tu zona y pagá precio de pallet. Kioscos, despensas y almacenes de toda la Argentina.",
  applicationName: "PEDILA",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  openGraph: { locale: "es_AR", siteName: "PEDILA", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#FFD600",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="flex min-h-dvh flex-col">
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <Providers>
          <SiteHeader />
          <main id="contenido" className="flex-1">
            {children}
          </main>
        </Providers>
        <footer className="mt-12 border-t-2 border-ink bg-paper no-print">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Logo size="sm" />
              <p className="mt-2 text-sm text-muted">Compras mayoristas en grupo para el comercio de barrio.</p>
            </div>
            <nav aria-label="Pie de página" className="flex flex-wrap gap-4 text-sm font-semibold">
              <Link href="/como-funciona" className="underline-offset-4 hover:underline">
                Cómo funciona
              </Link>
              <Link href="/catalogo" className="underline-offset-4 hover:underline">
                Catálogo
              </Link>
              <Link href="/registro?rol=PREVENTISTA" className="underline-offset-4 hover:underline">
                Soy preventista
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
