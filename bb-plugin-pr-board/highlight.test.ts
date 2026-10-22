import { describe, expect, it } from "vitest";
import type { Draft, Finding } from "./contract";
import { highlightCss } from "./highlight";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    path: "a.go",
    side: "additions",
    startLine: 3,
    endLine: 4,
    severity: "major",
    title: "t",
    body: "",
    headSha: null,
    dismissed: false,
    ...overrides,
  };
}

describe("highlightCss", () => {
  it("targets each line and gutter cell of a finding on its side in split view", () => {
    const css = highlightCss([finding()], [], "split");
    expect(css).toContain('[data-additions] [data-line="3"]');
    expect(css).toContain('[data-additions] [data-line="4"]');
    expect(css).toContain('[data-additions] [data-column-number="4"]');
    expect(css).not.toContain('[data-line="5"]');
    expect(css).toContain("var(--warning)");
  });

  it("separates deleted lines from new lines in unified view", () => {
    const css = highlightCss([finding({ side: "deletions", startLine: 7, endLine: 7 })], [], "unified");
    expect(css).toContain('[data-line="7"][data-line-type="change-deletion"]');
    const added = highlightCss([finding({ startLine: 7, endLine: 7 })], [], "unified");
    expect(added).toContain('[data-line="7"]:not([data-line-type="change-deletion"])');
  });

  it("skips dismissed and file-level findings and tints drafts", () => {
    const draft: Draft = { id: "d", path: "a.go", side: "deletions", startLine: 9, endLine: 9, body: "x" };
    const css = highlightCss([finding({ dismissed: true }), finding({ startLine: null, endLine: null })], [draft], "split");
    expect(css).not.toContain("var(--warning)");
    expect(css).toContain('[data-deletions] [data-line="9"]');
    expect(css).toContain("#8b5cf6");
  });

  it("is empty when nothing is highlighted", () => {
    expect(highlightCss([], [], "split")).toBe("");
  });
});
