import { describe, expect, it } from "vitest";
import type { ResultSet } from "./contract";
import { exportFilename, toCsv, toJson, toMarkdown } from "./components/export";

const set: ResultSet = {
  columns: [
    { name: "id", type: "int8", typeId: 20 },
    { name: "note", type: "text", typeId: 25 },
  ],
  rows: [
    ["1", 'say "hi", please'],
    ["2", null],
    ["3", "a|b\nc"],
  ],
  rowCount: 3,
  command: "SELECT",
  truncated: false,
};

describe("exports", () => {
  it("writes RFC 4180 CSV", () => {
    expect(toCsv(set)).toBe(['id,note', '1,"say ""hi"", please"', "2,", '3,"a|b\nc"'].join("\n"));
  });

  it("writes an array of objects as JSON", () => {
    expect(JSON.parse(toJson(set))).toEqual([
      { id: "1", note: 'say "hi", please' },
      { id: "2", note: null },
      { id: "3", note: "a|b\nc" },
    ]);
  });

  it("escapes pipes and newlines in Markdown", () => {
    expect(toMarkdown(set).split("\n")).toEqual(["| id | note |", "| --- | --- |", '| 1 | say "hi", please |', "| 2 |  |", "| 3 | a\\|b c |"]);
  });

  it("names files after the connection and time", () => {
    expect(exportFilename("Nucleus Dev", "csv", new Date("2026-10-21T15:04:05Z"))).toBe("nucleus-dev-2026-10-21-15-04-05.csv");
  });
});
