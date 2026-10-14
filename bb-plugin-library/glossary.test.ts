import { describe, expect, it } from "vitest";
import { TERMS, detectTags, normalizeTagNames, normalizeTags, specReferences, specUrl, specsFor, termFor } from "./glossary";
import { TAG_GROUPS } from "./library";

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
  it("orders tags by group: interfaces, procedures, messages, network functions", () => {
    expect(detectTags(S6A_ATTACH)).toEqual(["S6a", "Attach", "ULR/ULA", "AIR/AIA", "MME", "HSS"]);
  });

  it("detects 5GC services, reference points, and network functions", () => {
    expect(detectTags("During initial registration the AMF calls Nudm_UECM_Registration on N8.")).toEqual([
      "Nudm",
      "N8",
      "Registration",
      "AMF",
    ]);
  });

  it("detects S6c and SGd messages and the SMS domain", () => {
    expect(detectTags("The SMS-GMSC sends SRR to the HSS over S6c, then TFR over SGd.")).toEqual([
      "S6c",
      "SGd",
      "SRR/SRA",
      "TFR/TFA",
      "SMS-GMSC",
      "HSS",
      "SMS",
    ]);
  });

  it("needs both halves of an ambiguous command pair", () => {
    expect(detectTags("Convert the value with STR before logging.")).toEqual([]);
    expect(detectTags("The P-CSCF sends STR and the PCRF answers STA.")).toContain("STR/STA");
  });

  it("does not read radio Rx/Tx as the Rx interface", () => {
    expect(detectTags("Check the Rx/Tx buffers on the modem.")).toEqual([]);
    expect(detectTags("The P-CSCF sends AAR to the PCRF over Rx.")).toEqual(["Rx", "AAR/AAA", "P-CSCF", "PCRF"]);
  });

  it("ignores casual uses of attach and AWS service names", () => {
    expect(detectTags("Attach a debugger to the process.")).toEqual([]);
    expect(detectTags("Attach an SCP to the AWS account.")).toEqual([]);
    expect(detectTags("Push the image to ECR before deploying.")).toEqual([]);
  });

  it("detects AKA resynchronization but not data resyncs", () => {
    expect(detectTags("On SQN failure the UE returns AUTS.")).toEqual(["Resync"]);
    expect(detectTags("The MME sends AIR with Re-Synchronization-Info.")).toContain("Resync");
    expect(detectTags("Forcing a resync of subscriber state after a dropped write.")).toEqual([]);
  });

  it("never detects status or doc type tags", () => {
    expect(detectTags("Overview of the Index. Not Implemented yet, Planned for later.")).toEqual([]);
  });

  it("caps detected tags per group", () => {
    expect(detectTags("N1 N2 N3 N4 N7 N8 N9 N10 N11 N12 N13 N14 N15")).toEqual(["N1", "N2", "N3", "N4", "N7", "N8"]);
  });
});

describe("terms", () => {
  it("gives every built-in term one group and a unique tag", () => {
    expect(TERMS.every((term) => (TAG_GROUPS as readonly string[]).includes(term.group))).toBe(true);
    expect(new Set(TERMS.map((term) => term.tag.toLowerCase())).size).toBe(TERMS.length);
  });

  it("groups interfaces, network functions, domains, status, and doc types", () => {
    expect(termFor("gx")).toMatchObject({ tag: "Gx", group: "interfaces", about: "PCEF ↔ PCRF", specs: ["TS 29.212"] });
    expect(termFor("hss")).toMatchObject({ tag: "HSS", group: "functions" });
    expect(termFor("ims")).toMatchObject({ tag: "IMS", group: "domains" });
    expect(termFor("not implemented")).toMatchObject({ tag: "Not Implemented", group: "status" });
    expect(termFor("message reference")).toMatchObject({ tag: "Message Reference", group: "docs" });
    expect(termFor("Outbox")).toBeUndefined();
  });
});

describe("normalizeTags", () => {
  it("canonicalizes known terms, strips hashes, and dedupes case-insensitively", () => {
    expect(normalizeTagNames(["s6a", "#Gx", " S6A ", "custom   tag", "", "ulr/ula"])).toEqual(["S6a", "Gx", "custom tag", "ULR/ULA"]);
  });

  it("keeps the first group named for a tag", () => {
    expect(
      normalizeTags([
        { tag: "Outbox", group: null },
        { tag: "outbox", group: "topics" },
        { tag: "OUTBOX", group: "components" },
      ]),
    ).toEqual([{ tag: "Outbox", group: "topics" }]);
  });

  it("limits tag count and length", () => {
    const tags = normalizeTagNames(Array.from({ length: 40 }, (_, index) => `tag-${index}-${"x".repeat(60)}`));
    expect(tags).toHaveLength(30);
    expect(tags.every((tag) => tag.length <= 40)).toBe(true);
  });
});

describe("specs", () => {
  it("finds explicit TS and RFC references", () => {
    expect(specReferences("Per 3GPP TS 29.212 and RFC6733, not 29.272 alone.")).toEqual(["TS 29.212", "RFC 6733"]);
  });

  it("merges explicit references with the specs of each tag", () => {
    expect(specsFor(["S6a", "Attach", "HSS"], "See TS 29.272 and RFC 6733")).toEqual(["TS 29.272", "RFC 6733", "TS 23.401", "TS 24.301"]);
  });

  it("links 3GPP and IETF specs", () => {
    expect(specUrl("TS 29.272")).toBe("https://www.3gpp.org/DynaReport/29272.htm");
    expect(specUrl("RFC 6733")).toBe("https://www.rfc-editor.org/rfc/rfc6733");
    expect(specUrl("GSMA IR.92")).toBeNull();
  });
});
