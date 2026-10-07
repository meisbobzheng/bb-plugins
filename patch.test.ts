import { describe, expect, it } from "vitest";
import { hunkRanges, isCommentable } from "./patch";

const PATCH = ["@@ -10,4 +10,5 @@ func a() {", " x", "-y", "+y2", "+y3", " z", "@@ -40 +41,0 @@", "-gone"].join("\n");

describe("hunkRanges", () => {
  it("reads both sides of every hunk, including single-line and empty counts", () => {
    expect(hunkRanges(PATCH)).toEqual([
      { deletions: [10, 13], additions: [10, 14] },
      { deletions: [40, 40], additions: null },
    ]);
  });
});

describe("isCommentable", () => {
  it("accepts ranges inside one hunk on the chosen side", () => {
    expect(isCommentable(PATCH, "additions", 11, 13)).toBe(true);
    expect(isCommentable(PATCH, "deletions", 40, 40)).toBe(true);
  });

  it("rejects lines outside the hunks, ranges spanning hunks, and missing patches", () => {
    expect(isCommentable(PATCH, "additions", 20, 20)).toBe(false);
    expect(isCommentable(PATCH, "deletions", 12, 40)).toBe(false);
    expect(isCommentable(PATCH, "additions", 41, 41)).toBe(false);
    expect(isCommentable(null, "additions", 10, 10)).toBe(false);
  });
});
