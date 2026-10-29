/**
 * CSV sin dependencias.
 * - Exportación: separador ";" + BOM UTF-8 (lo que espera Excel configurado en español),
 *   con protección contra inyección de fórmulas (celdas que empiezan con = + - @).
 * - Importación: RFC 4180 (comillas, comillas escapadas, saltos de línea dentro de
 *   campos), con detección automática de separador "," o ";".
 */
export type CsvCell = string | number | boolean | null | undefined | Date;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: CsvCell, delimiter: string): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCSV(rows: readonly (readonly CsvCell[])[], opts: { delimiter?: string; bom?: boolean } = {}): string {
  const delimiter = opts.delimiter ?? ";";
  const body = rows.map((r) => r.map((c) => escapeCell(c, delimiter)).join(delimiter)).join("\r\n");
  return (opts.bom ?? true ? "﻿" : "") + body + "\r\n";
}

export function detectDelimiter(firstLine: string): string {
  const semi = (firstLine.match(/;/g) ?? []).length;
  const comma = (firstLine.match(/,/g) ?? []).length;
  return semi > comma ? ";" : ",";
}

export function parseCSV(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const d = delimiter ?? detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === d) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (ch === "\r" && src[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Convierte filas a objetos usando la primera fila como encabezado (normalizado a minúsculas). */
export function csvToObjects(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCSV(text);
  const [header, ...data] = rows;
  if (!header) return { headers: [], records: [] };
  const headers = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "_"),
  );
  const records = data.map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, records };
}
