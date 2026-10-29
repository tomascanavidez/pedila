import type { ReactNode } from "react";
import { PanelShell } from "@/components/layout/panel-nav";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePageUser(["ADMIN"], "/admin");
  const [pendingDistributors, pendingPools, openDisputes, pendingSettlements] = await Promise.all([
    db.business.count({ where: { distributorStatus: "PENDIENTE" } }),
    db.pool.count({ where: { status: "PENDIENTE_APROBACION" } }),
    db.dispute.count({ where: { status: { in: ["ABIERTA", "EN_REVISION"] } } }),
    db.settlement.count({ where: { status: "PENDIENTE" } }),
  ]);
  return (
    <PanelShell
      title="Administración"
      subtitle="PEDILA"
      links={[
        { href: "/admin", label: "Resumen", exact: true },
        { href: "/admin/pools", label: "Pools", badge: pendingPools },
        { href: "/admin/comisiones", label: "Comisiones" },
        { href: "/admin/configuracion", label: "Configuración" },
        { href: "/admin/preventistas", label: "Preventistas", badge: pendingDistributors },
        { href: "/admin/usuarios", label: "Usuarios" },
        { href: "/admin/liquidaciones", label: "Liquidaciones", badge: pendingSettlements },
        { href: "/admin/disputas", label: "Disputas", badge: openDisputes },
        { href: "/admin/categorias", label: "Categorías" },
        { href: "/admin/zonas", label: "Zonas" },
        { href: "/admin/auditoria", label: "Auditoría" },
        { href: "/admin/exportaciones", label: "Exportaciones" },
        { href: "/admin/tareas", label: "Tareas y worker" },
        { href: "/admin/cuenta", label: "Mi cuenta" },
      ]}
    >
      {children}
    </PanelShell>
  );
}
