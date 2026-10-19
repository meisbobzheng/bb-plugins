import { describe, expect, it } from "vitest";
import type { Entry } from "./contract";
import { LIGHT_THEME, entryMarkdown, fileName, htmlDocument, printCss, renderEntry } from "./export";

const SVG = '<svg aria-roledescription="sequence" viewBox="0 0 10 10"><text>ULR</text></svg>';

const ENTRY: Entry = {
  id: "lib_1a2b3c4d",
  title: "S6a attach: ULR/ULA",
  kind: "flow",
  summary: "MME registers the UE with the HSS",
  body: [
    "## Steps",
    "",
    "The MME sends **ULR** per TS 29.272.",
    "",
    "```mermaid",
    "sequenceDiagram",
    "  MME->>HSS: ULR",
    "```",
    "",
    "<img src=x onerror=alert(1)>",
    "",
    "[spec](https://www.3gpp.org) and [bad](javascript:alert(1)) ![pic](javascript:x)",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
  ].join("\n"),
  tags: [
    { tag: "S6a", group: "interfaces" },
    { tag: "ULR/ULA", group: "messages" },
    { tag: "Outbox", group: "topics" },
  ],
  source: { threadId: "thr_1", threadTitle: 'Debug "attach"', messageId: null },
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
};

describe("fileName", () => {
  it("turns a title into a safe file name", () => {
    expect(fileName("S6a attach: ULR/ULA between MME and HSS", "md")).toBe("S6a attach - ULR-ULA between MME and HSS.md");
    expect(fileName('a*b?c"d<e>f|g\\h', "pdf")).toBe("a-b-c-d-e-f-g-h.pdf");
    expect(fileName("../..", "html")).toBe("library-entry.html");
    expect(fileName("x".repeat(300), "md")).toBe(`${"x".repeat(120)}.md`);
  });
});

describe("entryMarkdown", () => {
  it("adds front matter and a title heading", () => {
    const markdown = entryMarkdown(ENTRY);
    expect(markdown.startsWith(
      [
        "---",
        'title: "S6a attach: ULR/ULA"',
        "library_id: lib_1a2b3c4d",
        "kind: flow",
        'summary: "MME registers the UE with the HSS"',
        "tags:",
        '  interfaces: ["S6a"]',
        '  messages: ["ULR/ULA"]',
        '  topics: ["Outbox"]',
        'source: "Debug \\"attach\\""',
        "created: 2026-10-01T10:00:00.000Z",
        "updated: 2026-10-02T10:00:00.000Z",
        "---",
        "",
        "# S6a attach: ULR/ULA",
        "",
        "## Steps",
      ].join("\n"),
    )).toBe(true);
    expect(markdown).toContain("```mermaid\nsequenceDiagram");
    expect(markdown.endsWith("| 1 | 2 |\n")).toBe(true);
  });

  it("does not repeat a title the body already starts with", () => {
    const markdown = entryMarkdown({ ...ENTRY, body: "# S6a attach: ULR/ULA\n\nText" });
    expect(markdown.match(/^# S6a attach/gm)).toHaveLength(1);
  });
});

describe("renderEntry", () => {
  it("renders the header, Markdown, and rendered diagrams", () => {
    const rendered = renderEntry(ENTRY, [SVG], LIGHT_THEME);
    expect(rendered.diagramsMissing).toBe(false);
    expect(rendered.body).toContain("<h1>S6a attach: ULR/ULA</h1>");
    expect(rendered.body).toContain("Flow · Saved 2026-10-01 · from “Debug &quot;attach&quot;”");
    expect(rendered.body).toContain('<dt>Interfaces</dt><dd><span class="tag">S6a</span></dd>');
    expect(rendered.body).toContain('<a href="https://www.3gpp.org/DynaReport/29272.htm">TS 29.272</a>');
    expect(rendered.body).toContain(`<figure class="diagram">${SVG}</figure>`);
    expect(rendered.body).not.toContain("sequenceDiagram");
    expect(rendered.body).toContain("<table>");
  });

  it("neutralizes raw HTML and unsafe links and images", () => {
    const { body } = renderEntry(ENTRY, [SVG], LIGHT_THEME);
    expect(body).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain("<img src=x");
    expect(body).toContain('<a href="https://www.3gpp.org">spec</a>');
    expect(body).not.toContain("javascript:");
    expect(body).toContain(" and bad pic");
  });

  it("falls back to mermaid code when the diagrams do not line up", () => {
    for (const diagrams of [[], [SVG, SVG]]) {
      const rendered = renderEntry(ENTRY, diagrams, LIGHT_THEME);
      expect(rendered.diagramsMissing).toBe(true);
      expect(rendered.body).toContain('<pre><code class="language-mermaid">sequenceDiagram\n  MME-&gt;&gt;HSS: ULR');
    }
  });

  it("escapes the title everywhere", () => {
    const rendered = renderEntry({ ...ENTRY, title: "<script>x</script>" }, [], LIGHT_THEME);
    const page = htmlDocument(rendered, LIGHT_THEME);
    expect(page).not.toContain("<script>");
    expect(page).toContain("<title>&lt;script&gt;x&lt;/script&gt;</title>");
  });
});

describe("documents", () => {
  it("wraps the export in a standalone page in the export theme", () => {
    const page = htmlDocument(renderEntry(ENTRY, [SVG], { background: "rgb(20, 20, 20)", foreground: "rgb(230, 230, 230)" }), {
      background: "rgb(20, 20, 20)",
      foreground: "rgb(230, 230, 230)",
    });
    expect(page.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(page).toContain("<title>S6a attach: ULR/ULA</title>");
    expect(page).toContain("html, body { margin: 0; background: rgb(20, 20, 20); }");
    expect(page).toContain(".library-export { color: rgb(230, 230, 230); background: rgb(20, 20, 20);");
    expect(page).toContain('<article class="library-export"><header><h1>');
  });

  it("prints only the export root", () => {
    const css = printCss("library-print", LIGHT_THEME);
    expect(css).toContain("body > :not(#library-print) { display: none !important; }");
    expect(css).toContain("@media screen { #library-print { display: none !important; } }");
  });
});
