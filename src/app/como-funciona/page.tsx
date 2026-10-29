import type { Metadata } from "next";
import { computePoolCalculation } from "@/domain/commission";
import { formatARS } from "@/domain/money";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/display";

export const metadata: Metadata = {
  title: "Cómo funciona",
  description: "Así funcionan los pools de compra mayorista de PEDILA para comercios y preventistas.",
};

const example = computePoolCalculation({ inputCents: 150_000, bps: 800, mode: "DESCONTAR_AL_PREVENTISTA", totalUnits: 600, minUnitsToClose: 480 });

const FAQ = [
  { q: "¿Cuándo pago?", a: "Recién cuando el pool se cierra (se llegó al mínimo). Te mandamos el link de pago por email y lo ves en tu panel. Tenés un plazo (por defecto 48 h) para pagar con Mercado Pago." },
  { q: "¿Qué pasa si el pool no llega al mínimo?", a: "No se te cobra nada. El preventista puede extender la fecha una sola vez o aceptar cerrar con lo que se juntó; si no hace nada, el pool queda sin efecto." },
  { q: "¿Puedo cambiar mi cantidad o bajarme?", a: "Sí, mientras el pool esté abierto. Cuando ya llegó al mínimo podés sumar unidades pero no bajarte." },
  { q: "¿Y si alguien no paga?", a: "Sus unidades se liberan. Según la configuración, el pool se reabre para completar el volumen o se cierra con lo pagado. Si ya pagaste, tu lugar está asegurado." },
  { q: "¿Cuánto cobra PEDILA?", a: "Una comisión porcentual sobre cada pool vendido. El preventista la ve en vivo al cargar la oferta y queda fija desde que la publica." },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <header>
        <h1 className="text-3xl font-black sm:text-4xl">Cómo funciona PEDILA</h1>
        <p className="mt-2 text-lg">Juntamos a comercios chicos para que compren como uno grande.</p>
      </header>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="bg-brand">
          <h2 className="mb-2 text-xl font-black">Si tenés un comercio</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Elegí un pool de tu zona y sumate con las unidades que necesitás.</li>
            <li>Cuando se llega al mínimo, el pool se cierra y te llega el link de pago.</li>
            <li>Pagás al precio del pallet y el preventista te lo lleva al local.</li>
          </ol>
        </Card>
        <Card>
          <h2 className="mb-2 text-xl font-black">Si sos preventista</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Publicá una oferta por volumen: precio, mínimo para cerrar y zona.</li>
            <li>Los comercios se suman de a pocas unidades hasta completar el volumen.</li>
            <li>Cobrás todo junto, armás la hoja de reparto y entregás.</li>
          </ol>
        </Card>
      </section>
      <Card>
        <h2 className="mb-3 text-xl font-black">Un ejemplo con números</h2>
        <p>
          Un pallet de <b>600 unidades</b> a <b>{formatARS(example.pricing.unitPriceCents)}</b> cada una, con mínimo de 480 para cerrar. Un kiosco se suma con 10 unidades y paga{" "}
          {formatARS(example.pricing.unitPriceCents * 10)}, al mismo precio que si comprara el pallet entero.
        </p>
        <p className="mt-3">
          Si se vende todo el pallet, el total es <b>{formatARS(example.full.totalCents)}</b>. Con una comisión del 8 % que se descuenta del precio del preventista, PEDILA cobra{" "}
          <b>{formatARS(example.full.commissionCents)}</b> y el preventista recibe <b>{formatARS(example.full.netCents)}</b>.
        </p>
      </Card>
      <section aria-labelledby="faq">
        <h2 id="faq" className="mb-3 text-2xl font-black">
          Preguntas frecuentes
        </h2>
        <div className="flex flex-col gap-2">
          {FAQ.map((f) => (
            <details key={f.q} className="card p-4">
              <summary className="cursor-pointer font-bold">{f.q}</summary>
              <p className="mt-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
      <div className="flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/registro" size="lg">
          Registrá tu negocio
        </ButtonLink>
        <ButtonLink href="/" variant="secondary" size="lg">
          Ver pools abiertos
        </ButtonLink>
      </div>
    </div>
  );
}
