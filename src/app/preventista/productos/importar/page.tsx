import type { Metadata } from "next";
import { CsvImportForm } from "@/components/products/product-forms";
import { Card, PageHeader } from "@/components/ui/display";
import { requirePageUser } from "@/server/auth/guards";
import { listCategories } from "@/server/queries/public";

export const metadata: Metadata = { title: "Importar productos" };

const EXAMPLE = `sku;nombre;categoria;precio;precio_minorista;marca;ean;unidad;unidades_por_bulto;pedido_minimo;descripcion;activo
YER-1KG;Yerba mate 1 kg;Infusiones;4.200,00;5.600,00;Playadito;7790000000018;UNIDAD;1;6;Con palo;si
ALF-24;Alfajor triple caja x 24;golosinas;18.500;28.800;Jorgito;;BULTO;24;1;;si`;

export default async function ImportPage() {
  await requirePageUser(["PREVENTISTA"], "/preventista/productos/importar");
  const categories = await listCategories();
  return (
    <>
      <PageHeader title="Importar productos por CSV" description="Si el SKU ya existe, el producto se actualiza; si no, se crea." />
      <div className="flex flex-col gap-6">
        <CsvImportForm />
        <Card>
          <h2 className="mb-2 text-lg font-black">Formato del archivo</h2>
          <ul className="list-disc pl-5 text-sm">
            <li>Separador <b>;</b> o <b>,</b> (se detecta solo). Codificación UTF-8 (podés exportarlo desde Excel o Google Sheets).</li>
            <li>Obligatorias: <b>sku, nombre, categoria, precio</b>. El precio acepta “1.234,56” o “1234.56”.</li>
            <li><b>unidad</b>: UNIDAD o BULTO. <b>activo</b>: si / no.</li>
            <li>Categorías válidas: {categories.map((c) => c.name).join(", ")}.</li>
          </ul>
          <pre className="mt-3 overflow-x-auto rounded-xl border-2 border-ink bg-brand-soft p-3 text-xs">{EXAMPLE}</pre>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + EXAMPLE + "\n")}`}
            download="plantilla-productos-pedila.csv"
            className="mt-3 inline-block font-bold underline underline-offset-4"
          >
            Descargar plantilla
          </a>
        </Card>
      </div>
    </>
  );
}
