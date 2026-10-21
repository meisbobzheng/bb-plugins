import type { ResultSet } from "../contract";

function csvCell(value: string | null): string {
  if (value === null) return "";
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(set: ResultSet): string {
  const header = set.columns.map((column) => csvCell(column.name)).join(",");
  return [header, ...set.rows.map((row) => row.map(csvCell).join(","))].join("\n");
}

export function toJson(set: ResultSet): string {
  const objects = set.rows.map((row) => Object.fromEntries(set.columns.map((column, index) => [column.name, row[index] ?? null])));
  return JSON.stringify(objects, null, 2);
}

function markdownCell(value: string | null): string {
  if (value === null) return "";
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

export function toMarkdown(set: ResultSet): string {
  const header = `| ${set.columns.map((column) => markdownCell(column.name)).join(" | ")} |`;
  const divider = `| ${set.columns.map(() => "---").join(" | ")} |`;
  return [header, divider, ...set.rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`)].join("\n");
}

export function exportFilename(connectionName: string, extension: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const slug = connectionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "query";
  return `${slug}-${stamp}.${extension}`;
}

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
