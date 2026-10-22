import { describe, expect, it } from "vitest";
import { excerpt, guessKind, guessTitle } from "./library";

describe("guessTitle", () => {
  it("prefers the first heading", () => {
    expect(guessTitle("Intro line\n\n## S6a attach: ULR/ULA\n\nbody")).toBe("S6a attach: ULR/ULA");
  });

  it("falls back to the first prose line without markdown", () => {
    expect(guessTitle("**Gx CCR-I flow** for the [PCEF](https://x)\nmore")).toBe("Gx CCR-I flow for the PCEF");
  });

  it("skips fenced code", () => {
    expect(guessTitle("```mermaid\nsequenceDiagram\n  A->>B: x\n```\nExplains the attach.")).toBe("Explains the attach");
  });

  it("truncates long titles", () => {
    expect(guessTitle("x".repeat(200))).toHaveLength(80);
  });
});

describe("guessKind", () => {
  it("recognizes flows, diagrams, and design docs", () => {
    expect(guessKind("```mermaid\nsequenceDiagram\n  A->>B: x\n```")).toBe("flow");
    expect(guessKind("This is the registration flow for IMS.")).toBe("flow");
    expect(guessKind("```mermaid\ngraph TD\n  A-->B\n```")).toBe("diagram");
    expect(guessKind("# Design: HSS failover\n\nWe propose…")).toBe("design");
    expect(guessKind("The HSS stores subscriber profiles.")).toBe("explanation");
  });
});

describe("excerpt", () => {
  it("drops code and markdown syntax", () => {
    expect(excerpt("# Title\n\n```\ncode\n```\n- **bold** item", 100)).toBe("Title bold item");
  });

  it("collapses whitespace and truncates long bodies", () => {
    const body = Array.from({ length: 500 }, (_, index) => `Line\t${index}   of the flow`).join("\n");
    expect(excerpt(body, 30)).toBe("Line 0 of the flow Line 1 of…");
  });
});
