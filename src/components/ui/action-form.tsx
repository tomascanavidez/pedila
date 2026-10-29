"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { cn } from "./cn";
import { FormMessage, SubmitButton } from "./form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Formulario genérico para usar Server Actions desde páginas del servidor:
 * botón con estado "enviando", confirmación opcional y mensaje de resultado.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Procesando…",
  variant = "primary",
  size = "md",
  confirm,
  className,
  buttonClassName,
  resetOnSuccess = false,
  refreshOnSuccess = true,
  inline = false,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "dark";
  size?: "sm" | "md" | "lg";
  confirm?: string;
  className?: string;
  buttonClassName?: string;
  resetOnSuccess?: boolean;
  refreshOnSuccess?: boolean;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    if (refreshOnSuccess) router.refresh();
  }, [state, resetOnSuccess, refreshOnSuccess, router]);
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn(inline ? "inline-flex flex-col gap-2" : "flex flex-col gap-3", className)}
    >
      {children}
      <SubmitButton variant={variant} size={size} pendingText={pendingLabel} className={buttonClassName}>
        {submitLabel}
      </SubmitButton>
      <FormMessage state={state} />
      {!state.ok && state.fields && Object.keys(state.fields).length > 0 ? (
        // Estos formularios no marcan cada campo: se lista qué hay que corregir.
        <ul className="list-disc pl-5 text-sm font-semibold text-danger" role="alert">
          {[...new Set(Object.values(state.fields))].map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
