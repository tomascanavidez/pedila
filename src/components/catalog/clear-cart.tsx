"use client";

import { useEffect } from "react";
import { cart } from "./cart-store";

/** Vacía del carrito los productos de un preventista una vez creado el pedido. */
export function ClearCartForDistributor({ distributorId }: { distributorId: string }) {
  useEffect(() => {
    cart.clearDistributor(distributorId);
  }, [distributorId]);
  return null;
}
