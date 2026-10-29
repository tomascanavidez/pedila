import Link from "next/link";

/** Logo tipográfico: "PEDILA" en negro con un subrayado amarillo de marca. */
export function Logo({ size = "md", href = "/" }: { size?: "sm" | "md" | "lg"; href?: string | null }) {
  const text = size === "lg" ? "text-4xl" : size === "sm" ? "text-xl" : "text-2xl";
  const mark = (
    <span className={`relative inline-block font-black tracking-tight text-ink ${text}`}>
      PEDILA
      <span aria-hidden="true" className="absolute -bottom-0.5 left-0 h-[0.28em] w-full -z-10 rounded-sm bg-brand" />
      <span aria-hidden="true" className="text-ink">.</span>
    </span>
  );
  if (href === null) return <span className="isolate">{mark}</span>;
  return (
    <Link href={href} className="isolate inline-flex items-center" aria-label="PEDILA, ir al inicio">
      {mark}
    </Link>
  );
}
