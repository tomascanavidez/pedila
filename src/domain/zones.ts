/** Zonas de entrega: una zona sin localidad cubre toda la provincia. */
export interface ZoneRef {
  provinceId: number;
  localityId: number | null;
}

export interface LocationRef {
  provinceId: number;
  localityId: number;
}

export function isInZone(zones: readonly ZoneRef[], location: LocationRef): boolean {
  return zones.some(
    (z) => z.provinceId === location.provinceId && (z.localityId === null || z.localityId === location.localityId),
  );
}

/** Elimina duplicados y localidades redundantes cuando ya está toda la provincia. */
export function normalizeZones(zones: readonly ZoneRef[]): ZoneRef[] {
  const wholeProvinces = new Set(zones.filter((z) => z.localityId === null).map((z) => z.provinceId));
  const seen = new Set<string>();
  const result: ZoneRef[] = [];
  for (const z of zones) {
    if (z.localityId !== null && wholeProvinces.has(z.provinceId)) continue;
    const key = `${z.provinceId}:${z.localityId ?? "*"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ provinceId: z.provinceId, localityId: z.localityId });
  }
  return result;
}
