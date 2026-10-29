import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/pools/", "/catalogo", "/preventistas/", "/como-funciona"], disallow: ["/admin", "/preventista", "/comercio", "/api/", "/pagos/"] }],
  };
}
