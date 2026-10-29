import type { Metadata } from "next";
import { formatDateTimeAR, isWithin } from "@/lib/dates";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, PageHeader, StatCard, Table, Td, Th } from "@/components/ui/display";
import { retryJobAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Tareas y worker" };

export default async function JobsPage() {
  await requirePageUser(["ADMIN"], "/admin/tareas");
  const [beat, groups, recent, webhooks] = await Promise.all([
    db.systemStatus.findUnique({ where: { key: "worker.heartbeat" } }),
    db.job.groupBy({ by: ["status"], _count: true }),
    db.job.findMany({ where: { status: { in: ["FALLIDO", "PENDIENTE", "PROCESANDO"] } }, orderBy: { runAt: "asc" }, take: 100 }),
    db.webhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const count = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;
  const ok = beat ? isWithin(beat.updatedAt, 3 * 60_000) : false;
  return (
    <>
      <PageHeader title="Tareas y worker" description="Cola de emails, links de pago, avisos y reintegros que procesa el worker (PM2: pedila-worker)." />
      {ok ? (
        <Alert>Worker activo. Último latido: {formatDateTimeAR(beat!.updatedAt)}.</Alert>
      ) : (
        <Alert tone="warning">
          El worker no reporta actividad{beat ? ` desde ${formatDateTimeAR(beat.updatedAt)}` : ""}. En el servidor: <code>pm2 status</code> y <code>pm2 logs pedila-worker</code>.
        </Alert>
      )}
      <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Pendientes" value={count("PENDIENTE")} />
        <StatCard label="En proceso" value={count("PROCESANDO")} />
        <StatCard label="Completadas" value={count("COMPLETADO")} />
        <StatCard label="Fallidas" value={count("FALLIDO")} accent={count("FALLIDO") > 0} />
      </div>
      <h2 className="mb-3 text-xl font-black">Pendientes y fallidas</h2>
      <Table caption="Tareas pendientes y fallidas">
        <thead>
          <tr>
            <Th>Tipo</Th>
            <Th>Estado</Th>
            <Th>Programada</Th>
            <Th>Intentos / error</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {recent.map((j) => (
            <tr key={j.id}>
              <Td className="font-bold">{j.type}</Td>
              <Td>
                <Badge tone={j.status === "FALLIDO" ? "dark" : "outline"}>{j.status}</Badge>
              </Td>
              <Td className="text-xs">{formatDateTimeAR(j.runAt)}</Td>
              <Td className="max-w-[280px] text-xs">
                {j.attempts}/{j.maxAttempts} {j.lastError ? <span className="block break-words text-muted">{j.lastError.slice(0, 200)}</span> : null}
              </Td>
              <Td>
                {j.status === "FALLIDO" ? (
                  <ActionForm action={retryJobAction} submitLabel="Reintentar" size="sm" variant="secondary" inline>
                    <input type="hidden" name="jobId" value={j.id} />
                  </ActionForm>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <h2 className="mb-3 mt-8 text-xl font-black">Últimos webhooks recibidos</h2>
      <Table caption="Webhooks">
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Proveedor / tópico</Th>
            <Th>Recurso</Th>
            <Th>Resultado</Th>
          </tr>
        </thead>
        <tbody>
          {webhooks.map((w) => (
            <tr key={w.id}>
              <Td className="text-xs">{formatDateTimeAR(w.createdAt)}</Td>
              <Td>
                {w.provider} · {w.topic}
              </Td>
              <Td className="text-xs">{w.resourceId}</Td>
              <Td className="text-xs">{w.result ?? (w.processedAt ? "ok" : "sin procesar")}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
