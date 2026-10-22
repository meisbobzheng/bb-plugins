import { describe, expect, it } from "vitest";
import { funkyName, parseFunkyName, toTopic } from "./names";

const named = (...titles: string[]) => titles.map((title) => parseFunkyName(title)!);

describe("toTopic", () => {
  it("keeps one lowercase alphanumeric word", () => {
    expect(toTopic('"HSS-provisioning."')).toBe("hss");
    expect(toTopic("**RFC 9110**")).toBe("rfc");
    expect(toTopic("supercalifragilisticexpialidocious")).toBe("supercalifragili");
  });

  it("falls back to the next usable candidate, then to thread", () => {
    expect(toTopic(undefined, "  ", "bob-bb")).toBe("bob");
    expect(toTopic(null, "!!!")).toBe("thread");
  });
});

describe("parseFunkyName", () => {
  it("reads back a name this plugin gives", () => {
    expect(parseFunkyName("plugin-phoenix")).toEqual({ topic: "plugin", name: "phoenix" });
  });

  it("ignores titles that are not funky names", () => {
    expect(parseFunkyName("Fix HSS ULR handler")).toBeNull();
    expect(parseFunkyName("bob-bb")).toBeNull();
    expect(parseFunkyName("hss-hero-2")).toBeNull();
  });
});

describe("funkyName", () => {
  it("picks an alliterative name when one exists", () => {
    expect(funkyName("rfc", [], () => 0)).toBe("rfc-randy");
    expect(funkyName("hss", [], () => 0.99)).toBe("hss-husky");
    for (let i = 0; i < 20; i++) expect(funkyName("review")).toMatch(/^review-r[a-z]+$/);
  });

  it("draws from every name when no alliteration is possible", () => {
    expect(funkyName("5g", [], () => 0)).toBe("5g-ace");
  });

  it("skips names recent threads already use", () => {
    const recent = named("prs-panda", "plugin-penny", "plugin-phoenix", "pr-pickle", "prs-pilot");
    for (let i = 0; i < 20; i++) expect(funkyName("plugin", recent)).toBe("plugin-pirate");
  });

  it("gives up alliteration before it repeats a name", () => {
    expect(funkyName("xml", named("xml-xander", "xml-xena", "xml-xenon", "xml-xray"), () => 0)).toBe("xml-ace");
  });

  it("reuses a recent topic's spelling for its singular or plural", () => {
    expect(funkyName("plugins", named("plugin-ace"))).toMatch(/^plugin-p[a-z]+$/);
    expect(funkyName("pr", named("prs-ace"))).toMatch(/^prs-p[a-z]+$/);
    expect(funkyName("hss", named("hs-ace"))).toMatch(/^hss-h[a-z]+$/);
  });
});
