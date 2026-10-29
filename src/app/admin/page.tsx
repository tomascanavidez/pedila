import type { Metadata } from "next";
import Link from "next/link";
import { ColumnChart } from "@/components/charts/column-chart";
import { cn } from "@/components/ui/cn";
import { Alert, PageHeader, StatCard, Table, Td, Th } from "@/components/ui/display";
import { formatARS } from "@/domain/money";
import { isWithin } from "@/lib/dates";
import { formatInt } from "@/lib/labels";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { adminKpis, adminSeries, type Granularity } from "@/server/services/reports";

export const metadata: Metadata = { title: "Administración" };

const PERIODS: { key: string; label: string; granularity: Granularity; points: number; days: number }[] = [
  { key: "30d", label: "Últimos 30 días", granularity: "dia", points: 30, days: 30 },
  { key: "12s", label: "Últimas 12 semanas", granularity: "semana", points: 12, days: 84 },
  { key: "12m", label: "Últimos 12 meses", granularity: "mes", points: 12, days: 365 },
];

export default async function AdminHome(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  await requirePageUser(["ADMIN"], "/admin");
  const period = PERIODS.find((p) => p.key === sp.periodo) ?? PERIODS[0]!;
  const to = new Date();
  const from = new Date(to.getTime() - period.days * 86_400_000);
  const [kpis, series, beat] = await Promise.all([
    adminKpis(from, to),
    adminSeries(period.granularity, period.points),
    db.systemStatus.findUnique({ where: { key: "worker.heartbeat" } }),
  ]);
  const takeRate = kpis.gmvCents > 0 ? Math.round((kpis.commissionCents * 1000) / kpis.gmvCents) / 10 : 0;
  const workerOk = beat ? isWithin(beat.updatedAt, 3 * 60_000) : false;

  return (
    <>
      <PageHeader title="Resumen" description="GMV, comisiones, pools y usuarios de PEDILA." />

      {/* Filtro único sobre todo el contenido: define el período de KPIs y gráficos. */}
      <nav aria-label="Período" className="mb-6 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/admin?periodo=${p.key}`}
            aria-current={p.key === period.key ? "page" : undefined}
            className={cn("min-h-[44px] rounded-full border-2 border-ink px-4 py-2 font-bold", p.key === period.key ? "bg-ink text-brand" : "hover:bg-brand-soft")}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <div className="mb-6 flex flex-col gap-2">
        {!workerOk ? (
          <Alert tone="warning">
            El worker de tareas programadas no reporta actividad{beat ? "" : " todavía"}. Revisá <Link href="/admin/tareas" className="underline">Tareas y worker</Link>.
          </Alert>
        ) : null}
        {kpis.alerts.pendingDistributors > 0 ? (
          <Alert>
            Hay {kpis.alerts.pendingDistributors} preventista(s) esperando aprobación. <Link href="/admin/preventistas" className="font-bold underline">Revisar</Link>
          </Alert>
        ) : null}
        {kpis.pools.pendingApproval > 0 ? (
          <Alert>
            Hay {kpis.pools.pendingApproval} pool(s) para aprobar. <Link href="/admin/pools?estado=PENDIENTE_APROBACION" className="font-bold underline">Revisar</Link>
          </Alert>
        ) : null}
        {kpis.alerts.openDisputes > 0 ? (
          <Alert>
            {kpis.alerts.openDisputes} disputa(s) abiertas. <Link href="/admin/disputas" className="font-bold underline">Ver</Link>
          </Alert>
        ) : null}
        {kpis.alerts.failedJobs > 0 ? <Alert tone="warning">{kpis.alerts.failedJobs} tarea(s) fallidas en la cola (emails, links de pago o reintegros).</Alert> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="GMV cobrado" value={formatARS(kpis.gmvCents, { decimals: false })} hint={`${formatInt(kpis.paymentsCount)} pagos aprobados`} accent />
        <StatCard label="Comisiones ganadas" value={formatARS(kpis.commissionCents, { decimals: false })} hint={`${takeRate.toString().replace(".", ",")} % del GMV`} />
        <StatCard label="Pools activos" value={kpis.pools.active} hint={`${kpis.pools.completed} completados · ${kpis.pools.expired} vencidos`} />
        <StatCard label="Usuarios" value={formatInt(kpis.users.commerces + kpis.users.distributors)} hint={`${kpis.users.commerces} comercios · ${kpis.users.distributors} preventistas · ${kpis.users.newInPeriod} nuevos`} />
      </div>

      <section className="mt-8" aria-labelledby="graficos">
        <h2 id="graficos" className="mb-3 text-xl font-black">
          Evolución por {period.granularity === "dia" ? "día" : period.granularity}
        </h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ColumnChart title="GMV (pagos aprobados)" kind="money" points={series.map((s) => ({ label: s.label, value: s.gmvCents, display: formatARS(s.gmvCents) }))} />
          <ColumnChart
            title="Comisiones PEDILA"
            kind="money"
            points={series.map((s) => ({ label: s.label, value: s.commissionCents, display: formatARS(s.commissionCents) }))}
          />
          <ColumnChart title="Pools pagados" kind="count" points={series.map((s) => ({ label: s.label, value: s.poolsPaid, display: `${s.poolsPaid} pools` }))} />
          <ColumnChart title="Pools publicados" kind="count" points={series.map((s) => ({ label: s.label, value: s.poolsCreated, display: `${s.poolsCreated} pools` }))} />
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer font-bold underline underline-offset-4">Ver los datos en una tabla</summary>
          <div className="mt-3">
            <Table caption="Datos de los gráficos por período">
              <thead>
                <tr>
                  <Th>Período</Th>
                  <Th>GMV</Th>
                  <Th>Comisiones</Th>
                  <Th>Pools pagados</Th>
                  <Th>Pools publicados</Th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.key}>
                    <Td>{s.label}</Td>
                    <Td className="tabular-nums">{formatARS(s.gmvCents)}</Td>
                    <Td className="tabular-nums">{formatARS(s.commissionCents)}</Td>
                    <Td className="tabular-nums">{s.poolsPaid}</Td>
                    <Td className="tabular-nums">{s.poolsCreated}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </details>
      </section>
    </>
  );
}
