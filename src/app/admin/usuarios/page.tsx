import type { Metadata } from "next";
import { DownloadLink } from "@/components/ui/download-link";
import Link from "next/link";
import type { Role } from "@/generated/prisma/enums";
import { formatDateTimeAR } from "@/lib/dates";
import { ActionForm } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { Badge, PageHeader, Table, Td, Th } from "@/components/ui/display";
import { setUserStatusAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Usuarios" };

const ROLES: { key?: Role; label: string }[] = [{ label: "Todos" }, { key: "COMERCIO", label: "Comercios" }, { key: "PREVENTISTA", label: "Preventistas" }, { key: "ADMIN", label: "Admins" }];

export default async function UsersPage(props: PageProps<"/admin/usuarios">) {
  const sp = await props.searchParams;
  const me = await requirePageUser(["ADMIN"], "/admin/usuarios");
  const role = ROLES.find((r) => r.key === sp.rol)?.key;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const users = await db.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }, { business: { tradeName: { contains: q } } }, { business: { cuit: { contains: q.replace(/\D/g, "") || q } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { business: { select: { tradeName: true } } },
  });
  return (
    <>
      <PageHeader
        title="Usuarios"
        actions={
          <DownloadLink href="/api/exportar/usuarios">Exportar CSV</DownloadLink>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {ROLES.map((r) => (
          <Link key={r.label} href={r.key ? `/admin/usuarios?rol=${r.key}` : "/admin/usuarios"} aria-current={r.key === role ? "page" : undefined} className={cn("min-h-[40px] rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold", r.key === role ? "bg-ink text-brand" : "hover:bg-brand-soft")}>
            {r.label}
          </Link>
        ))}
      </div>
      <form className="mb-4" action="/admin/usuarios">
        {role ? <input type="hidden" name="rol" value={role} /> : null}
        <label className="sr-only" htmlFor="q-users">Buscar</label>
        <input id="q-users" name="q" defaultValue={q} placeholder="Nombre, email, negocio o CUIT" className="field-input" />
      </form>
      <Table caption="Usuarios">
        <thead>
          <tr>
            <Th>Usuario</Th>
            <Th>Rol</Th>
            <Th>Negocio</Th>
            <Th>Alta / último ingreso</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <Td>
                <span className="font-bold">{u.name}</span>
                <span className="block text-xs text-muted">{u.email}</span>
              </Td>
              <Td>{u.role}</Td>
              <Td>{u.business?.tradeName ?? "—"}</Td>
              <Td className="text-xs">
                {formatDateTimeAR(u.createdAt)}
                <br />
                {u.lastLoginAt ? formatDateTimeAR(u.lastLoginAt) : "nunca"}
              </Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <Badge tone={u.status === "ACTIVO" ? "outline" : "muted"}>{u.status}</Badge>
                  {u.id !== me.id ? (
                    <ActionForm
                      action={setUserStatusAction}
                      submitLabel={u.status === "ACTIVO" ? "Suspender" : "Reactivar"}
                      size="sm"
                      variant="secondary"
                      confirm={u.status === "ACTIVO" ? "La cuenta no va a poder ingresar ni operar. ¿Suspender?" : undefined}
                      inline
                    >
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="status" value={u.status === "ACTIVO" ? "SUSPENDIDO" : "ACTIVO"} />
                    </ActionForm>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
