import { describe, expect, it } from "vitest";
import { funkyName, toTopic } from "./names";

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

describe("funkyName", () => {
  it("picks an alliterative name when one exists", () => {
    expect(funkyName("rfc", () => 0)).toBe("rfc-randy");
    expect(funkyName("hss", () => 0.99)).toBe("hss-hero");
    for (let i = 0; i < 20; i++) expect(funkyName("review")).toMatch(/^review-r[a-z]+$/);
  });

  it("draws from every name when no alliteration is possible", () => {
    expect(funkyName("5g", () => 0)).toBe("5g-ace");
  });
});
