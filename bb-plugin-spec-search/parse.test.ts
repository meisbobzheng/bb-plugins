import { describe, expect, it } from "vitest";
import { headingClause, parseDocx } from "./docx";
import { SPEC_29228, makeDocx, makeZip, paragraph } from "./fixtures";
import { compareVersions, normalizeSpec, parseQuery, versionFromCode } from "./specs";
import { unzip } from "./zip";

const LIMITS = { entries: 10, entryBytes: 1_000, totalBytes: 2_000 };

describe("unzip", () => {
  it("reads stored and deflated entries in name order, keeping only the wanted ones", () => {
    for (const deflate of [true, false]) {
      const zip = makeZip({ "b.txt": "bravo", "a.txt": "alpha", "skip.bin": "x" }, { deflate });
      expect(unzip(zip, (name) => name.endsWith(".txt"), LIMITS).map(({ name, data }) => [name, data.toString()])).toEqual([
        ["a.txt", "alpha"],
        ["b.txt", "bravo"],
      ]);
    }
  });

  it("refuses archives past the entry, size, and total limits", () => {
    const all = () => true;
    expect(() => unzip(makeZip({ a: "1", b: "2" }), all, { ...LIMITS, entries: 1 })).toThrow("2 entries; the limit is 1");
    expect(() => unzip(makeZip({ big: "x".repeat(1_001) }), all, LIMITS)).toThrow("the limit is 1000");
    expect(() => unzip(makeZip({ a: "x".repeat(900), b: "x".repeat(900), c: "x".repeat(900) }), all, LIMITS)).toThrow("limit is 200");
    expect(() => unzip(Buffer.from("not a zip at all, just text that is long enough"), all, LIMITS)).toThrow("Not a zip archive.");
  });
});

describe("spec references", () => {
  it.each([
    ["29.228 B.1", { spec: "29.228", clause: "B.1", text: "" }],
    ["TS 29.272 §7.3.2", { spec: "29.272", clause: "7.3.2", text: "" }],
    ["3GPP TS 29.228 annex b", { spec: "29.228", clause: "B", text: "" }],
    ["29.228 B", { spec: "29.228", clause: "B", text: "" }],
    ["29.228 a profile", { spec: "29.228", clause: null, text: "a profile" }],
    ["ts29328 clause 6.1.2 user data", { spec: "29.328", clause: "6.1.2", text: "user data" }],
    ["24.301 5.5.1.2.5B1", { spec: "24.301", clause: "5.5.1.2.5B1", text: "" }],
    ["29.272 purge UE", { spec: "29.272", clause: null, text: "purge UE" }],
    ["29.228 is the Cx spec", { spec: "29.228", clause: null, text: "is the Cx spec" }],
    ["36.523-1 7.1", { spec: "36.523-1", clause: "7.1", text: "" }],
    ["29.2281", { spec: null, clause: null, text: "29.2281" }],
    ["Update-Location-Request", { spec: null, clause: null, text: "Update-Location-Request" }],
    ["AVP 1400", { spec: null, clause: null, text: "AVP 1400" }],
  ])("parses %s", (query, expected) => {
    expect(parseQuery(query)).toEqual(expected);
  });

  it("normalizes spec numbers and decodes versions", () => {
    expect(normalizeSpec("TS 29.228")).toBe("29.228");
    expect(normalizeSpec("ts29228")).toBe("29.228");
    expect(normalizeSpec("29228")).toBeNull();
    expect(versionFromCode("j20")).toBe("19.2.0");
    expect(versionFromCode("i7a")).toBe("18.7.10");
    expect(compareVersions("19.10.0", "19.9.0")).toBeGreaterThan(0);
  });
});

describe("parseDocx", () => {
  it("reads the cover and splits the body into numbered clauses, annexes, and tables", async () => {
    const document = await parseDocx(SPEC_29228);
    expect(document).toMatchObject({
      kind: "TS",
      spec: "29.228",
      version: "19.2.0",
      title: "IP Multimedia (IM) Subsystem Cx and Dx interfaces; Signalling flows and message contents",
    });
    expect(document.clauses.map(({ clause, title, depth }) => [clause, title, depth])).toEqual([
      ["Foreword", "Foreword", 1],
      ["6", "User identity to HSS resolution", 1],
      ["6.1", "User registration status query", 2],
      ["B", "Annex B (informative): User profile UML model", 1],
      ["B.1", "General description", 2],
      ["B.2", "Service profile", 2],
      ["B.2.1", "Public Identification", 3],
    ]);
    expect(document.clauses.at(-1)?.body).toBe(
      "The class Public Identification contains the public user identities associated with the service profile.\nAttribute | Description\nIdentity | SIP URI or TEL URI",
    );
  });

  it("decodes entities and skips text boxes and fallback content", async () => {
    const body = [
      paragraph("1\tScope", "Heading1"),
      '<w:p><w:r><w:t>A &amp; B &lt;AVP&gt; &#169;</w:t></w:r><w:r><w:txbxContent><w:p><w:r><w:t>label</w:t></w:r></w:p></w:txbxContent></w:r></w:p>',
      '<w:p><mc:AlternateContent><mc:Choice><w:r><w:t>kept</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>dropped</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>',
    ].join("");
    const document = await parseDocx(makeDocx(body));
    expect(document.clauses).toEqual([{ clause: "1", title: "Scope", depth: 1, body: "A & B <AVP> ©\nkept" }]);
  });

  it("recognizes heading forms", () => {
    expect(headingClause("Annex A (normative):Mapping of Cx operations")).toEqual({ clause: "A", title: "Annex A (normative): Mapping of Cx operations" });
    expect(headingClause("5.2.3.1 Update Location")).toEqual({ clause: "5.2.3.1", title: "Update Location" });
    expect(headingClause("B.2.1A\tCore Network Service Authorization")).toEqual({ clause: "B.2.1A", title: "Core Network Service Authorization" });
    expect(headingClause("Introduction")).toEqual({ clause: "Introduction", title: "Introduction" });
  });
});
