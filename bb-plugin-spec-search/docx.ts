import { setImmediate } from "node:timers/promises";
import { clauseDepth, normalizeClause } from "./specs.js";
import { unzip, type ZipLimits } from "./zip.js";

export interface Clause {
  clause: string;
  title: string;
  depth: number;
  body: string;
}

export interface Cover {
  kind: string | null;
  spec: string | null;
  version: string | null;
  title: string | null;
}

export interface SpecDocument extends Cover {
  clauses: Clause[];
}

const DOCX_LIMITS: ZipLimits = { entries: 2_000, entryBytes: 200_000_000, totalBytes: 250_000_000 };

const TOKENS = /<(\/?)([\w.-]+:)?([\w.-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const STYLE_ID = /\bw:val\s*=\s*"([^"]*)"/;
const SEGMENT = String.raw`\d+(?:[A-Za-z]\d*)?`;
const NUMBERED = new RegExp(String.raw`^((?:[A-Z]{1,2}|${SEGMENT})(?:\.${SEGMENT})+|${SEGMENT})[\t ]+(\S.*)$`);
const ANNEX = /^Annex\s+([A-Z]{1,2})\b\s*(?:\(([^)]*)\))?\s*:?\s*(.*)$/i;
const COVER_ID = /3GPP\s+(TS|TR)\s+(\d{2}\.\d{3}(?:-\d{1,2})?)\s+V(\d+\.\d+\.\d+)/;
const COVER_BOILERPLATE = /^(3rd Generation Partnership Project|Technical Specification Group|\(Release \d+\))/i;
const YIELD_EVERY = 20_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function tidy(text: string): string {
  return text.replace(/[   ]/g, " ").replace(/[ \t]+/g, " ").trim();
}

function headingStyles(stylesXml: string): Map<string, string> {
  const styles = new Map<string, string>();
  for (const match of stylesXml.matchAll(/<w:style\b[^>]*\bw:styleId="([^"]*)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const name = /<w:name\b[^>]*\bw:val="([^"]*)"/.exec(match[2] ?? "")?.[1];
    if (name !== undefined) styles.set(match[1] ?? "", name.toLowerCase());
  }
  return styles;
}

function isHeading(style: string): boolean {
  return /^heading \d$/.test(style) || style === "h6";
}

export function headingClause(text: string): { clause: string; title: string } | null {
  const annex = ANNEX.exec(text);
  if (annex !== null) {
    const qualifier = annex[2] ? ` (${annex[2].trim()})` : "";
    return { clause: annex[1]!.toUpperCase(), title: `Annex ${annex[1]!.toUpperCase()}${qualifier}: ${annex[3]!.trim()}`.replace(/: $/, "") };
  }
  const numbered = NUMBERED.exec(text);
  if (numbered !== null) return { clause: normalizeClause(numbered[1]!), title: numbered[2]!.trim() };
  return text === "" ? null : { clause: text, title: text };
}

function readCover(lines: ReadonlyArray<{ style: string; text: string }>): Cover {
  const id = lines.map(({ text }) => COVER_ID.exec(text)).find((match) => match !== null);
  const title = lines
    .filter(({ style, text }) => style === "zt" && !COVER_BOILERPLATE.test(text))
    .map(({ text }) => text)
    .join(" ")
    .replace(/;$/, "");
  return { kind: id?.[1] ?? null, spec: id?.[2] ?? null, version: id?.[3] ?? null, title: title === "" ? null : title };
}

async function parseDocumentXml(xml: string, styles: Map<string, string>, signal?: AbortSignal): Promise<SpecDocument> {
  const clauses: Clause[] = [];
  const cover: Array<{ style: string; text: string }> = [];
  let current: { clause: string; title: string; lines: string[] } | null = null;
  let style = "";
  let paragraph = "";
  let inText = false;
  let inRun = false;
  let skip = 0;
  let table = 0;
  let cell: string[] = [];
  let row: string[] = [];
  let tokens = 0;

  const close = () => {
    if (current !== null) clauses.push({ clause: current.clause, title: current.title, depth: clauseDepth(current.clause), body: current.lines.join("\n") });
  };
  const line = (text: string) => {
    if (text !== "" && current !== null) current.lines.push(text);
  };

  TOKENS.lastIndex = 0;
  for (let match = TOKENS.exec(xml); match !== null; match = TOKENS.exec(xml)) {
    if (++tokens % YIELD_EVERY === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    const [, closing, prefix, name, attributes, selfClosing, text] = match;
    if (text !== undefined) {
      if (inText && skip === 0) paragraph += decode(text);
      continue;
    }
    if ((prefix === "mc:" && name === "Fallback") || (prefix === "w:" && name === "txbxContent")) {
      if (!selfClosing) skip += closing ? -1 : 1;
      continue;
    }
    if (prefix !== "w:" || skip > 0) continue;
    switch (name) {
      case "r":
        inRun = !closing && !selfClosing;
        break;
      case "t":
        inText = !closing && !selfClosing;
        break;
      case "tab":
        if (inRun && !closing) paragraph += "\t";
        break;
      case "br":
      case "cr":
        if (inRun && !closing) paragraph += " ";
        break;
      case "noBreakHyphen":
        if (inRun && !closing) paragraph += "-";
        break;
      case "pStyle":
        style = STYLE_ID.exec(attributes ?? "")?.[1] ?? "";
        break;
      case "p":
        if (!closing) {
          if (selfClosing) break;
          style = "";
          paragraph = "";
          break;
        }
        {
          const styleName = styles.get(style) ?? style.toLowerCase();
          const raw = paragraph.replace(/ /g, " ").trim();
          const text = tidy(paragraph);
          const heading = table === 0 && isHeading(styleName) ? headingClause(raw) : null;
          if (heading !== null) {
            close();
            current = { clause: heading.clause, title: tidy(heading.title), lines: [] };
          } else if (current === null) {
            if (text !== "") cover.push({ style: styleName, text });
          } else if (table > 0) {
            if (text !== "") cell.push(text);
          } else {
            line(text);
          }
          paragraph = "";
        }
        break;
      case "tbl":
        if (!selfClosing) table += closing ? -1 : 1;
        break;
      case "tc":
        if (closing && table === 1) {
          row.push(cell.join(" "));
          cell = [];
        }
        break;
      case "tr":
        if (closing && table === 1) {
          if (row.some((value) => value !== "")) line(row.join(" | "));
          row = [];
        }
        break;
    }
  }
  close();
  return { ...readCover(cover), clauses };
}

export async function parseDocx(file: Buffer, signal?: AbortSignal): Promise<SpecDocument> {
  const parts = new Map(unzip(file, (name) => name === "word/document.xml" || name === "word/styles.xml", DOCX_LIMITS).map((part) => [part.name, part.data]));
  const document = parts.get("word/document.xml");
  if (document === undefined) throw new Error("The file is not a Word document: it has no word/document.xml.");
  const styles = headingStyles(parts.get("word/styles.xml")?.toString("utf8") ?? "");
  return parseDocumentXml(document.toString("utf8"), styles, signal);
}
