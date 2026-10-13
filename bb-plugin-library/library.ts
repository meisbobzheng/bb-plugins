export const LIBRARY_PANEL = "library";
export const CHANGED_CHANNEL = "library-changed";
export const MARK_START = "\u0002";
export const MARK_END = "\u0003";

export const KINDS = ["flow", "diagram", "explanation", "design", "reference", "note"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, { one: string; many: string }> = {
  flow: { one: "Flow", many: "Flows" },
  diagram: { one: "Diagram", many: "Diagrams" },
  explanation: { one: "Explanation", many: "Explanations" },
  design: { one: "Design doc", many: "Design docs" },
  reference: { one: "Reference", many: "References" },
  note: { one: "Note", many: "Notes" },
};

export const LIMITS = {
  title: 200,
  summary: 500,
  body: 500_000,
  tag: 40,
  tags: 20,
  query: 500,
  results: 200,
} as const;

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export function guessKind(body: string): Kind {
  if (/```mermaid\s+sequenceDiagram/.test(body) || /\b(call|message|signall?ing|registration|attach)\s+flows?\b/i.test(body)) {
    return "flow";
  }
  if (/```mermaid/.test(body) || /[┌┐└┘├┤│─]{3,}/.test(body)) return "diagram";
  if (/^#{1,3}\s*(design|architecture|proposal|requirements)\b/im.test(body)) return "design";
  return "explanation";
}

function plainLine(line: string): string {
  return line
    .replace(/^\s*(#{1,6}|[-*+]|\d+[.)]|>)\s+/, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

export function guessTitle(body: string): string {
  const prose = body.replace(/```[\s\S]*?(```|$)/g, "");
  const heading = /^#{1,3}\s+(.+)$/m.exec(prose)?.[1];
  const firstLine = prose.split("\n").find((line) => plainLine(line) !== "");
  const title = plainLine(heading ?? firstLine ?? "").replace(/[:.]$/, "");
  return truncate(title === "" ? "Untitled" : title, 80);
}

export function excerpt(body: string, limit: number): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .map(plainLine)
    .filter((line) => line !== "")
    .join(" ");
  return truncate(text.replace(/\s+/g, " ").trim(), limit);
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
