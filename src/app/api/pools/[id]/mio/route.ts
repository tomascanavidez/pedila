import { getCurrentUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { noStore } from "@/server/http";

/** Participación del comercio logueado en un pool (para el panel "Sumarme"). */
export async function GET(_req: Request, ctx: RouteContext<"/api/pools/[id]/mio">) {
  const user = await getCurrentUser();
  if (!user || user.role !== "COMERCIO" || !user.businessId) return noStore(null);
  const { id } = await ctx.params;
  const p = await db.participation.findUnique({
    where: { poolId_commerceId: { poolId: id.slice(0, 40), commerceId: user.businessId } },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!p) return noStore(null);
  return noStore({
    status: p.status,
    quantity: p.quantity,
    paymentId: p.payments[0]?.id ?? null,
    paymentStatus: p.payments[0]?.status ?? null,
  });
}
