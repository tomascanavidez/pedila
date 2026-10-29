import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "dark" | "ghost";
type Size = "md" | "lg" | "sm" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 font-bold transition-colors select-none disabled:cursor-not-allowed disabled:border-disabled disabled:bg-disabled-bg disabled:text-disabled aria-disabled:cursor-not-allowed aria-disabled:border-disabled aria-disabled:bg-disabled-bg aria-disabled:text-disabled";

const variants: Record<Variant, string> = {
  // Texto negro sobre amarillo (contraste AA).
  primary: "border-ink bg-brand text-ink hover:bg-brand-dark",
  secondary: "border-ink bg-paper text-ink hover:bg-brand-soft",
  dark: "border-ink bg-ink text-paper hover:bg-black",
  ghost: "border-transparent bg-transparent text-ink hover:bg-brand-soft",
};

const sizes: Record<Size, string> = {
  sm: "min-h-[40px] px-3 text-sm",
  md: "min-h-[48px] px-5 text-base",
  lg: "min-h-[56px] px-6 text-lg w-full sm:w-auto",
  icon: "h-14 w-14 shrink-0 p-0 text-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string): string {
  return cn(base, variants[variant], sizes[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode } & Omit<
  ComponentProps<typeof Link>,
  "href" | "className"
>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
