import type { Box } from "../contract.js";

export const ASPECT = 1.6;
export const THUMB = { inset: 10, header: 32, footer: 14 } as const;

export function thumbOf(box: Box): Box {
  const w = box.w - THUMB.inset * 2;
  return { x: box.x + THUMB.inset, y: box.y + THUMB.header, w, h: w / ASPECT };
}
