import type { ReactNode } from "react";
import { PanelShell } from "@/components/layout/panel-nav";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function CommerceLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser(["COMERCIO"], "/comercio");
  const pendingPayments = await db.payment.count({
    where: { commerceId: user.businessId!, status: { in: ["PENDIENTE", "EN_PROCESO"] } },
  });
  return (
    <PanelShell
      title={user.name}
      subtitle="Mi comercio"
      links={[
        { href: "/comercio", label: "Resumen", exact: true },
        { href: "/comercio/pools", label: "Mis pools" },
        { href: "/comercio/pagos", label: "Pagos", badge: pendingPayments },
        { href: "/comercio/pedidos", label: "Pedidos" },
        { href: "/comercio/carrito", label: "Carrito" },
        { href: "/comercio/entregas", label: "Entregas" },
        { href: "/comercio/reclamos", label: "Reclamos" },
        { href: "/comercio/perfil", label: "Mi negocio" },
      ]}
    >
      {children}
    </PanelShell>
  );
}
