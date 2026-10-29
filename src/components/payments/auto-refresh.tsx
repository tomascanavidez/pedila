"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Mientras se espera el webhook de confirmación, recarga los datos cada 4 s (máx. 1 min). */
export function PaymentAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      router.refresh();
      if (n >= 15) window.clearInterval(id);
    }, 4_000);
    return () => window.clearInterval(id);
  }, [router]);
  return (
    <p className="text-sm text-muted" role="status">
      Esperando la confirmación de Mercado Pago…
    </p>
  );
}
