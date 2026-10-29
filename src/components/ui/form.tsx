"use client";

import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "./button";
import { cn } from "./cn";

import type { ActionState } from "@/lib/action-state";

export type { ActionState } from "@/lib/action-state";

interface FieldProps {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children?: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Envoltorio accesible: label asociado, ayuda y error conectados con aria-describedby. */
export function Field({ label, name, error, hint, required, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5" data-field={name}>
      <label htmlFor={id} className="text-sm font-bold">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children?.({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="text-sm font-semibold text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<ComponentProps<"input">, "id"> & { label: string; name: string; error?: string; hint?: ReactNode };

export function TextField({ label, name, error, hint, required, className, ...props }: InputProps) {
  return (
    <Field label={label} name={name} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          name={name}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn("field-input", className)}
          {...props}
        />
      )}
    </Field>
  );
}

type TextareaProps = Omit<ComponentProps<"textarea">, "id"> & { label: string; name: string; error?: string; hint?: ReactNode };

export function TextAreaField({ label, name, error, hint, required, className, ...props }: TextareaProps) {
  return (
    <Field label={label} name={name} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          name={name}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn("field-input min-h-[110px]", className)}
          {...props}
        />
      )}
    </Field>
  );
}

type SelectProps = Omit<ComponentProps<"select">, "id"> & {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  options: { value: string; label: string }[];
  placeholder?: string;
};

export function SelectField({ label, name, error, hint, required, options, placeholder, className, ...props }: SelectProps) {
  return (
    <Field label={label} name={name} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          name={name}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn("field-input appearance-auto", className)}
          {...props}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckboxField({
  label,
  name,
  hint,
  error,
  ...props
}: Omit<ComponentProps<"input">, "type" | "id"> & { label: ReactNode; name: string; hint?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          name={name}
          className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-[#111111]"
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        <span className="font-semibold">{label}</span>
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="ml-9 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ml-9 text-sm font-semibold text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Botón de envío que se deshabilita mientras la acción está en curso. */
export function SubmitButton({
  children,
  pendingText = "Guardando…",
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "secondary" | "dark"; size?: "sm" | "md" | "lg" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {pending ? pendingText : children}
    </button>
  );
}

/** Mensaje general del formulario (éxito o error), anunciado por lectores de pantalla. */
export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={cn(
        "rounded-xl border-2 px-4 py-3 font-semibold",
        state.ok ? "border-ink bg-brand-soft text-ink" : "border-danger bg-paper text-danger",
      )}
    >
      {state.message}
    </div>
  );
}
