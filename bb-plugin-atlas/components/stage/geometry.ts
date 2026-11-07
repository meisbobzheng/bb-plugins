import type { Box } from "../../contract";

export type Point = readonly [number, number];
export type Segment = readonly [Point, Point];
export type Curve = readonly [Point, Point, Point, Point];

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpBox = (a: Box, b: Box, t: number): Box => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
});

export const center = (box: Box): Point => [box.x + box.w / 2, box.y + box.h / 2];

export function border(box: Box, toward: Point, gap = 5): Point {
  const [cx, cy] = center(box);
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const scale = Math.min((box.w / 2 + gap) / Math.abs(dx || 1e-9), (box.h / 2 + gap) / Math.abs(dy || 1e-9));
  return [cx + dx * scale, cy + dy * scale];
}

export function segment(a: Box, b: Box): Segment {
  return [border(a, center(b)), border(b, center(a))];
}

export const along = ([p, q]: Segment, t: number): Point => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

export const length = ([p, q]: Segment): number => Math.hypot(q[0] - p[0], q[1] - p[1]);

export function curveBetween(a: Box, b: Box): Curve {
  const [p, q] = segment(a, b);
  const horizontal = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]);
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  return horizontal ? [p, [mx, p[1]], [mx, q[1]], q] : [p, [p[0], my], [q[0], my], q];
}

export function bezier([p0, p1, p2, p3]: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

export const curvePath = ([p0, p1, p2, p3]: Curve): string => `M${p0[0]},${p0[1]} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;

export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface ZoomFrame {
  fx: number;
  fy: number;
  fw: number;
}

export function zoomFrame(thumb: Box, canvas: Box): ZoomFrame {
  return { fx: (thumb.x - canvas.x) / canvas.w, fy: (thumb.y - canvas.y) / canvas.h, fw: thumb.w / canvas.w };
}

export const insideThumb = ({ fx, fy, fw }: ZoomFrame): string => `translate(${fx * 100}%, ${fy * 100}%) scale(${fw})`;

export const throughThumb = ({ fx, fy, fw }: ZoomFrame): string => `translate(${(-fx / fw) * 100}%, ${(-fy / fw) * 100}%) scale(${1 / fw})`;
