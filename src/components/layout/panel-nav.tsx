"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

export interface PanelLink {
  href: string;
  label: string;
  /** Si es true, solo se marca activo con la ruta exacta. */
  exact?: boolean;
  badge?: number;
}

/** Navegación del panel: pestañas desplazables en celular, columna lateral en escritorio. */
export function PanelNav({ links, label }: { links: PanelLink[]; label: string }) {
  const pathname = usePathname();
  const isActive = (l: PanelLink) => (l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`));
  return (
    <nav aria-label={label} className="no-print -mx-4 overflow-x-auto border-b-2 border-ink px-4 lg:mx-0 lg:overflow-visible lg:border-0 lg:px-0">
      <ul className="flex gap-1 py-2 lg:flex-col lg:py-0">
        {links.map((l) => {
          const active = isActive(l);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] items-center justify-between gap-2 rounded-xl border-2 px-3 font-bold whitespace-nowrap",
                  active ? "border-ink bg-brand" : "border-transparent hover:border-ink hover:bg-brand-soft",
                )}
              >
                {l.label}
                {l.badge ? (
                  <span className="min-w-[22px] rounded-full bg-ink px-1.5 text-center text-xs text-brand">{l.badge}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PanelShell({
  title,
  subtitle,
  links,
  children,
  banner,
}: {
  title: string;
  subtitle?: string;
  links: PanelLink[];
  children: React.ReactNode;
  banner?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-4 lg:py-8">
      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="mb-2 hidden lg:block">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{subtitle}</p>
            <p className="text-lg font-black leading-tight">{title}</p>
          </div>
          <PanelNav links={links} label={`Menú de ${title}`} />
        </aside>
        <div className="pt-4 lg:pt-0">
          {banner}
          {children}
        </div>
      </div>
    </div>
  );
}
