import { describe, expect, it } from "vitest";
import { detectTags, normalizeTags, specReferences, specUrl, specsFor, topicFor } from "./topics";

const S6A_ATTACH = [
  "## S6a attach: ULR/ULA between MME and HSS",
  "",
  "During EPS attach the MME fetches vectors with AIR and the HSS replies with AIA.",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  UE->>MME: Attach Request",
  "  MME->>HSS: AIR",
  "  HSS-->>MME: AIA",
  "  MME->>HSS: ULR (Update-Location-Request)",
  "  HSS-->>MME: ULA",
  "```",
  "See TS 29.272 and TS 23.401.",
].join("\n");

describe("detectTags", () => {
  it("orders procedures, interfaces, commands, then protocols", () => {
    expect(detectTags(S6A_ATTACH)).toEqual(["Attach", "S6a", "ULR/ULA", "AIR/AIA"]);
  });

  it("detects 5GC services and reference points", () => {
    expect(detectTags("During initial registration the AMF calls Nudm_UECM_Registration on N8.")).toEqual([
      "Registration",
      "Nudm",
      "N8",
    ]);
  });

  it("needs both halves of an ambiguous command pair", () => {
    expect(detectTags("Convert the value with STR before logging.")).toEqual([]);
    expect(detectTags("The P-CSCF sends STR and the PCRF answers STA.")).toContain("STR/STA");
  });

  it("does not read radio Rx/Tx as the Rx interface", () => {
    expect(detectTags("Check the Rx/Tx buffers on the modem.")).toEqual([]);
    expect(detectTags("The P-CSCF sends AAR to the PCRF over Rx.")).toEqual(["Rx", "AAR/AAA"]);
  });

  it("ignores casual uses of attach", () => {
    expect(detectTags("Attach a debugger to the process.")).toEqual([]);
  });

  it("caps the number of detected tags", () => {
    const text = "N1 N2 N3 N4 N7 N8 N9 N10 N11 N12 N13 N14 N15";
    expect(detectTags(text)).toHaveLength(10);
  });
});

describe("normalizeTags", () => {
  it("canonicalizes known terms, strips hashes, and dedupes case-insensitively", () => {
    expect(normalizeTags(["s6a", "#Gx", " S6A ", "custom   tag", "", "ulr/ula"])).toEqual(["S6a", "Gx", "custom tag", "ULR/ULA"]);
  });

  it("limits tag count and length", () => {
    const tags = normalizeTags(Array.from({ length: 30 }, (_, index) => `tag-${index}-${"x".repeat(60)}`));
    expect(tags).toHaveLength(20);
    expect(tags.every((tag) => tag.length <= 40)).toBe(true);
  });
});

describe("specs", () => {
  it("finds explicit TS and RFC references", () => {
    expect(specReferences("Per 3GPP TS 29.212 and RFC6733, not 29.272 alone.")).toEqual(["TS 29.212", "RFC 6733"]);
  });

  it("merges explicit references with the specs of each tag", () => {
    expect(specsFor(["S6a", "Attach"], "See TS 29.272 and RFC 6733")).toEqual(["TS 29.272", "RFC 6733", "TS 23.401", "TS 24.301"]);
  });

  it("links 3GPP and IETF specs", () => {
    expect(specUrl("TS 29.272")).toBe("https://www.3gpp.org/DynaReport/29272.htm");
    expect(specUrl("RFC 6733")).toBe("https://www.rfc-editor.org/rfc/rfc6733");
    expect(specUrl("GSMA IR.92")).toBeNull();
  });

  it("describes interface tags", () => {
    expect(topicFor("gx")).toMatchObject({ tag: "Gx", about: "PCEF ↔ PCRF", specs: ["TS 29.212"] });
  });
});
