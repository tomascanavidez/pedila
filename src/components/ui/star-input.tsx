"use client";

import { useId, useState } from "react";
import { cn } from "./cn";

/** Selector de 1 a 5 estrellas accesible (radio buttons). */
export function StarInput({ name = "stars", label = "Calificación" }: { name?: string; label?: string }) {
  const [value, setValue] = useState(0);
  const id = useId();
  return (
    <fieldset>
      <legend className="text-sm font-bold">{label}</legend>
      <div className="mt-1 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} htmlFor={`${id}-${n}`} className="cursor-pointer">
            <input id={`${id}-${n}`} type="radio" name={name} value={n} className="peer sr-only" required onChange={() => setValue(n)} />
            <span
              aria-hidden="true"
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl border-2 border-ink text-2xl peer-focus-visible:outline peer-focus-visible:outline-3",
                n <= value ? "bg-brand" : "bg-paper",
              )}
            >
              ★
            </span>
            <span className="sr-only">
              {n} {n === 1 ? "estrella" : "estrellas"}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
