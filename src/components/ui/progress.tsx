import { cn } from "./cn";

/** Barra de progreso accesible: amarillo sobre fondo claro con borde negro. */
export function ProgressBar({
  value,
  label,
  size = "md",
  className,
}: {
  /** 0 a 100 */
  value: number;
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label}
      className={cn(
        "relative w-full overflow-hidden rounded-full border-2 border-ink bg-paper",
        size === "sm" && "h-3",
        size === "md" && "h-4",
        size === "lg" && "h-6",
        className,
      )}
    >
      <div
        className={cn("h-full bg-brand transition-[width] duration-700 ease-out", v > 0 && v < 100 && "border-r-2 border-ink")}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
