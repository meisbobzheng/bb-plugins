import type { Repeat } from "../../../contract";
import { hours } from "../../format";

export type Layout = "full" | "compact" | "tight";

export interface Crack {
  points: [number, number][];
  path: string;
  branches: string;
}

export const SEAM_W = 1000;
export const SEAM_H = 28;

const DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function rng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutFor({ width, height }: { width: number; height: number }): Layout {
  if (width === 0) return "full";
  if (width >= 900 && height >= 540) return "full";
  return width < 540 || height < 370 ? "tight" : "compact";
}

export const stillWater = ({ height }: { height: number }) => height > 0 && height < 480;

export function kanji(value: number): string {
  if (!Number.isInteger(value) || value < 0) return "";
  if (value === 0) return DIGITS[0]!;
  if (value >= 10_000) return String(value);
  const units: [number, string][] = [
    [1000, "千"],
    [100, "百"],
    [10, "十"],
  ];
  let rest = value;
  let text = "";
  for (const [size, mark] of units) {
    const count = Math.floor(rest / size);
    if (count > 0) text += (count === 1 ? "" : DIGITS[count]!) + mark;
    rest %= size;
  }
  return rest > 0 ? text + DIGITS[rest]! : text;
}

export function crack(seed: number): Crack {
  const random = rng(seed);
  const mid = SEAM_H / 2;
  const points: [number, number][] = [[0, mid]];
  let [x, y] = [0, mid];
  while (x < SEAM_W) {
    x = Math.min(SEAM_W, x + 14 + random() * 38);
    y += (random() - 0.5) * 7;
    if (random() < 0.14) y += (random() - 0.5) * 11;
    y = Math.max(5, Math.min(SEAM_H - 5, y * 0.85 + mid * 0.15));
    points.push([x, y]);
  }
  const path = `M${points.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(" L")}`;
  let branches = "";
  for (let index = 0; index < 8; index += 1) {
    const [bx, by] = points[1 + Math.floor(random() * (points.length - 2))]!;
    const side = random() < 0.5 ? -1 : 1;
    branches += `M${bx.toFixed(1)} ${by.toFixed(1)} L${(bx + 5 + random() * 9).toFixed(1)} ${(by + side * (3 + random() * 3)).toFixed(1)} L${(bx + 10 + random() * 16).toFixed(1)} ${(by + side * (6 + random() * 4)).toFixed(1)} `;
  }
  return { points, path, branches: branches.trim() };
}

export function crackY(points: readonly [number, number][], x: number): number {
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    if (x1 < x) continue;
    const [x0, y0] = points[index - 1]!;
    return y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1));
  }
  return points[points.length - 1]?.[1] ?? SEAM_H / 2;
}

export function deckle(seed: number, steps = 110): string {
  const random = rng(seed);
  const edge = Array.from({ length: steps + 1 }, (_, index) => `${(2 + random() * 4.5 + Math.sin(index / 5.3) * 1.6).toFixed(1)}px ${((index / steps) * 100).toFixed(2)}%`);
  return `polygon(${edge.join(", ")}, 100% 100%, 100% 0)`;
}

export function rgbOf(color: string): string {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, (char) => char + char) : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "39,35,30";
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)).join(",");
}

export function tagFor(reason: string | null, vibe: boolean): string | null {
  if (reason === null) return null;
  if (/^(unheard|new to)/.test(reason)) return "fresh";
  return vibe ? "vibe" : "spread";
}

export function listened(ms: number): [string, string] {
  const [value = "0", unit = "min"] = hours(ms).split(" ");
  return [value, unit === "hr" ? "h listened" : "min listened"];
}

export const repeatWord = (repeat: Repeat) => (repeat === "off" ? "off" : repeat === "track" ? "one" : "all");

export const nextRepeat = (repeat: Repeat) => (repeat === "off" ? "repeat the playlist" : repeat === "context" ? "repeat this song" : "repeat off");

export const pad = (value: number) => String(value).padStart(2, "0");
