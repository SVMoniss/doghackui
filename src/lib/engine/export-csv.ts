/**
 * CSV builder shared by every export stage (assignments, reviews, results).
 * RFC 4180 quoting: wrap in double quotes, double embedded quotes.
 */

export function toCsvRows(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [header.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))].join("\n");
}
