import type { Metadata } from "next";
import { DownloadLink } from "@/components/ui/download-link";
import Link from "next/link";
import { formatDateTimeAR } from "@/lib/dates";
import { PageHeader, Table, Td, Th } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Auditoría" };

const PAGE = 50;

export default async function AuditPage(props: PageProps<"/admin/auditoria">) {
  const sp = await props.searchParams;
  await requirePageUser(["ADMIN"], "/admin/auditoria");
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const entity = typeof sp.entidad === "string" ? sp.entidad.slice(0, 40) : "";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const where = {
    ...(entity ? { entityType: entity } : {}),
    ...(q ? { OR: [{ action: { contains: q } }, { summary: { contains: q } }, { entityId: q }] } : {}),
  };
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { actor: { select: { email: true } } } }),
    db.auditLog.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => `/admin/auditoria?${new URLSearchParams({ ...(q ? { q } : {}), ...(entity ? { entidad: entity } : {}), pagina: String(p) })}`;
  return (
    <>
      <PageHeader
        title="Auditoría"
        description={`${total} eventos registrados: cambios de estado, pagos, comisiones, ingresos y acciones de usuarios.`}
        actions={
          <DownloadLink href="/api/exportar/auditoria">Exportar CSV</DownloadLink>
        }
      />
      <form className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem_auto]" action="/admin/auditoria">
        <label className="flex flex-col gap-1 text-sm font-bold">
          Buscar (acción, detalle o ID)
          <input name="q" defaultValue={q} className="field-input" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          Entidad
          <select name="entidad" defaultValue={entity} className="field-input">
            <option value="">Todas</option>
            {["POOL", "PAYMENT", "ORDER", "USER", "BUSINESS", "CONFIG", "CATEGORY", "SETTLEMENT", "DISPUTE", "PRODUCT", "JOB", "LOCALITY"].map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="field-input self-end font-bold">Filtrar</button>
      </form>
      <Table caption="Registro de auditoría">
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Quién</Th>
            <Th>Acción</Th>
            <Th>Detalle</Th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap text-xs">{formatDateTimeAR(l.createdAt)}</Td>
              <Td className="text-xs">
                {l.actor?.email ?? "sistema"}
                <span className="block text-muted">{l.actorRole}</span>
              </Td>
              <Td className="text-xs">
                <span className="font-bold">{l.action}</span>
                <span className="block text-muted">
                  {l.entityType} {l.entityId.slice(0, 12)}
                </span>
              </Td>
              <Td className="text-sm">{l.summary}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {pages > 1 ? (
        <nav aria-label="Páginas" className="mt-4 flex items-center gap-3">
          {page > 1 ? <Link href={link(page - 1)} className="font-bold underline">Anterior</Link> : null}
          <span>
            Página {page} de {pages}
          </span>
          {page < pages ? <Link href={link(page + 1)} className="font-bold underline">Siguiente</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
