import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-16">
      <p className="rounded-full border-2 border-ink bg-brand px-3 py-1 font-black">404</p>
      <h1 className="text-3xl font-black">No encontramos esta página</h1>
      <p>Puede que el pool ya no esté disponible o que el link esté incompleto.</p>
      <ButtonLink href="/">Ver pools abiertos</ButtonLink>
    </div>
  );
}
