"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/dates";

/**
 * Cuenta regresiva hasta una fecha. En el render del servidor muestra la fecha fija
 * (sin "ahora") para evitar diferencias de hidratación; en el navegador se actualiza
 * cada 30 segundos.
 */
export function Countdown({ to, fallback, className }: { to: string; fallback: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const target = new Date(to).getTime();
    const tick = () => setText(formatCountdown(target - Date.now()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [to]);
  return (
    <time dateTime={to} className={className} suppressHydrationWarning>
      {text ?? fallback}
    </time>
  );
}
