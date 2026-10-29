import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTimeAR } from "@/lib/dates";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { markNotificationsReadAction } from "@/server/actions/commerce";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Notificaciones" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requirePageUser(null, "/notificaciones");
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title="Notificaciones"
        description={unread ? `${unread} sin leer` : "Estás al día"}
        actions={
          unread ? (
            <form action={markNotificationsReadAction}>
              <button type="submit" className={buttonClass("secondary", "sm")}>
                Marcar todas como leídas
              </button>
            </form>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="No tenés notificaciones" />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">{n.title}</p>
                  {!n.readAt ? <span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-ink bg-brand" aria-label="Sin leer" /> : null}
                </div>
                <p className="text-sm">{n.body}</p>
                <p className="mt-1 text-xs text-muted">{formatDateTimeAR(n.createdAt)}</p>
              </>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className={cn("card block p-4 hover:bg-brand-soft", !n.readAt && "bg-brand-soft")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cn("card p-4", !n.readAt && "bg-brand-soft")}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
