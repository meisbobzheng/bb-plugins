import { hash } from "../../spectrum";

export type Shape = "box" | "circle" | "under" | "rule" | "tab" | "cloud";
export type Rand = () => number;

export function rng(seed: number): Rand {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (value: number) => value.toFixed(1);

export function line(rand: Rand, x1: number, y1: number, x2: number, y2: number, jitter: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  const bow = (rand() - 0.5) * Math.min(jitter * 2.2, length * 0.03 + 0.6);
  const wobble = () => (rand() - 0.5) * jitter;
  const [lead, tail, middle] = [rand() * jitter * 1.3, rand() * jitter * 1.3, 0.42 + rand() * 0.16];
  const mx = x1 + (x2 - x1) * middle - uy * bow;
  const my = y1 + (y2 - y1) * middle + ux * bow;
  return `M${f(x1 - ux * lead + wobble())} ${f(y1 - uy * lead + wobble())}Q${f(mx)} ${f(my)} ${f(x2 + ux * tail + wobble())} ${f(y2 + uy * tail + wobble())}`;
}

export function box(rand: Rand, width: number, height: number, jitter: number): string {
  return line(rand, 0, 0, width, 0, jitter) + line(rand, width, 0, width, height, jitter) + line(rand, width, height, 0, height, jitter) + line(rand, 0, height, 0, 0, jitter);
}

function ellipse(rand: Rand, width: number, height: number, turns: number): string {
  const [cx, cy, rx, ry] = [width / 2, height / 2, width / 2 + 1, height / 2 + 1];
  const steps = 20;
  const start = rand() * Math.PI * 2;
  const points: [number, number][] = [];
  for (let index = 0; index <= steps * turns; index += 1) {
    const angle = start + (index / steps) * Math.PI * 2;
    const swell = 1 + (rand() - 0.5) * 0.07 + index * 0.002;
    points.push([cx + Math.cos(angle) * rx * swell, cy + Math.sin(angle) * ry * swell]);
  }
  let path = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const [[x, y], [nx, ny]] = [points[index]!, points[index + 1]!];
    path += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  return path;
}

function cloud(rand: Rand, width: number, height: number): string {
  let path = "M0 0";
  const side = (x1: number, y1: number, x2: number, y2: number) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const bumps = Math.max(1, Math.round(length / 12));
    for (let index = 1; index <= bumps; index += 1) {
      const radius = (length / bumps) * (0.56 + rand() * 0.12);
      path += `A${f(radius)} ${f(radius)} 0 0 1 ${f(x1 + ((x2 - x1) * index) / bumps)} ${f(y1 + ((y2 - y1) * index) / bumps)}`;
    }
  };
  side(0, 0, width, 0);
  side(width, 0, width, height);
  side(width, height, 0, height);
  side(0, height, 0, 0);
  return path;
}

const SHAPES: Record<Shape, (rand: Rand, width: number, height: number) => string[]> = {
  box: (rand, width, height) => {
    const jitter = Math.min(1.6, Math.max(0.55, Math.min(width, height) / 14));
    return [box(rand, width, height, jitter), box(rand, width, height, jitter)];
  },
  circle: (rand, width, height) => [ellipse(rand, width, height, 1.1), ellipse(rand, width, height, 1)],
  under: (rand, width, height) => [line(rand, 0, height + 1, width, height, 1.2), line(rand, width * 0.06, height + 3.5, width * 0.9, height + 3, 1)],
  rule: (rand, _width, height) => [line(rand, 0, 2, 0, height - 2, 1)],
  tab: (rand, width, height) => [line(rand, 0, height, 1, 0, 1) + line(rand, 1, 0, width - 1, 0, 1) + line(rand, width - 1, 0, width, height, 1)],
  cloud: (rand, width, height) => [cloud(rand, width, height)],
};

export function strokes(shape: Shape, width: number, height: number, seed = ""): string[] {
  if (width <= 0 || height <= 0) return [];
  return SHAPES[shape](rng(hash(`${shape}${width}x${height}${seed}`)), width, height);
}

export type Point = [number, number];

export function bezier(points: readonly [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  const at = (axis: 0 | 1) => u * u * u * points[0][axis] + 3 * u * u * t * points[1][axis] + 3 * u * t * t * points[2][axis] + t * t * t * points[3][axis];
  return [at(0), at(1)];
}

const RISING: [Point, Point, Point, Point] = [
  [10, 52],
  [90, 54],
  [150, 38],
  [246, 14],
];
const LEVEL: [Point, Point, Point, Point] = [
  [10, 36],
  [80, 24],
  [170, 46],
  [246, 32],
];

export function plot(picks: number, rising: boolean): { curve: string; now: Point; dots: Point[] } {
  const points = rising ? RISING : LEVEL;
  const [a, b, c, d] = points;
  const count = Math.max(0, Math.min(6, picks));
  const step = count > 1 ? 0.7 / (count - 1) : 0;
  return {
    curve: `M${a[0]} ${a[1]}C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}`,
    now: bezier(points, 0.03),
    dots: Array.from({ length: count }, (_, index) => bezier(points, 0.26 + index * step)),
  };
}
