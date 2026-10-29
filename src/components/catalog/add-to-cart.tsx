"use client";

import { Check, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cart, useCart, type CartItem } from "./cart-store";

export function AddToCart({ item }: { item: Omit<CartItem, "quantity"> }) {
  const { data: session } = useSession();
  const items = useCart();
  const inCart = items.find((x) => x.productId === item.productId);
  const [qty, setQty] = useState(item.minOrderQty);
  if (session?.user && session.user.role !== "COMERCIO") return null;
  if (!session?.user) {
    return (
      <Link href="/ingresar?callbackUrl=/catalogo" className={buttonClass("secondary", "sm", "w-full")}>
        Ingresá para pedir
      </Link>
    );
  }
  return (
    <div className="flex items-stretch gap-2">
      <label className="sr-only" htmlFor={`q-${item.productId}`}>
        Cantidad de {item.name}
      </label>
      <input
        id={`q-${item.productId}`}
        type="number"
        inputMode="numeric"
        min={item.minOrderQty}
        step={1}
        value={qty}
        onChange={(e) => setQty(Math.max(item.minOrderQty, Math.round(Number(e.target.value)) || item.minOrderQty))}
        className="field-input w-20 px-2 text-center font-bold"
      />
      <button type="button" className={buttonClass("primary", "sm", "flex-1 min-h-[48px]")} onClick={() => cart.add(item, qty)}>
        {inCart ? <Check aria-hidden="true" className="h-4 w-4" /> : <ShoppingCart aria-hidden="true" className="h-4 w-4" />}
        {inCart ? `En el carrito (${inCart.quantity})` : "Agregar"}
      </button>
    </div>
  );
}

export function CartLink() {
  const items = useCart();
  if (items.length === 0) return null;
  return (
    <Link href="/comercio/carrito" className={buttonClass("dark", "md")}>
      <ShoppingCart aria-hidden="true" className="h-5 w-5" /> Ver carrito ({items.length})
    </Link>
  );
}
