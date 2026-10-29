import type { Metadata } from "next";
import Link from "next/link";
import { formatARS, toCents } from "@/domain/money";
import { formatDateTimeAR } from "@/lib/dates";
import { EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/display";
import { PaymentStatusBadge } from "@/components/ui/status-badge";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Mis pagos" };

export default async function PaymentsPage() {
  const user = await requirePageUser(["COMERCIO"], "/comercio/pagos");
  const payments = await db.payment.findMany({
    where: { commerceId: user.businessId! },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { participation: { include: { pool: { select: { title: true } } } }, order: { select: { number: true } } },
  });
  return (
    <>
      <PageHeader title="Mis pagos" description="Links de pago de pools y pedidos, y su estado." />
      {payments.length === 0 ? (
        <EmptyState title="No tenés pagos todavía">Cuando un pool en el que estás se cierre, vas a ver acá el link de pago.</EmptyState>
      ) : (
        <Table caption="Pagos">
          <thead>
            <tr>
              <Th>Concepto</Th>
              <Th>Monto</Th>
              <Th>Estado</Th>
              <Th>Vence / pagado</Th>
              <Th>
                <span className="sr-only">Acciones</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <Td className="font-semibold">{p.participation ? `Pool: ${p.participation.pool.title}` : `Pedido #${p.order?.number}`}</Td>
                <Td className="tabular-nums">{formatARS(toCents(p.amountCents))}</Td>
                <Td>
                  <PaymentStatusBadge status={p.status} />
                </Td>
                <Td className="text-sm">
                  {p.paidAt ? `Pagado ${formatDateTimeAR(p.paidAt)}` : p.dueAt ? `Vence ${formatDateTimeAR(p.dueAt)}` : "—"}
                </Td>
                <Td>
                  <Link href={`/comercio/pagos/${p.id}`} className="font-bold underline underline-offset-4">
                    {p.status === "PENDIENTE" || p.status === "EN_PROCESO" ? "Pagar" : "Ver"}
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
