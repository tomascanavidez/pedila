import type { Metadata } from "next";
import { CartView } from "@/components/catalog/cart-view";
import { PageHeader } from "@/components/ui/display";

export const metadata: Metadata = { title: "Carrito" };

export default function CartPage() {
  return (
    <>
      <PageHeader title="Carrito" description="Se arma un pedido por cada preventista." />
      <CartView />
    </>
  );
}
