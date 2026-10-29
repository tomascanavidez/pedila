"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compactARS, compactInt } from "@/lib/compact";

/**
 * Gráfico de columnas de UNA serie (SVG, sin dependencias).
 * Specs: columnas ≤ 24 px con punta redondeada de 4 px y base recta, grilla de líneas
 * finas sólidas, etiquetas directas solo en el máximo y el último período, tooltip en
 * hover y en foco de teclado. Marcas en tinta (#111111): el amarillo de marca sobre
 * blanco no llega al contraste 3:1 que piden los elementos gráficos.
 */
export interface ColumnPoint {
  label: string;
  value: number;
  /** Texto del valor para tooltip y etiquetas (por ejemplo "$ 1.234,00"). */
  display: string;
}

const INK = "#111111";
const GRID = "#e5e5e5";
const MUTED = "#5c5c5c";
const H = 220;
const PAD = { top: 24, right: 8, bottom: 28, left: 56 };

function niceStep(max: number, ticks = 4): number {
  if (max <= 0) return 1;
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

/** Barra con punta redondeada (4 px) y base recta sobre el eje. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function ColumnChart({ title, points, kind }: { title: string; points: ColumnPoint[]; kind: "money" | "count" }) {
  const formatAxis = kind === "money" ? compactARS : compactInt;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(260, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const max = Math.max(0, ...points.map((p) => p.value));
    // Para conteos no tiene sentido una grilla con decimales (0,5 pools).
    const step = kind === "count" ? Math.max(1, Math.ceil(niceStep(max))) : niceStep(max);
    const top = max > 0 ? Math.ceil(max / step) * step : step * 4;
    const plotW = width - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const band = plotW / Math.max(1, points.length);
    const barW = Math.max(2, Math.min(24, band - 2)); // deja al menos 2 px de aire entre columnas
    const ticks: number[] = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
    const maxIndex = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? -1) ? i : best), 0);
    const labelEvery = Math.max(1, Math.ceil(44 / band));
    return { plotH, band, barW, ticks, y, maxIndex, labelEvery };
  }, [points, width, kind]);

  const activePoint = active !== null ? points[active] : null;
  const lastIndex = points.length - 1;

  return (
    <figure className="card relative p-4">
      <figcaption className="mb-2 font-bold">{title}</figcaption>
      <div ref={wrap} className="relative w-full">
        <svg width={width} height={H} role="group" aria-label={`${title}. Usá Tab para recorrer los períodos.`} className="block overflow-visible">
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={geo.y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">
                {formatAxis(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = PAD.left + geo.band * i + geo.band / 2;
            const top = geo.y(p.value);
            const h = PAD.top + geo.plotH - top;
            const showValue = p.value > 0 && (i === geo.maxIndex || i === lastIndex);
            return (
              <g
                key={p.label + i}
                tabIndex={0}
                role="img"
                aria-label={`${p.label}: ${p.display}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none"
              >
                {/* Área de hover/foco: toda la franja, más grande que la marca. */}
                <rect x={PAD.left + geo.band * i} y={PAD.top} width={geo.band} height={geo.plotH} fill="transparent" />
                <path d={barPath(cx - geo.barW / 2, top, geo.barW, h)} fill={INK} opacity={active === null || active === i ? 1 : 0.55} />
                {active === i ? (
                  <rect x={cx - geo.barW / 2 - 3} y={top - 3} width={geo.barW + 6} height={h + 3} fill="none" stroke={INK} strokeWidth={1} rx={5} />
                ) : null}
                {showValue ? (
                  <text x={cx} y={top - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>
                    {formatAxis(p.value)}
                  </text>
                ) : null}
                {i % geo.labelEvery === 0 || i === lastIndex ? (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>
                    {p.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + geo.plotH} y2={PAD.top + geo.plotH} stroke={MUTED} strokeWidth={1} />
        </svg>
        {activePoint && active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute z-10 rounded-lg border-2 border-ink bg-paper px-3 py-2 text-sm shadow-[3px_3px_0_#111111]"
            style={{
              left: Math.min(Math.max(0, PAD.left + geo.band * active + geo.band / 2 - 70), width - 150),
              top: 0,
            }}
          >
            <p className="font-black tabular-nums">{activePoint.display}</p>
            <p className="text-muted">{activePoint.label}</p>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
