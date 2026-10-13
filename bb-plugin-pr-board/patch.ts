import type { Side } from "./contract.js";

type LineRange = readonly [first: number, last: number];

export interface HunkRange {
  deletions: LineRange | null;
  additions: LineRange | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function range(start: number, count: number): LineRange | null {
  return count > 0 ? [start, start + count - 1] : null;
}

export function hunkRanges(patch: string): HunkRange[] {
  return patch.split("\n").flatMap((line) => {
    const match = HUNK_HEADER.exec(line);
    if (match === null) return [];
    const [, oldStart, oldCount, newStart, newCount] = match;
    return [
      {
        deletions: range(Number(oldStart), oldCount === undefined ? 1 : Number(oldCount)),
        additions: range(Number(newStart), newCount === undefined ? 1 : Number(newCount)),
      },
    ];
  });
}

export function isCommentable(patch: string | null, side: Side, startLine: number, endLine: number): boolean {
  if (patch === null) return false;
  return hunkRanges(patch).some((hunk) => {
    const lines = hunk[side];
    return lines !== null && startLine >= lines[0] && endLine <= lines[1];
  });
}
