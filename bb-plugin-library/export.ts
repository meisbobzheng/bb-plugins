import { Marked, type Tokens } from "marked";
import type { Entry } from "./contract.js";
import { specUrl, specsFor } from "./glossary.js";
import { KIND_LABELS, TAG_GROUP_INFO, groupTags } from "./library.js";

export interface ExportTheme {
  background: string;
  foreground: string;
}

export const LIGHT_THEME: ExportTheme = { background: "#ffffff", foreground: "#1f2328" };

export interface RenderedEntry {
  title: string;
  css: string;
  body: string;
  diagramsMissing: boolean;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const SAFE_LINK = /^(?:https?:|mailto:|#)/i;
const SAFE_IMAGE = /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp);)/i;
const NAME_LIMIT = 120;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}

export function fileName(title: string, extension: string): string {
  const base = title
    .replace(/\s*:\s*/g, " - ")
    .replace(/[\\/*?"<>|]+/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, NAME_LIMIT)
    .trim();
  return `${base === "" ? "library-entry" : base}.${extension}`;
}

function yaml(value: string): string {
  return JSON.stringify(value);
}

export function entryMarkdown(entry: Entry): string {
  const header = ["---", `title: ${yaml(entry.title)}`, `library_id: ${entry.id}`, `kind: ${entry.kind}`];
  if (entry.summary !== "") header.push(`summary: ${yaml(entry.summary)}`);
  const groups = groupTags(entry.tags);
  if (groups.length > 0) {
    header.push("tags:", ...groups.map(({ group, tags }) => `  ${group}: [${tags.map(({ tag }) => yaml(tag)).join(", ")}]`));
  }
  if (entry.source.threadTitle !== null) header.push(`source: ${yaml(entry.source.threadTitle)}`);
  header.push(`created: ${entry.createdAt}`, `updated: ${entry.updatedAt}`, "---", "");
  const body = entry.body.trim();
  const firstLine = body.split("\n", 1)[0]?.trim() ?? "";
  const titled = firstLine === `# ${entry.title}`;
  return `${header.join("\n")}\n${titled ? "" : `# ${entry.title}\n\n`}${body}\n`;
}

function markdownToHtml(markdown: string, diagrams: readonly string[]): string {
  let next = 0;
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      code({ text, lang }: Tokens.Code) {
        if (lang?.trim().toLowerCase() === "mermaid" && next < diagrams.length) {
          return `<figure class="diagram">${diagrams[next++]}</figure>\n`;
        }
        const language = lang === undefined || lang === "" ? "" : ` class="language-${escapeHtml(lang.split(/\s/)[0]!)}"`;
        return `<pre><code${language}>${escapeHtml(text)}</code></pre>\n`;
      },
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      link({ href, title, tokens }: Tokens.Link) {
        const label = this.parser.parseInline(tokens);
        if (!SAFE_LINK.test(href)) return label;
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${label}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        if (!SAFE_IMAGE.test(href)) return escapeHtml(text);
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
      },
    },
  });
  return marked.parse(markdown, { async: false });
}

function countMermaid(markdown: string): number {
  return new Marked({ gfm: true })
    .lexer(markdown)
    .filter((token): token is Tokens.Code => token.type === "code" && (token as Tokens.Code).lang?.trim().toLowerCase() === "mermaid").length;
}

function exportCss(theme: ExportTheme): string {
  const muted = `color-mix(in srgb, ${theme.foreground} 62%, ${theme.background})`;
  const border = `color-mix(in srgb, ${theme.foreground} 18%, ${theme.background})`;
  const tint = `color-mix(in srgb, ${theme.foreground} 6%, ${theme.background})`;
  return `
.library-export { color: ${theme.foreground}; background: ${theme.background}; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; max-width: 860px; margin: 0 auto; padding: 32px 24px; box-sizing: border-box; }
.library-export * { box-sizing: border-box; }
.library-export header { border-bottom: 1px solid ${border}; margin: 0 0 1.5em; padding: 0 0 1em; }
.library-export h1 { font-size: 1.9em; line-height: 1.25; font-weight: 650; margin: 0 0 0.35em; }
.library-export h2 { font-size: 1.45em; line-height: 1.3; font-weight: 650; margin: 1.6em 0 0.6em; padding-bottom: 0.25em; border-bottom: 1px solid ${border}; }
.library-export h3 { font-size: 1.2em; font-weight: 650; margin: 1.4em 0 0.5em; }
.library-export h4, .library-export h5, .library-export h6 { font-size: 1em; font-weight: 650; margin: 1.2em 0 0.4em; }
.library-export p, .library-export ul, .library-export ol, .library-export pre, .library-export table, .library-export blockquote, .library-export figure { margin: 0 0 1em; }
.library-export ul { list-style: disc; padding-left: 1.6em; }
.library-export ol { list-style: decimal; padding-left: 1.6em; }
.library-export li + li { margin-top: 0.25em; }
.library-export a { color: inherit; text-decoration: underline; }
.library-export strong { font-weight: 650; }
.library-export em { font-style: italic; }
.library-export code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: ${tint}; padding: 0.1em 0.35em; border-radius: 4px; }
.library-export pre { background: ${tint}; border: 1px solid ${border}; border-radius: 6px; padding: 12px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.library-export pre code { background: none; padding: 0; font-size: 0.85em; }
.library-export blockquote { border-left: 3px solid ${border}; padding: 0 1em; color: ${muted}; }
.library-export table { border-collapse: collapse; width: 100%; }
.library-export th, .library-export td { border: 1px solid ${border}; padding: 6px 10px; text-align: left; vertical-align: top; }
.library-export th { background: ${tint}; font-weight: 650; }
.library-export hr { border: 0; border-top: 1px solid ${border}; margin: 1.5em 0; }
.library-export img, .library-export svg { max-width: 100%; height: auto; }
.library-export figure.diagram { text-align: center; }
.library-export figure.diagram svg { display: inline-block; }
.library-export .meta, .library-export .summary { color: ${muted}; margin: 0 0 0.6em; }
.library-export .tags { display: grid; grid-template-columns: max-content 1fr; gap: 0.3em 0.8em; margin: 0.6em 0 0; font-size: 0.9em; }
.library-export .tags dt { color: ${muted}; }
.library-export .tags dd { margin: 0; }
.library-export .tag { display: inline-block; border: 1px solid ${border}; border-radius: 999px; padding: 0 0.55em; margin: 0 0.3em 0.3em 0; }
@media print {
  .library-export { max-width: none; padding: 0; }
  .library-export pre, .library-export table, .library-export figure, .library-export blockquote { break-inside: avoid; }
  .library-export h1, .library-export h2, .library-export h3 { break-after: avoid; }
}`;
}

function headerHtml(entry: Entry): string {
  const meta = [KIND_LABELS[entry.kind].one, `Saved ${entry.createdAt.slice(0, 10)}`];
  if (entry.source.threadTitle !== null) meta.push(`from “${entry.source.threadTitle}”`);
  const tags = groupTags(entry.tags)
    .map(
      ({ group, tags: members }) =>
        `<dt>${escapeHtml(TAG_GROUP_INFO[group].label)}</dt><dd>${members.map(({ tag }) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</dd>`,
    )
    .join("");
  const specs = specsFor(
    entry.tags.map(({ tag }) => tag),
    entry.body,
  ).map((spec) => {
    const url = specUrl(spec);
    return url === null ? escapeHtml(spec) : `<a href="${escapeHtml(url)}">${escapeHtml(spec)}</a>`;
  });
  return [
    "<header>",
    `<h1>${escapeHtml(entry.title)}</h1>`,
    `<p class="meta">${meta.map(escapeHtml).join(" · ")}</p>`,
    entry.summary === "" ? "" : `<p class="summary">${escapeHtml(entry.summary)}</p>`,
    tags === "" ? "" : `<dl class="tags">${tags}</dl>`,
    specs.length === 0 ? "" : `<p class="meta">Specs: ${specs.join(", ")}</p>`,
    "</header>",
  ].join("");
}

export function renderEntry(entry: Entry, diagrams: readonly string[], theme: ExportTheme): RenderedEntry {
  const expected = countMermaid(entry.body);
  const usable = diagrams.length === expected ? diagrams : [];
  return {
    title: entry.title,
    css: exportCss(theme),
    body: `${headerHtml(entry)}${markdownToHtml(entry.body, usable)}`,
    diagramsMissing: expected > 0 && usable.length === 0,
  };
}

export function htmlDocument(rendered: RenderedEntry, theme: ExportTheme): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(rendered.title)}</title>`,
    `<style>html, body { margin: 0; background: ${theme.background}; }${rendered.css}</style>`,
    "</head>",
    "<body>",
    `<article class="library-export">${rendered.body}</article>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export function printCss(rootId: string, theme: ExportTheme): string {
  return `
@media screen { #${rootId} { display: none !important; } }
@media print {
  @page { margin: 16mm; }
  html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: ${theme.background} !important; }
  body > :not(#${rootId}) { display: none !important; }
  #${rootId} { display: block !important; }
  #${rootId}, #${rootId} * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}
