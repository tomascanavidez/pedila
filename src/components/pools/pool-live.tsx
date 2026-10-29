"use client";

import { CheckCircle2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { PoolStatus, SaleUnit } from "@/generated/prisma/enums";
import { formatARS } from "@/domain/money";
import { formatInt, SALE_UNIT_LABEL } from "@/lib/labels";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { joinPoolAction } from "@/server/actions/pools";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { ProgressBar } from "@/components/ui/progress";

interface ProgressState {
  committed: number;
  minimum: number;
  total: number;
  percentOfMinimum: number;
  available: number;
  status: PoolStatus;
  closed: boolean;
  acceptingJoins: boolean;
}

interface Mine {
  status: string;
  quantity: number;
  paymentId: string | null;
  paymentStatus: string | null;
}

interface Props {
  poolId: string;
  title: string;
  unitPriceCents: number;
  retailUnitPriceCents: number;
  saleUnit: SaleUnit;
  minPerCommerce: number;
  maxPerCommerce: number;
  initial: ProgressState;
}

const POLL_MS = 5_000;

/** Barra de progreso en vivo (polling liviano) + panel para sumarse. */
export function PoolLive(props: Props) {
  const { poolId, unitPriceCents, retailUnitPriceCents, saleUnit, minPerCommerce, maxPerCommerce } = props;
  const unit = SALE_UNIT_LABEL[saleUnit];
  const { data: session, status: sessionStatus } = useSession();
  const [progress, setProgress] = useState<ProgressState>(props.initial);
  const [mine, setMine] = useState<Mine | null>(null);
  const isCommerce = session?.user?.role === "COMERCIO";

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/pools/${poolId}/progreso`, { cache: "no-store" });
      if (res.ok) setProgress((await res.json()) as ProgressState);
    } catch {
      /* se reintenta en el próximo ciclo */
    }
  }, [poolId]);

  const loadMine = useCallback(async () => {
    if (!isCommerce) return;
    try {
      const res = await fetch(`/api/pools/${poolId}/mio`, { cache: "no-store" });
      if (res.ok) setMine((await res.json()) as Mine | null);
    } catch {
      /* ignorar */
    }
  }, [poolId, isCommerce]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!isCommerce) return;
    let cancelled = false;
    fetch(`/api/pools/${poolId}/mio`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Mine | null>) : null))
      .then((data) => {
        if (!cancelled) setMine(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [poolId, isCommerce]);

  // Después de sumarse/modificar se actualizan el progreso y la participación.
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await joinPoolAction(prev, fd);
    if (result.ok) await Promise.all([refresh(), loadMine()]);
    return result;
  }, initialActionState);

  const currentQty = mine && mine.status === "COMPROMETIDA" ? mine.quantity : 0;
  const maxAllowed = Math.max(0, Math.min(maxPerCommerce, progress.available + currentQty));
  const [qty, setQty] = useState<number>(minPerCommerce);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current && currentQty > 0) setQty(currentQty);
  }, [currentQty]);

  const clamp = (n: number) => Math.max(minPerCommerce, Math.min(maxAllowed || minPerCommerce, Math.round(n) || minPerCommerce));
  const total = qty * unitPriceCents;
  const saving = Math.max(0, retailUnitPriceCents - unitPriceCents) * qty;
  const canWithdraw = currentQty > 0 && progress.status === "ABIERTO";
  const canDecrease = progress.status === "ABIERTO";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" aria-live="polite">
        <ProgressBar value={progress.percentOfMinimum} size="lg" label={`Progreso del pool: ${progress.percentOfMinimum} % del mínimo`} />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-black tabular-nums">
            {formatInt(progress.committed)} / {formatInt(progress.minimum)} {unit.many}
          </p>
          <p className="text-sm font-semibold">
            {progress.committed >= progress.minimum
              ? "¡Mínimo alcanzado!"
              : `Faltan ${formatInt(progress.minimum - progress.committed)} para cerrar`}
          </p>
        </div>
        <p className="text-sm text-muted">
          Total del pool: {formatInt(progress.total)} {unit.many} · Quedan {formatInt(progress.available)} disponibles
        </p>
      </div>

      {sessionStatus === "loading" ? null : !session?.user ? (
        <div className="card flex flex-col gap-3 bg-brand-soft p-4">
          <p className="font-bold">Ingresá con tu comercio para sumarte a este pool.</p>
          <div className="flex flex-col gap-2">
            <Link href={`/ingresar?callbackUrl=/pools/${poolId}`} className={buttonClass("primary", "md", "w-full text-lg")}>
              Ingresar y sumarme
            </Link>
            <Link href="/registro" className={buttonClass("secondary", "md", "w-full")}>
              Crear cuenta gratis
            </Link>
          </div>
        </div>
      ) : !isCommerce ? (
        <Alert>Solo las cuentas de comercio pueden sumarse a un pool.</Alert>
      ) : mine && mine.status === "PENDIENTE_PAGO" ? (
        <div className="card flex flex-col gap-3 bg-brand p-4">
          <p className="text-lg font-black">El pool se cerró: pagá tu parte ({formatInt(mine.quantity)} {unit.many}).</p>
          {mine.paymentId ? (
            <Link href={`/comercio/pagos/${mine.paymentId}`} className={buttonClass("dark", "lg")}>
              Pagar ahora
            </Link>
          ) : null}
        </div>
      ) : mine && (mine.status === "PAGADA" || mine.status === "ENTREGADA") ? (
        <div className="card flex items-center gap-3 p-4">
          <CheckCircle2 aria-hidden="true" className="h-8 w-8 shrink-0" />
          <p className="font-bold">
            Ya pagaste tus {formatInt(mine.quantity)} {unit.many}.{" "}
            {mine.status === "ENTREGADA" ? "¡Entregado!" : "Te avisamos cuando se programe la entrega."}
          </p>
        </div>
      ) : !progress.acceptingJoins ? (
        <Alert>Este pool ya no acepta nuevas unidades.</Alert>
      ) : (
        <>
        <form action={formAction} className="card flex flex-col gap-4 p-4">
          <input type="hidden" name="poolId" value={poolId} />
          {currentQty > 0 ? (
            <p className="rounded-xl bg-brand-soft px-3 py-2 font-bold">
              Tenés {formatInt(currentQty)} {unit.many} reservadas. Podés cambiar la cantidad
              {canWithdraw ? " o retirarte" : ""} mientras el pool esté abierto.
            </p>
          ) : null}
          <div>
            <label htmlFor={`qty-${poolId}`} className="text-sm font-bold">
              ¿Cuántas {unit.many} querés?
            </label>
            <div className="mt-1.5 flex items-stretch gap-2">
              <button
                type="button"
                className={buttonClass("secondary", "icon")}
                aria-label="Restar una"
                disabled={qty <= minPerCommerce || (!canDecrease && qty <= currentQty)}
                onClick={() => {
                  touched.current = true;
                  setQty((q) => clamp(q - 1));
                }}
              >
                <Minus aria-hidden="true" />
              </button>
              <input
                id={`qty-${poolId}`}
                name="quantity"
                type="number"
                inputMode="numeric"
                min={canDecrease ? minPerCommerce : Math.max(minPerCommerce, currentQty)}
                max={maxAllowed}
                step={1}
                value={qty}
                onChange={(e) => {
                  touched.current = true;
                  setQty(Number(e.target.value));
                }}
                onBlur={() => setQty((q) => clamp(q))}
                className="field-input min-w-0 flex-1 text-center text-2xl font-black tabular-nums"
                aria-describedby={`qty-help-${poolId}`}
              />
              <button
                type="button"
                className={buttonClass("secondary", "icon")}
                aria-label="Sumar una"
                disabled={qty >= maxAllowed}
                onClick={() => {
                  touched.current = true;
                  setQty((q) => clamp(q + 1));
                }}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
            <p id={`qty-help-${poolId}`} className="mt-1 text-sm text-muted">
              Mínimo {formatInt(minPerCommerce)}, máximo {formatInt(Math.min(maxPerCommerce, maxAllowed))} por comercio.
            </p>
          </div>
          <div className="flex items-baseline justify-between border-t-2 border-ink pt-3">
            <span className="font-bold">Total</span>
            <span className="text-2xl font-black tabular-nums">{formatARS(total)}</span>
          </div>
          {saving > 0 ? <p className="-mt-2 text-right text-sm font-semibold">Ahorrás {formatARS(saving)} vs. precio minorista</p> : null}
          <p className="text-sm text-muted">
            No pagás ahora: te comprometés a comprar. Cuando el pool se cierra te mandamos el link de pago.
          </p>
          <FormMessage state={state} />
          <SubmitButton size="lg" pendingText="Reservando…" className="w-full" disabled={maxAllowed < minPerCommerce}>
            {currentQty > 0 ? "Actualizar mi cantidad" : "Sumarme al pool"}
          </SubmitButton>
        </form>
        {canWithdraw ? (
          <form
            action={formAction}
            onSubmit={(e) => {
              if (!window.confirm("¿Seguro que querés retirarte de este pool?")) e.preventDefault();
            }}
          >
            <input type="hidden" name="poolId" value={poolId} />
            <input type="hidden" name="quantity" value="0" />
            <button type="submit" className={buttonClass("ghost", "md", "w-full underline")}>
              Retirarme del pool
            </button>
          </form>
        ) : null}
        </>
      )}
    </div>
  );
}
