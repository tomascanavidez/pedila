import type { ReactNode } from "react";
import { PanelShell } from "@/components/layout/panel-nav";
import { Alert } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function DistributorLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser(["PREVENTISTA"], "/preventista");
  const business = await db.business.findUniqueOrThrow({ where: { id: user.businessId! }, select: { tradeName: true, distributorStatus: true, rejectionReason: true } });
  const ordersToHandle = await db.order.count({ where: { distributorId: user.businessId!, status: "PAGADO" } });
  const banner =
    business.distributorStatus === "PENDIENTE" ? (
      <div className="mb-4">
        <Alert tone="warning">Tu cuenta está en revisión. Mientras tanto podés cargar productos y armar borradores de pools; te avisamos por email cuando esté aprobada.</Alert>
      </div>
    ) : business.distributorStatus === "RECHAZADO" ? (
      <div className="mb-4">
        <Alert tone="error">Tu cuenta no fue aprobada{business.rejectionReason ? `: ${business.rejectionReason}` : ""}. Escribinos para revisarla.</Alert>
      </div>
    ) : null;
  return (
    <PanelShell
      title={business.tradeName}
      subtitle="Panel de preventista"
      banner={banner}
      links={[
        { href: "/preventista", label: "Resumen", exact: true },
        { href: "/preventista/pools", label: "Pools" },
        { href: "/preventista/productos", label: "Productos" },
        { href: "/preventista/pedidos", label: "Pedidos", badge: ordersToHandle },
        { href: "/preventista/reparto", label: "Reparto" },
        { href: "/preventista/liquidaciones", label: "Liquidaciones" },
        { href: "/preventista/perfil", label: "Mi negocio" },
      ]}
    >
      {children}
    </PanelShell>
  );
}
