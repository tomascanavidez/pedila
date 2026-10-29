import { LIMITS } from "@/lib/rate-limit";
import { ipOf, limited, noStore } from "@/server/http";
import { getPoolProgress } from "@/server/queries/public";

/** Progreso en vivo de un pool (lo consulta la barra cada 5 s). Micro-caché de 2 s en memoria. */
export async function GET(req: Request, ctx: RouteContext<"/api/pools/[id]/progreso">) {
  const blocked = limited(`progress:${ipOf(req)}`, LIMITS.progress);
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const progress = await getPoolProgress(id.slice(0, 40));
  if (!progress) return noStore({ error: "Pool inexistente" }, { status: 404 });
  return noStore(progress);
}
