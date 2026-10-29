"use client";

import { useSyncExternalStore } from "react";

/**
 * Carrito del catálogo guardado en el navegador (localStorage). El precio es solo
 * informativo: al confirmar el pedido el servidor recalcula todo.
 */
export interface CartItem {
  productId: string;
  distributorId: string;
  distributorName: string;
  name: string;
  unitLabel: string;
  priceCents: number;
  minOrderQty: number;
  quantity: number;
}

const KEY = "pedila.carrito.v1";
const listeners = new Set<() => void>();
let cache: CartItem[] | null = null;

function read(): CartItem[] {
  if (cache) return cache;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: CartItem[]) {
  cache = items;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* almacenamiento lleno o deshabilitado: el carrito queda solo en memoria */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: CartItem[] = [];

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const cart = {
  add(item: Omit<CartItem, "quantity">, quantity: number) {
    const items = [...read()];
    const i = items.findIndex((x) => x.productId === item.productId);
    if (i >= 0) items[i] = { ...items[i]!, quantity: items[i]!.quantity + quantity };
    else items.push({ ...item, quantity });
    write(items);
  },
  setQuantity(productId: string, quantity: number) {
    write(read().map((x) => (x.productId === productId ? { ...x, quantity: Math.max(x.minOrderQty, quantity) } : x)));
  },
  remove(productId: string) {
    write(read().filter((x) => x.productId !== productId));
  },
  clearDistributor(distributorId: string) {
    write(read().filter((x) => x.distributorId !== distributorId));
  },
};
