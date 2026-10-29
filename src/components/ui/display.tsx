import type { ReactNode } from "react";
import { cn } from "./cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card p-4 sm:p-5", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={cn("card p-4", accent && "bg-brand")}>
      <p className="text-sm font-bold">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums sm:text-3xl">{value}</p>
      {hint ? <p className={cn("mt-1 text-sm", accent ? "text-ink" : "text-muted")}>{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card border-dashed p-8 text-center">
      <p className="text-lg font-bold">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Alert({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border-2 px-4 py-3",
        tone === "info" && "border-ink bg-brand-soft",
        tone === "warning" && "border-ink bg-brand font-semibold",
        tone === "error" && "border-danger text-danger font-semibold",
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "brand", className }: { children: ReactNode; tone?: "brand" | "dark" | "outline" | "muted"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-bold",
        tone === "brand" && "border-ink bg-brand text-ink",
        tone === "dark" && "border-ink bg-ink text-brand",
        tone === "outline" && "border-ink bg-paper text-ink",
        tone === "muted" && "border-line bg-disabled-bg text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Lista de definición compacta (etiqueta: valor). */
export function DataList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="border-b border-line pb-2">
          <dt className="text-sm text-muted">{it.label}</dt>
          <dd className="font-semibold">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tabla responsive: en celular se puede desplazar horizontalmente. */
export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cn("border-b-2 border-ink bg-brand-soft px-3 py-2.5 font-bold", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-line px-3 py-2.5 align-top", className)}>{children}</td>;
}

export function Stars({ value, count }: { value: number | null; count?: number }) {
  if (value === null || value === undefined) return <span className="text-sm text-muted">Sin calificaciones</span>;
  const rounded = Math.round(value * 10) / 10;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-bold" aria-label={`${rounded.toString().replace(".", ",")} de 5 estrellas`}>
      <span aria-hidden="true">{"★".repeat(Math.round(value))}{"☆".repeat(5 - Math.round(value))}</span>
      <span>{rounded.toString().replace(".", ",")}</span>
      {count !== undefined ? <span className="font-normal text-muted">({count})</span> : null}
    </span>
  );
}
