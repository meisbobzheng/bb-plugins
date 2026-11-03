export const DEFAULT_RELEASE = 19;

const SPEC = String.raw`(?:(?:3gpp\s*)?(?:(?:ts|tr)\s*)?(\d{2})\.(\d{3})(-\d{1,2})?|(?:ts|tr)\s*(\d{2})(\d{3})(-\d{1,2})?)(?!\d)`;
const SEGMENT = String.raw`\d+(?:[a-z]\d*)?`;
const CLAUSE = String.raw`annex\s+[a-z]{1,2}(?:\.${SEGMENT})*|[a-z]{1,2}(?:\.${SEGMENT})+|[a-z](?=\s*$)|${SEGMENT}(?:\.${SEGMENT})*`;
const QUERY = new RegExp(String.raw`^\s*${SPEC}(?:(?:\s*§\s*|\s+(?:(?:clause|section)\s+)?)(${CLAUSE})(?![\w.-]))?\s*(.*)$`, "is");
const SPEC_ONLY = new RegExp(String.raw`^\s*${SPEC}\s*$`, "i");

export interface ParsedQuery {
  spec: string | null;
  clause: string | null;
  text: string;
}

function specFrom(match: RegExpMatchArray): string {
  const series = match[1] ?? match[4];
  const number = match[2] ?? match[5];
  const part = match[3] ?? match[6] ?? "";
  return `${series}.${number}${part}`;
}

export function normalizeSpec(input: string): string | null {
  const match = SPEC_ONLY.exec(input);
  return match === null ? null : specFrom(match);
}

export function normalizeClause(input: string): string {
  const clause = input.trim().replace(/^annex\s+/i, "");
  return /^[a-z]{1,2}(?:\.|$)/i.test(clause) ? clause.replace(/^[a-z]{1,2}/i, (letters) => letters.toUpperCase()) : clause;
}

export function parseQuery(query: string): ParsedQuery {
  const match = QUERY.exec(query);
  if (match === null) return { spec: null, clause: null, text: query.trim() };
  const clause = match[7];
  return { spec: specFrom(match), clause: clause === undefined ? null : normalizeClause(clause), text: (match[8] ?? "").trim() };
}

export function compactSpec(spec: string): string {
  return spec.replace(".", "");
}

export function seriesOf(spec: string): string {
  return spec.slice(0, 2);
}

export function versionFromCode(code: string): string {
  return [...code].map((digit) => String(parseInt(digit, 36))).join(".");
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function releaseOf(version: string): number {
  return Number(version.split(".")[0]);
}

export function clauseDepth(clause: string): number {
  return clause.split(".").length;
}

export function citation(kind: string, spec: string, clause?: string | null): string {
  return clause ? `${kind} ${spec} §${clause}` : `${kind} ${spec}`;
}

export function specPage(spec: string): string {
  return `https://www.3gpp.org/DynaReport/${compactSpec(spec).replace(/-.*/, "")}.htm`;
}
