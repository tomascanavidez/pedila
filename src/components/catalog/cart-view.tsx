"use client";

import { Trash } from "lucide-react";
import { useActionState } from "react";
import { formatARS } from "@/domain/money";
import { initialActionState } from "@/lib/action-state";
import { formatInt } from "@/lib/labels";
import { createOrderAction } from "@/server/actions/commerce";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { cart, useCart, type CartItem } from "./cart-store";

function DistributorCart({ distributorId, items }: { distributorId: string; items: CartItem[] }) {
  const [state, action] = useActionState(createOrderAction, initialActionState);
  const total = items.reduce((a, i) => a + i.priceCents * i.quantity, 0);
  return (
    <section className="card p-4" aria-labelledby={`cart-${distributorId}`}>
      <h2 id={`cart-${distributorId}`} className="mb-3 text-lg font-black">
        Pedido a {items[0]?.distributorName}
      </h2>
      <ul className="flex flex-col divide-y-2 divide-line">
        {items.map((i) => (
          <li key={i.productId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">{i.name}</p>
              <p className="text-sm text-muted">
                {formatARS(i.priceCents)} por {i.unitLabel} · mínimo {formatInt(i.minOrderQty)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`cq-${i.productId}`}>
                Cantidad de {i.name}
              </label>
              <input
                id={`cq-${i.productId}`}
                type="number"
                min={i.minOrderQty}
                value={i.quantity}
                onChange={(e) => cart.setQuantity(i.productId, Math.round(Number(e.target.value)) || i.minOrderQty)}
                className="field-input w-24 text-center font-bold"
              />
              <span className="w-28 text-right font-bold tabular-nums">{formatARS(i.priceCents * i.quantity)}</span>
              <button
                type="button"
                onClick={() => cart.remove(i.productId)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-ink hover:bg-brand-soft"
                aria-label={`Quitar ${i.name}`}
              >
                <Trash aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form action={action} className="mt-3 flex flex-col gap-3 border-t-2 border-ink pt-3">
        <input type="hidden" name="distributorId" value={distributorId} />
        <input type="hidden" name="lines" value={JSON.stringify(items.map((i) => ({ productId: i.productId, quantity: i.quantity })))} />
        <label className="flex flex-col gap-1 text-sm font-bold">
          Nota para el preventista (opcional)
          <textarea name="notes" maxLength={500} className="field-input min-h-[70px]" placeholder="Horario de recepción, referencias…" />
        </label>
        <div className="flex items-baseline justify-between">
          <span className="font-bold">Total estimado</span>
          <span className="text-2xl font-black tabular-nums">{formatARS(total)}</span>
        </div>
        <p className="text-sm text-muted">El total final lo confirma el sistema al crear el pedido. Pagás con Mercado Pago.</p>
        <FormMessage state={state} />
        <SubmitButton size="lg" pendingText="Creando pedido…" className="w-full">
          Confirmar pedido y pagar
        </SubmitButton>
      </form>
    </section>
  );
}

export function CartView() {
  const items = useCart();
  if (items.length === 0) {
    return (
      <EmptyState title="Tu carrito está vacío" action={<ButtonLink href="/catalogo">Ir al catálogo</ButtonLink>}>
        Agregá productos del catálogo de los preventistas de tu zona.
      </EmptyState>
    );
  }
  const groups = new Map<string, CartItem[]>();
  for (const i of items) groups.set(i.distributorId, [...(groups.get(i.distributorId) ?? []), i]);
  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([id, list]) => (
        <DistributorCart key={id} distributorId={id} items={list} />
      ))}
    </div>
  );
}
