import type { Draft, Finding, Severity, Side } from "./contract.js";

export const FINDING_COLOR = "#f59e0b";
export const DRAFT_COLOR = "#8b5cf6";
const MAX_HIGHLIGHT_LINES = 400;

export type DiffStyle = "split" | "unified";

interface LineSpan {
  side: Side;
  startLine: number;
  endLine: number;
}

const FINDING_MIX: Record<Severity, number> = { blocker: 66, major: 72, minor: 80, nit: 86 };

function lineSelectors(span: LineSpan, diffStyle: DiffStyle, attribute: "data-line" | "data-column-number"): string[] {
  const scope =
    diffStyle === "split"
      ? (line: number) => `[data-${span.side}] [${attribute}="${line}"]`
      : (line: number) =>
          `[${attribute}="${line}"]${span.side === "deletions" ? '[data-line-type="change-deletion"]' : ':not([data-line-type="change-deletion"])'}`;
  const last = Math.min(span.endLine, span.startLine + MAX_HIGHLIGHT_LINES);
  const selectors: string[] = [];
  for (let line = span.startLine; line <= last; line++) selectors.push(scope(line));
  return selectors;
}

function rule(spans: readonly LineSpan[], diffStyle: DiffStyle, color: string, mix: number): string {
  if (spans.length === 0) return "";
  const background = `--diffs-line-bg: color-mix(in lab, var(--diffs-bg) ${mix}%, ${color}) !important;`;
  const content = spans.flatMap((span) => lineSelectors(span, diffStyle, "data-line"));
  const gutter = spans.flatMap((span) => lineSelectors(span, diffStyle, "data-column-number"));
  return [
    `${content.join(",")}{${background}}`,
    `${gutter.join(",")}{${background}color:${color} !important;box-shadow:inset 3px 0 0 ${color};}`,
  ].join("\n");
}

export function highlightCss(findings: readonly Finding[], drafts: readonly Draft[], diffStyle: DiffStyle): string {
  const bySeverity = new Map<Severity, LineSpan[]>();
  for (const finding of findings) {
    if (finding.dismissed || finding.startLine === null || finding.endLine === null) continue;
    const spans = bySeverity.get(finding.severity) ?? [];
    spans.push({ side: finding.side, startLine: finding.startLine, endLine: finding.endLine });
    bySeverity.set(finding.severity, spans);
  }
  return [
    rule(drafts, diffStyle, DRAFT_COLOR, 86),
    ...[...bySeverity].map(([severity, spans]) => rule(spans, diffStyle, FINDING_COLOR, FINDING_MIX[severity])),
  ]
    .filter((css) => css.length > 0)
    .join("\n");
}
