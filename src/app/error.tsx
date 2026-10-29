"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-3xl font-black">Algo salió mal</h1>
      <p>Tuvimos un problema al cargar esta página. Probá de nuevo; si sigue pasando, escribinos.</p>
      {error.digest ? <p className="text-sm text-muted">Código: {error.digest}</p> : null}
      <Button onClick={() => reset()}>Reintentar</Button>
    </div>
  );
}
