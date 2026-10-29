import { MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { formatARS } from "@/domain/money";
import { formatDateTimeAR } from "@/lib/dates";
import { formatInt } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { DownloadLink } from "@/components/ui/download-link";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/display";
import { markOrderDeliveredAction } from "@/server/actions/distributor";
import { markParticipationDeliveredAction } from "@/server/actions/pools";
import { requirePageUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { listGeo } from "@/server/queries/public";
import { getDeliverySheet } from "@/server/services/deliveries";

export const metadata: Metadata = { title: "Hoja de reparto" };

export default async function DeliverySheetPage(props: PageProps<"/preventista/reparto">) {
  const sp = await props.searchParams;
  const user = await requirePageUser(["PREVENTISTA"], "/preventista/reparto");
  const provinceId = Number(sp.provincia) || undefined;
  const localityId = Number(sp.localidad) || undefined;
  const [zones, geo, coverage] = await Promise.all([
    getDeliverySheet(user.businessId!, { provinceId, localityId }),
    listGeo(),
    db.distributorCoverage.findMany({ where: { businessId: user.businessId! } }),
  ]);
  const provinces = geo.filter((p) => coverage.some((c) => c.provinceId === p.id));
  const localities = provinces.find((p) => p.id === provinceId)?.localities ?? [];
  const qs = new URLSearchParams({ ...(provinceId ? { provincia: String(provinceId) } : {}), ...(localityId ? { localidad: String(localityId) } : {}) }).toString();
  const stops = zones.reduce((a, z) => a + z.stops.length, 0);

  return (
    <>
      <PageHeader
        title="Hoja de reparto"
        description={`${stops} paradas pendientes de entrega, agrupadas por zona.`}
        actions={
          <DownloadLink href={`/api/preventista/reparto/pdf${qs ? `?${qs}` : ""}`} button={buttonClass("primary", "md")}>
            Descargar PDF
          </DownloadLink>
        }
      />
      <form className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]" action="/preventista/reparto">
        <label className="flex flex-col gap-1 text-sm font-bold">
          Provincia
          <select name="provincia" defaultValue={provinceId ?? ""} className="field-input">
            <option value="">Todas</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          Localidad
          <select name="localidad" defaultValue={localityId ?? ""} className="field-input">
            <option value="">Todas</option>
            {localities.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass("secondary", "md", "self-end")}>
          Filtrar
        </button>
      </form>
      {zones.length === 0 ? (
        <EmptyState title="No hay entregas pendientes">Cuando un pool o pedido quede pagado, aparece acá.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {zones.map((z) => (
            <section key={z.key} aria-labelledby={`z-${z.key}`}>
              <h2 id={`z-${z.key}`} className="mb-3 flex items-center gap-2 rounded-xl border-2 border-ink bg-brand px-3 py-2 text-lg font-black">
                <MapPin aria-hidden="true" className="h-5 w-5" /> {z.locality} <span className="font-semibold">({z.province})</span> · {z.stops.length}
              </h2>
              <ol className="flex flex-col gap-3">
                {z.stops.map((s, i) => (
                  <li key={s.commerceId}>
                    <Card className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-black">
                            {i + 1}. {s.commerceName}
                          </p>
                          <p className="text-sm">{s.address}</p>
                          {s.phone ? (
                            <a href={`tel:${s.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-sm font-semibold underline">
                              <Phone aria-hidden="true" className="h-4 w-4" /> {s.phone}
                            </a>
                          ) : null}
                        </div>
                        <span className="font-bold tabular-nums">{formatARS(s.totalCents)}</span>
                      </div>
                      <ul className="flex flex-col gap-2 border-t-2 border-line pt-2">
                        {s.items.map((it, idx) => (
                          <li key={`${it.refId}-${idx}`} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-sm">
                              <b>
                                {formatInt(it.quantity)} {it.unit}
                              </b>{" "}
                              · {it.label}
                              {it.scheduledAt ? <span className="text-muted"> · {formatDateTimeAR(it.scheduledAt)}</span> : null}
                            </span>
                            {it.kind === "POOL" ? (
                              <ActionForm action={markParticipationDeliveredAction} submitLabel="Entregado" size="sm" variant="secondary" inline>
                                <input type="hidden" name="participationId" value={it.refId} />
                              </ActionForm>
                            ) : idx === s.items.findIndex((x) => x.refId === it.refId) ? (
                              <ActionForm action={markOrderDeliveredAction} submitLabel="Pedido entregado" size="sm" variant="secondary" inline>
                                <input type="hidden" name="orderId" value={it.refId} />
                              </ActionForm>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
