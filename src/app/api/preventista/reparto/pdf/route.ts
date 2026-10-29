import { LIMITS } from "@/lib/rate-limit";
import { dayKeyAR } from "@/lib/dates";
import { requireActionUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { jsonError, limited } from "@/server/http";
import { getDeliverySheet, renderDeliverySheetPdf } from "@/server/services/deliveries";

/** Hoja de reparto en PDF (A4), filtrable por provincia/localidad. */
export async function GET(req: Request) {
  try {
    const user = await requireActionUser(["PREVENTISTA"]);
    const blocked = limited(`export:${user.id}`, LIMITS.export);
    if (blocked) return blocked;
    const url = new URL(req.url);
    const provinceId = Number(url.searchParams.get("provincia")) || undefined;
    const localityId = Number(url.searchParams.get("localidad")) || undefined;
    const [zones, business] = await Promise.all([
      getDeliverySheet(user.businessId!, { provinceId, localityId }),
      db.business.findUniqueOrThrow({ where: { id: user.businessId! }, select: { tradeName: true } }),
    ]);
    const label = localityId || provinceId ? "Filtrado por zona" : "Todas las zonas";
    const bytes = await renderDeliverySheetPdf(business.tradeName, zones, label);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="hoja-de-reparto-${dayKeyAR(new Date())}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
