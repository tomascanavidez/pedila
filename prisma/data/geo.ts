/**
 * Provincias argentinas (código INDEC) y una selección inicial de localidades.
 * Los datos viven en geo.json para que también los use scripts/inicializar-produccion.mjs.
 * El admin puede sumar más localidades desde /admin/zonas.
 */
import data from "./geo.json";

export const PROVINCES: { id: number; name: string; localities: string[] }[] = data;
