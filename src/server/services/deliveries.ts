import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatARS, toCents } from "@/domain/money";
import { formatDateTimeAR } from "@/lib/dates";
import { formatInt, SALE_UNIT_LABEL } from "@/lib/labels";
import { db } from "../db";

export interface DeliveryItem {
  label: string;
  quantity: number;
  unit: string;
  kind: "POOL" | "PEDIDO";
  refId: string; // participationId u orderId
  scheduledAt: Date | null;
}

export interface DeliveryStop {
  commerceId: string;
  commerceName: string;
  address: string;
  phone: string | null;
  totalCents: number;
  items: DeliveryItem[];
}

export interface DeliveryZone {
  key: string;
  province: string;
  locality: string;
  stops: DeliveryStop[];
}

/**
 * Hoja de reparto: todo lo pagado y todavía no entregado, agrupado por zona
 * (provincia › localidad) y, dentro de cada zona, por comercio.
 */
export async function getDeliverySheet(distributorId: string, filter: { provinceId?: number; localityId?: number } = {}): Promise<DeliveryZone[]> {
  const commerceWhere = {
    ...(filter.provinceId ? { provinceId: filter.provinceId } : {}),
    ...(filter.localityId ? { localityId: filter.localityId } : {}),
  };
  const commerceInclude = { province: { select: { name: true } }, locality: { select: { name: true } } } as const;
  const [parts, orders] = await Promise.all([
    db.participation.findMany({
      where: { status: "PAGADA", pool: { distributorId, status: { in: ["CERRADO_PAGADO", "EN_ENTREGA"] } }, commerce: commerceWhere },
      include: { pool: { select: { title: true, saleUnit: true, scheduledDeliveryAt: true } }, commerce: { include: commerceInclude } },
    }),
    db.order.findMany({
      where: { distributorId, status: { in: ["PAGADO", "EN_ENTREGA"] }, commerce: commerceWhere },
      include: { items: true, commerce: { include: commerceInclude } },
    }),
  ]);
  const zones = new Map<string, DeliveryZone>();
  const stopFor = (c: (typeof parts)[number]["commerce"]): DeliveryStop => {
    const key = `${c.province.name}›${c.locality.name}`;
    let zone = zones.get(key);
    if (!zone) {
      zone = { key, province: c.province.name, locality: c.locality.name, stops: [] };
      zones.set(key, zone);
    }
    let stop = zone.stops.find((s) => s.commerceId === c.id);
    if (!stop) {
      stop = {
        commerceId: c.id,
        commerceName: c.tradeName,
        address: `${c.street} ${c.streetNumber}${c.floorApt ? ` (${c.floorApt})` : ""}`,
        phone: c.phone,
        totalCents: 0,
        items: [],
      };
      zone.stops.push(stop);
    }
    return stop;
  };
  for (const p of parts) {
    const stop = stopFor(p.commerce);
    stop.totalCents += toCents(p.totalCents);
    stop.items.push({
      label: p.pool.title,
      quantity: p.quantity,
      unit: SALE_UNIT_LABEL[p.pool.saleUnit].short,
      kind: "POOL",
      refId: p.id,
      scheduledAt: p.pool.scheduledDeliveryAt,
    });
  }
  for (const o of orders) {
    const stop = stopFor(o.commerce);
    stop.totalCents += toCents(o.subtotalCents);
    for (const it of o.items) {
      stop.items.push({
        label: `Pedido #${o.number}: ${it.name}`,
        quantity: it.quantity,
        unit: SALE_UNIT_LABEL[it.saleUnit].short,
        kind: "PEDIDO",
        refId: o.id,
        scheduledAt: o.scheduledDeliveryAt,
      });
    }
  }
  return [...zones.values()]
    .sort((a, b) => a.key.localeCompare(b.key, "es"))
    .map((z) => ({ ...z, stops: z.stops.sort((a, b) => a.commerceName.localeCompare(b.commerceName, "es")) }));
}

// ---------------------------------------------------------------------------
// PDF (pdf-lib, fuentes estándar: sin archivos externos que empaquetar)
// ---------------------------------------------------------------------------

/** Las fuentes estándar usan WinAnsi: se reemplazan los caracteres que no soporta. */
function safeText(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text.replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/›/g, ">")]
    .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?"))
    .join("");
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = safeText(font, text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function renderDeliverySheetPdf(distributorName: string, zones: DeliveryZone[], filterLabel: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Hoja de reparto - ${distributorName}`);
  pdf.setCreator("PEDILA");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.067, 0.067, 0.067);
  const yellow = rgb(1, 0.839, 0);
  const W = 595.28; // A4
  const H = 841.89;
  const M = 36;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (t: string, x: number, size = 10, f: PDFFont = font) => page.drawText(safeText(f, t), { x, y, size, font: f, color: ink });
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + 20) newPage();
  };

  // Encabezado
  page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 34, color: yellow, borderColor: ink, borderWidth: 1.5 });
  y -= 23;
  text("PEDILA.", M + 10, 16, bold);
  text("Hoja de reparto", M + 90, 14, bold);
  y -= 30;
  text(distributorName, M, 12, bold);
  y -= 14;
  text(`Generada: ${formatDateTimeAR(new Date())} · ${filterLabel}`, M, 9);
  y -= 20;

  const totalStops = zones.reduce((a, z) => a + z.stops.length, 0);
  if (totalStops === 0) {
    text("No hay entregas pendientes para este filtro.", M, 11);
  }

  const colX = { n: M, commerce: M + 22, detail: M + 230, sign: W - M - 90 };
  let n = 0;
  for (const zone of zones) {
    ensure(40);
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(1, 0.969, 0.8), borderColor: ink, borderWidth: 1 });
    y += 0;
    text(`${zone.locality} (${zone.province}) · ${zone.stops.length} paradas`, M + 6, 11, bold);
    y -= 24;
    for (const stop of zone.stops) {
      n++;
      const left = [
        ...wrap(bold, stop.commerceName, 10, 200),
        ...wrap(font, stop.address, 9, 200),
        ...(stop.phone ? [`Tel. ${stop.phone}`] : []),
        `Cobrado: ${formatARS(stop.totalCents)}`,
      ];
      const right = stop.items.flatMap((it) =>
        wrap(font, `${formatInt(it.quantity)} ${it.unit} · ${it.label}${it.scheduledAt ? ` (${formatDateTimeAR(it.scheduledAt)})` : ""}`, 9, colX.sign - colX.detail - 10),
      );
      const lines = Math.max(left.length, right.length);
      const blockH = lines * 12 + 10;
      ensure(blockH);
      const top = y;
      text(String(n), colX.n, 10, bold);
      left.forEach((l, i) => {
        y = top - i * 12;
        text(l, colX.commerce, i === 0 ? 10 : 9, i === 0 ? bold : font);
      });
      right.forEach((l, i) => {
        y = top - i * 12;
        text(l, colX.detail, 9);
      });
      y = top;
      page.drawRectangle({ x: colX.sign, y: top - blockH + 14, width: 90, height: blockH - 8, borderColor: ink, borderWidth: 0.8 });
      y = top - 8;
      text("Recibí conforme", colX.sign + 6, 7);
      y = top - blockH;
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
      y -= 6;
    }
    y -= 8;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(safeText(font, `Página ${i + 1} de ${pages.length} · PEDILA`), { x: M, y: 18, size: 8, font, color: ink });
  });
  return pdf.save();
}
