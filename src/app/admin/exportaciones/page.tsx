import type { Metadata } from "next";
import { DownloadLink } from "@/components/ui/download-link";
import { Card, PageHeader } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Exportaciones" };

const EXPORTS = [
  { href: "/api/exportar/usuarios", title: "Usuarios", text: "Comercios, preventistas y admins con sus datos fiscales." },
  { href: "/api/exportar/pools", title: "Pools", text: "Todos los pools con precios, comisión congelada y volumen." },
  { href: "/api/exportar/pagos", title: "Pagos", text: "Cobros, estados, IDs de Mercado Pago, vencimientos y reintegros." },
  { href: "/api/exportar/liquidaciones", title: "Liquidaciones", text: "Bruto, comisión y neto por pool o pedido, con estado." },
  { href: "/api/exportar/comisiones", title: "Historial de comisiones", text: "Quién cambió qué porcentaje y cuándo." },
  { href: "/api/exportar/auditoria", title: "Auditoría", text: "Últimos 20.000 eventos del registro de auditoría." },
];

export default async function ExportsPage() {
  await requirePageUser(["ADMIN"], "/admin/exportaciones");
  return (
    <>
      <PageHeader title="Exportaciones" description="Archivos CSV con separador “;” y acentos listos para abrir en Excel o Google Sheets." />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EXPORTS.map((e) => (
          <li key={e.href}>
            <Card className="flex h-full flex-col gap-2">
              <p className="text-lg font-black">{e.title}</p>
              <p className="flex-1 text-sm text-muted">{e.text}</p>
              <DownloadLink href={e.href}>Descargar CSV</DownloadLink>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
