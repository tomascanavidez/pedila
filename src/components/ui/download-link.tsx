import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Link de descarga a un endpoint de archivos (CSV/PDF). Es un <a> común a propósito:
 * <Link> de Next intentaría navegar del lado del cliente y no descargaría el archivo.
 */
export function DownloadLink({ href, children, className, button }: { href: string; children: ReactNode; className?: string; button?: string }) {
  return (
    <a href={href} className={cn(button ?? "inline-flex items-center gap-1 font-bold underline underline-offset-4", className)}>
      <Download aria-hidden="true" className="h-4 w-4" /> {children}
    </a>
  );
}
